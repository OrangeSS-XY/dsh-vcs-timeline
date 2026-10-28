/**
 * Pull-request read-path tests: origin URL parsing, the credential chain,
 * GitHub GraphQL/REST mapping, GitLab REST mapping, action derivation, provider
 * failure mapping, caching, concurrency, and token isolation.
 *
 * Everything runs against a fake fetch and a fake runner: no test touches the
 * network or a real repository.
 * @module dsh-vcs-timeline/tests/pr.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Repository } from '../shared/contracts.ts'
import {
  isPullRequestDetail,
  isPullRequestList,
  MAX_PULL_REQUESTS,
  PULL_REQUEST_CACHE_MS,
} from '../shared/contracts.ts'
import type { Runner } from '../host/adapters/types.ts'
import { AUTH_FILE_NAME, parseGitCredentials, redact, resolveAuthToken } from '../host/pr/auth.ts'
import { deriveActions, reviewRequestedFrom } from '../host/pr/actions.ts'
import {
  fetchGitHubDetail,
  fetchGitHubList,
  GITHUB_API_BASE,
  GITHUB_GRAPHQL_URL,
  mapMergeable,
  mapRestFileStatus,
  mapReviewDecision,
  mapRollupState,
} from '../host/pr/github.ts'
import { fetchGitLabDetail, fetchGitLabList } from '../host/pr/gitlab.ts'
import {
  parseGitConfigOriginUrl,
  parseRemoteUrl,
  readOriginRemote,
  type RemoteInfo,
} from '../host/pr/remote.ts'
import { createPullRequestService, type PullRequestService } from '../host/pr/service.ts'
import { PROVIDER_MAX_BYTES, type FetchLike, type FetchResponseLike } from '../host/pr/transport.ts'
import { ServiceError, type RepositoryResolver } from '../host/services/timeline-service.ts'
import { createFakeAdapter, makeTempDir } from './helpers.ts'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** One recorded fake-fetch invocation. */
interface FakeCall {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

/** What the fake fetch answers with. */
interface FakeResponseSpec {
  status?: number
  headers?: Record<string, string>
  body?: unknown
}

/** Fake fetch with its recorded calls. */
interface FakeFetch extends FetchLike {
  calls: FakeCall[]
}

/** Build a fake fetch that records every call. */
function createFakeFetch(handler: (call: FakeCall) => FakeResponseSpec | Promise<FakeResponseSpec>): FakeFetch {
  const calls: FakeCall[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const call: FakeCall = {
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      ...(init?.body === undefined ? {} : { body: init.body }),
    }
    calls.push(call)
    const spec = await handler(call)
    const lower: Record<string, string> = {}
    for (const [key, value] of Object.entries(spec.headers ?? {})) lower[key.toLowerCase()] = value
    const status = spec.status ?? 200
    const text = typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body ?? null)
    const response: FetchResponseLike = {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
      text: async () => text,
    }
    return response
  }
  return Object.assign(fetchImpl, { calls })
}

/** Fake runner that answers the origin read (and records every call). */
interface OriginRunner extends Runner {
  calls: Array<{ argv: readonly string[]; cwd: string }>
}

/** Build a runner whose `git config` answer is `origin`. */
function createOriginRunner(origin: string | null): OriginRunner {
  const calls: Array<{ argv: readonly string[]; cwd: string }> = []
  return {
    calls,
    async run(argv, cwd) {
      calls.push({ argv, cwd })
      if (origin === null) return { exitCode: 1, stdout: '', stderr: 'no origin remote' }
      return { exitCode: 0, stdout: `${origin}\n`, stderr: '' }
    },
    async resolveExecutable() {
      return null
    },
  }
}

/** Repository id and root used by the service tests. */
const REPO_ID = 'git:c:/fake/repo'
const REPO_ROOT = 'C:\\fake\\repo'

/** Build a resolver over a fixed repository-id -> root map. */
function createResolver(roots: Record<string, string>): RepositoryResolver {
  const adapters = { git: createFakeAdapter(), svn: createFakeAdapter({ vcsType: 'svn' }) }
  return {
    adapters,
    async resolve(id) {
      const root = roots[id]
      if (root === undefined) {
        return { ok: false, error: { code: 'unknown-repository', message: 'unknown repository' } }
      }
      const repository: Repository = {
        schemaVersion: 1,
        id,
        vcsType: 'git',
        rootPath: root,
        displayName: 'repo',
        detectedAt: '2026-01-01T00:00:00.000Z',
        lastSeenAt: '2026-01-01T00:00:00.000Z',
      }
      return { ok: true, value: { repository, root, adapter: adapters.git } }
    },
  }
}

/** Options for the service harness. */
interface ServiceHarnessOptions {
  origin?: string | null
  fetchImpl: FetchLike
  env?: NodeJS.ProcessEnv
  homeDir?: string
  dataDir?: string
  now?: () => Date
  roots?: Record<string, string>
}

/** Build one service over fakes, isolated from the real environment. */
function createServiceHarness(options: ServiceHarnessOptions): { service: PullRequestService; runner: OriginRunner } {
  const runner = createOriginRunner(options.origin === undefined ? 'https://github.com/octo/repo.git' : options.origin)
  const service = createPullRequestService({
    resolver: createResolver(options.roots ?? { [REPO_ID]: REPO_ROOT }),
    runner,
    dataDir: options.dataDir ?? 'C:\\dvt-missing-data',
    fetchImpl: options.fetchImpl,
    env: options.env ?? {},
    homeDir: options.homeDir ?? 'C:\\dvt-missing-home',
    ...(options.now === undefined ? {} : { now: options.now }),
  })
  return { service, runner }
}

/** Await a call that must fail with a specific service error code. */
async function serviceErrorOf(promise: Promise<unknown>, code: string): Promise<ServiceError> {
  let failure: unknown
  await promise.then(
    () => {
      throw new Error('expected the call to fail')
    },
    (error: unknown) => {
      failure = error
    },
  )
  assert.ok(failure instanceof ServiceError, 'the call failed with a ServiceError')
  assert.equal(failure.code, code)
  return failure
}

/** A parsed remote fixture. */
function remoteInfo(overrides: Partial<RemoteInfo> = {}): RemoteInfo {
  return {
    provider: 'github',
    host: 'github.com',
    remotePath: 'octo/repo',
    webBase: 'https://github.com',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// GitHub fixtures
// ---------------------------------------------------------------------------

/** One GraphQL pull-request node with sensible defaults. */
function graphqlNode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 42,
    title: 'Add pull-request reading',
    url: 'https://github.com/octo/repo/pull/42',
    isDraft: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    author: { login: 'dev-one' },
    headRefName: 'feature/pr',
    baseRefName: 'main',
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    reviewRequests: { nodes: [] },
    latestReviews: { nodes: [] },
    commits: { totalCount: 3 },
    comments: { totalCount: 5 },
    additions: 10,
    deletions: 2,
    changedFiles: 4,
    statusCheckRollup: { state: 'SUCCESS' },
    labels: { nodes: [{ name: 'feature' }, { name: 'host' }] },
    ...overrides,
  }
}

/** A GraphQL list payload. */
function graphqlListPayload(nodes: unknown[], viewer: string | null = 'octocat'): unknown {
  return {
    data: {
      rateLimit: { remaining: 4999, resetAt: '2026-01-03T00:00:00Z' },
      viewer: viewer === null ? null : { login: viewer },
      repository: { pullRequests: { nodes } },
    },
  }
}

/** A GraphQL detail payload. */
function graphqlDetailPayload(node: unknown, viewer: string | null = 'octocat'): unknown {
  return {
    data: {
      rateLimit: { remaining: 4999, resetAt: '2026-01-03T00:00:00Z' },
      viewer: viewer === null ? null : { login: viewer },
      repository: { pullRequest: node },
    },
  }
}

/** REST files payload used by both detail paths. */
const REST_FILES = [
  { filename: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 },
  { filename: 'src/new.ts', previous_filename: 'src/old.ts', status: 'renamed', additions: 0, deletions: 0 },
]

// ---------------------------------------------------------------------------
// Remote URL parsing
// ---------------------------------------------------------------------------

test('parseRemoteUrl accepts the common GitHub/GitLab URL forms', () => {
  const https = parseRemoteUrl('https://github.com/octo/repo.git')
  assert.deepEqual(https, { provider: 'github', host: 'github.com', remotePath: 'octo/repo', webBase: 'https://github.com' })

  const scp = parseRemoteUrl('git@github.com:octo/repo.git')
  assert.deepEqual(scp, { provider: 'github', host: 'github.com', remotePath: 'octo/repo', webBase: 'https://github.com' })

  const ssh = parseRemoteUrl('ssh://git@github.com/octo/repo.git')
  assert.deepEqual(ssh, { provider: 'github', host: 'github.com', remotePath: 'octo/repo', webBase: 'https://github.com' })

  const gitlab = parseRemoteUrl('https://gitlab.example.com/group/sub/repo.git')
  assert.ok(gitlab !== null)
  assert.equal(gitlab.provider, 'gitlab')
  assert.equal(gitlab.host, 'gitlab.example.com')
  assert.equal(gitlab.remotePath, 'group/sub/repo')
  assert.equal(gitlab.webBase, 'https://gitlab.example.com')
})

test('parseRemoteUrl normalizes host case, .git suffix, trailing slash and query', () => {
  const mixed = parseRemoteUrl('https://GitHub.COM/Octo/Repo.GIT/')
  assert.ok(mixed !== null)
  assert.equal(mixed.host, 'github.com')
  assert.equal(mixed.remotePath, 'Octo/Repo')
  const bare = parseRemoteUrl('https://github.com/octo/repo')
  assert.ok(bare !== null)
  assert.equal(bare.remotePath, 'octo/repo')
  const query = parseRemoteUrl('https://github.com/octo/repo.git?ref=main')
  assert.ok(query !== null)
  assert.equal(query.remotePath, 'octo/repo')
})

test('parseRemoteUrl strips embedded credentials and never keeps them in the result', () => {
  const parsed = parseRemoteUrl('https://user:sekret-token@github.com/octo/repo.git')
  assert.ok(parsed !== null)
  assert.equal(parsed.host, 'github.com')
  assert.equal(parsed.remotePath, 'octo/repo')
  assert.ok(!JSON.stringify(parsed).includes('sekret-token'))
  assert.ok(!JSON.stringify(parsed).includes('user'))
})

test('parseRemoteUrl rejects unsupported and malformed remotes', () => {
  const unsupported = parseRemoteUrl('https://bitbucket.org/team/repo.git')
  assert.ok(unsupported !== null)
  assert.equal(unsupported.provider, 'unknown')
  assert.equal(parseRemoteUrl('https://github.com/octo'), null)
  assert.equal(parseRemoteUrl('file:///C:/repos/repo'), null)
  assert.equal(parseRemoteUrl('C:\\repos\\repo'), null)
  assert.equal(parseRemoteUrl('../sibling'), null)
  assert.equal(parseRemoteUrl(''), null)
  assert.equal(parseRemoteUrl('not a url'), null)
})

test('parseGitConfigOriginUrl reads only the origin section', () => {
  const config = [
    '[core]',
    '\trepositoryformatversion = 0',
    '[remote "origin"]',
    '\turl = git@github.com:octo/repo.git',
    '\tfetch = +refs/heads/*:refs/remotes/origin/*',
    '[remote "upstream"]',
    '\turl = https://github.com/other/repo.git',
  ].join('\n')
  assert.equal(parseGitConfigOriginUrl(config), 'git@github.com:octo/repo.git')
  assert.equal(parseGitConfigOriginUrl('[core]\n\trepositoryformatversion = 0\n'), null)
})

test('readOriginRemote prefers git config and falls back to .git/config', async () => {
  const runner = createOriginRunner('https://user:sekret@github.com/octo/repo.git')
  const viaCommand = await readOriginRemote({ runner, root: 'C:\\fake\\repo' })
  assert.equal(viaCommand.ok, true)
  if (viaCommand.ok) {
    assert.equal(viaCommand.value.host, 'github.com')
    assert.ok(!JSON.stringify(viaCommand.value).includes('sekret'))
  }
  assert.deepEqual(runner.calls[0]?.argv, ['git', 'config', '--get', 'remote.origin.url'])
  assert.equal(runner.calls[0]?.cwd, 'C:\\fake\\repo')

  const temp = await makeTempDir('dvt-remote-')
  try {
    await mkdir(join(temp.path, '.git'), { recursive: true })
    await writeFile(join(temp.path, '.git', 'config'), '[remote "origin"]\n\turl = git@gitlab.com:group/repo.git\n')
    const fallback = await readOriginRemote({ runner: createOriginRunner(null), root: temp.path })
    assert.equal(fallback.ok, true)
    if (fallback.ok) {
      assert.equal(fallback.value.provider, 'gitlab')
      assert.equal(fallback.value.remotePath, 'group/repo')
    }
    const missing = await readOriginRemote({ runner: createOriginRunner(null), root: join(temp.path, 'missing') })
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.equal(missing.error.code, 'unsupported-remote')
  } finally {
    await temp.cleanup()
  }
})

// ---------------------------------------------------------------------------
// Credential chain
// ---------------------------------------------------------------------------

test('resolveAuthToken prefers env, then ~/.git-credentials, then pr-auth.json', async () => {
  const home = await makeTempDir('dvt-auth-home-')
  const data = await makeTempDir('dvt-auth-data-')
  try {
    await writeFile(join(home.path, '.git-credentials'), 'https://bot:cred-token@github.com\nhttps://bot:other@bitbucket.org\n')
    await writeFile(join(data.path, AUTH_FILE_NAME), JSON.stringify({ github: 'file-token', gitlab: 'gitlab-file-token' }))

    const fromEnv = await resolveAuthToken({
      dataDir: data.path,
      provider: 'github',
      host: 'github.com',
      env: { GITHUB_TOKEN: 'env-token' },
      homeDir: home.path,
    })
    assert.deepEqual(fromEnv, { token: 'env-token', source: 'env' })

    const fromCredentials = await resolveAuthToken({
      dataDir: data.path,
      provider: 'github',
      host: 'github.com',
      env: {},
      homeDir: home.path,
    })
    assert.deepEqual(fromCredentials, { token: 'cred-token', source: 'git-credentials' })

    const emptyHome = await makeTempDir('dvt-auth-empty-')
    try {
      const fromFile = await resolveAuthToken({
        dataDir: data.path,
        provider: 'github',
        host: 'github.com',
        env: {},
        homeDir: emptyHome.path,
      })
      assert.deepEqual(fromFile, { token: 'file-token', source: 'auth-file' })
    } finally {
      await emptyHome.cleanup()
    }
  } finally {
    await home.cleanup()
    await data.cleanup()
  }
})

test('resolveAuthToken is provider-scoped and falls back to anonymous', async () => {
  const home = await makeTempDir('dvt-auth-scope-home-')
  const data = await makeTempDir('dvt-auth-scope-data-')
  const emptyData = await makeTempDir('dvt-auth-empty-data-')
  try {
    await writeFile(join(data.path, AUTH_FILE_NAME), JSON.stringify({ github: 'gh-file' }))
    // A GitHub token must never be sent to a GitLab host.
    const gitlabWithGitHubEnv = await resolveAuthToken({
      dataDir: data.path,
      provider: 'gitlab',
      host: 'gitlab.com',
      env: { GITHUB_TOKEN: 'github-env' },
      homeDir: home.path,
    })
    assert.deepEqual(gitlabWithGitHubEnv, { token: null, source: 'none' })

    const anonymous = await resolveAuthToken({
      dataDir: emptyData.path,
      provider: 'github',
      host: 'github.com',
      env: {},
      homeDir: home.path,
    })
    assert.deepEqual(anonymous, { token: null, source: 'none' })

    const ghTokenFallback = await resolveAuthToken({
      dataDir: emptyData.path,
      provider: 'github',
      host: 'github.com',
      env: { GH_TOKEN: 'gh-env' },
      homeDir: home.path,
    })
    assert.deepEqual(ghTokenFallback, { token: 'gh-env', source: 'env' })
  } finally {
    await home.cleanup()
    await data.cleanup()
    await emptyData.cleanup()
  }
})

test('parseGitCredentials matches the host and decodes the password', () => {
  assert.equal(parseGitCredentials('https://bot:tok%40en@github.com', 'github.com'), 'tok@en')
  assert.equal(parseGitCredentials('https://bot:tok@GitHub.com/org/repo', 'github.com'), 'tok')
  assert.equal(parseGitCredentials('https://bot:tok@bitbucket.org', 'github.com'), null)
  assert.equal(parseGitCredentials('http://bot:tok@github.com', 'github.com'), null)
  assert.equal(parseGitCredentials('https://bot@github.com', 'github.com'), null)
})

test('redact hides credentials and provider tokens', () => {
  const message = 'failed for https://bob:hunter2@example.com token=abc123 Authorization: Bearer xyz.def'
  const redacted = redact(message)
  assert.ok(!redacted.includes('hunter2'))
  assert.ok(!redacted.includes('abc123'))
  assert.ok(!redacted.includes('xyz.def'))
  assert.ok(redacted.includes('***'))
})

// ---------------------------------------------------------------------------
// Action derivation
// ---------------------------------------------------------------------------

test('deriveActions covers every branch of the decision table', () => {
  const base = {
    authenticated: true,
    viewer: 'octocat',
    authorLogin: 'dev-one',
    reviewState: 'none' as const,
    checksState: 'none' as const,
    mergeable: null as boolean | null,
    pendingReviewers: [],
    requestedFromViewer: false,
  }
  assert.deepEqual(deriveActions({ ...base, authenticated: false }), [{ kind: 'unknown', reason: 'needs-auth' }])
  assert.deepEqual(deriveActions({ ...base, requestedFromViewer: true }), [{ kind: 'review', reason: 'review-requested' }])
  assert.deepEqual(
    deriveActions({
      ...base,
      reviewState: 'review-required',
      pendingReviewers: [{ login: 'Octocat' }],
    }),
    [{ kind: 'review', reason: 'review-requested' }],
  )
  assert.deepEqual(
    deriveActions({ ...base, authorLogin: 'octocat', reviewState: 'changes-requested' }),
    [{ kind: 'address-feedback', reason: 'your-pr-has-feedback' }],
  )
  assert.deepEqual(
    deriveActions({ ...base, reviewState: 'changes-requested' }),
    [{ kind: 'review', reason: 'changes-requested-by-others' }],
  )
  assert.deepEqual(
    deriveActions({ ...base, checksState: 'failure' }),
    [{ kind: 'fix-ci', reason: 'checks-failed' }],
  )
  assert.deepEqual(
    deriveActions({ ...base, mergeable: false }),
    [{ kind: 'fix-conflicts', reason: 'merge-conflict' }],
  )
  assert.deepEqual(
    deriveActions({ ...base, reviewState: 'approved', mergeable: true, checksState: 'success' }),
    [{ kind: 'merge', reason: 'ready-to-merge' }],
  )
  assert.deepEqual(
    deriveActions({ ...base, reviewState: 'approved', mergeable: true, checksState: 'pending' }),
    [{ kind: 'wait', reason: 'waiting' }],
  )
  assert.deepEqual(deriveActions(base), [{ kind: 'wait', reason: 'waiting' }])
  assert.ok(deriveActions(base).length <= 3)
})

test('reviewRequestedFrom matches the viewer case-insensitively only when authenticated', () => {
  assert.equal(reviewRequestedFrom([{ login: 'OctoCat' }], 'octocat'), true)
  assert.equal(reviewRequestedFrom([{ login: 'someone' }], 'octocat'), false)
  assert.equal(reviewRequestedFrom([{ login: 'octocat' }], null), false)
  assert.equal(reviewRequestedFrom([], 'octocat'), false)
})

// ---------------------------------------------------------------------------
// GitHub mapping
// ---------------------------------------------------------------------------

test('github GraphQL list maps draft, review, rollup, reviewers, mergeable and labels', async () => {
  const fetchImpl = createFakeFetch(() => ({
    body: graphqlListPayload([
      graphqlNode({
        number: 42,
        reviewDecision: 'REVIEW_REQUIRED',
        mergeable: 'UNKNOWN',
        statusCheckRollup: { state: 'PENDING' },
        reviewRequests: {
          nodes: [
            { requestedReviewer: { login: 'octocat' } },
            { requestedReviewer: { name: 'platform-team' } },
          ],
        },
        latestReviews: {
          nodes: [
            { author: { login: 'rev-one' }, state: 'COMMENTED', submittedAt: '2026-01-02T01:00:00Z' },
            { author: { login: 'rev-two' }, state: 'MYSTERY' },
          ],
        },
      }),
      graphqlNode({
        number: 43,
        title: 'Draft work in progress',
        isDraft: true,
        author: { login: 'octocat' },
        reviewDecision: 'CHANGES_REQUESTED',
        mergeable: 'CONFLICTING',
        statusCheckRollup: { state: 'FAILURE' },
      }),
    ]),
  }))
  const result = await fetchGitHubList({
    fetchImpl,
    remote: remoteInfo(),
    token: 'tok-secret',
    repositoryId: REPO_ID,
    fetchedAt: '2026-01-03T00:00:00.000Z',
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.viewer, 'octocat')
  assert.equal(result.value.pullRequests.length, 2)
  const [first, second] = result.value.pullRequests
  assert.ok(first !== undefined && second !== undefined)

  assert.equal(first.provider, 'github')
  assert.equal(first.id, `${REPO_ID}#42`)
  assert.equal(first.repositoryId, REPO_ID)
  assert.equal(first.number, 42)
  assert.equal(first.title, 'Add pull-request reading')
  assert.equal(first.url, 'https://github.com/octo/repo/pull/42')
  assert.equal(first.state, 'open')
  assert.equal(first.author.login, 'dev-one')
  assert.equal(first.branch, 'feature/pr')
  assert.equal(first.baseBranch, 'main')
  assert.equal(first.createdAt, '2026-01-01T00:00:00.000Z')
  assert.equal(first.updatedAt, '2026-01-02T00:00:00.000Z')
  assert.equal(first.reviewState, 'review-required')
  assert.equal(first.checksState, 'pending')
  assert.equal(first.mergeable, null)
  assert.deepEqual(first.pendingReviewers, [{ login: 'octocat' }, { login: 'platform-team' }])
  assert.equal(first.requestedFromViewer, true)
  assert.deepEqual(first.actions, [{ kind: 'review', reason: 'review-requested' }])
  assert.deepEqual(first.reviews, [
    { author: { login: 'rev-one' }, state: 'commented', submittedAt: '2026-01-02T01:00:00.000Z' },
  ])
  assert.deepEqual(first.labels, ['feature', 'host'])
  assert.equal(first.commitCount, 3)
  assert.equal(first.commentCount, 5)
  assert.equal(first.changedFiles, 4)
  assert.equal(first.additions, 10)
  assert.equal(first.deletions, 2)

  assert.equal(second.state, 'draft')
  assert.equal(second.reviewState, 'changes-requested')
  assert.equal(second.checksState, 'failure')
  assert.equal(second.mergeable, false)
  assert.equal(second.requestedFromViewer, false)
  assert.deepEqual(second.actions, [{ kind: 'address-feedback', reason: 'your-pr-has-feedback' }])

  const call = fetchImpl.calls[0]
  assert.ok(call !== undefined)
  assert.equal(call.url, GITHUB_GRAPHQL_URL)
  assert.equal(call.method, 'POST')
  assert.equal(call.headers.authorization, 'bearer tok-secret')
  const body = JSON.parse(call.body ?? '{}') as { query?: unknown; variables?: unknown }
  assert.equal(typeof body.query, 'string')
  assert.deepEqual(body.variables, { owner: 'octo', name: 'repo', first: MAX_PULL_REQUESTS })
  // The token only ever travels in the request header.
  assert.ok(!JSON.stringify(result.value).includes('tok-secret'))
})

test('github lists open-only, draft-first REST payloads anonymously without review facts', async () => {
  const fetchImpl = createFakeFetch(() => ({
    body: [
      {
        number: 7,
        title: 'Public pull request',
        html_url: 'https://github.com/octo/repo/pull/7',
        state: 'open',
        draft: true,
        user: { login: 'anon-author' },
        head: { ref: 'topic' },
        base: { ref: 'main' },
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        labels: [{ name: 'public' }],
        comments: 2,
        changed_files: 1,
        additions: 3,
        deletions: 1,
      },
    ],
  }))
  const result = await fetchGitHubList({
    fetchImpl,
    remote: remoteInfo(),
    token: null,
    repositoryId: REPO_ID,
    fetchedAt: '2026-01-03T00:00:00.000Z',
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.viewer, null)
  const pr = result.value.pullRequests[0]
  assert.ok(pr !== undefined)
  assert.equal(pr.state, 'draft')
  assert.equal(pr.reviewState, 'none')
  assert.equal(pr.checksState, 'none')
  assert.equal(pr.mergeable, null)
  assert.deepEqual(pr.reviews, [])
  assert.deepEqual(pr.checks, [])
  assert.deepEqual(pr.pendingReviewers, [])
  assert.equal(pr.requestedFromViewer, false)
  assert.deepEqual(pr.actions, [{ kind: 'unknown', reason: 'needs-auth' }])
  assert.deepEqual(pr.labels, ['public'])
  assert.equal(pr.commentCount, 2)
  assert.equal(pr.changedFiles, 1)

  const call = fetchImpl.calls[0]
  assert.ok(call !== undefined)
  assert.ok(call.url.startsWith(`${GITHUB_API_BASE}/repos/octo/repo/pulls?`))
  assert.ok(call.url.includes('state=open'))
  assert.ok(call.url.includes(`per_page=${MAX_PULL_REQUESTS}`))
  assert.equal(call.headers.authorization, undefined)
  assert.equal(call.headers['private-token'], undefined)
})

test('github mapping helpers map the provider enums honestly', () => {
  assert.equal(mapReviewDecision('APPROVED'), 'approved')
  assert.equal(mapReviewDecision('CHANGES_REQUESTED'), 'changes-requested')
  assert.equal(mapReviewDecision('REVIEW_REQUIRED'), 'review-required')
  assert.equal(mapReviewDecision(undefined), 'none')
  assert.equal(mapRollupState('SUCCESS'), 'success')
  assert.equal(mapRollupState('FAILURE'), 'failure')
  assert.equal(mapRollupState('ERROR'), 'failure')
  assert.equal(mapRollupState('PENDING'), 'pending')
  assert.equal(mapRollupState('EXPECTED'), 'pending')
  assert.equal(mapRollupState(undefined), 'none')
  assert.equal(mapMergeable('MERGEABLE'), true)
  assert.equal(mapMergeable('CONFLICTING'), false)
  assert.equal(mapMergeable('UNKNOWN'), null)
  assert.equal(mapRestFileStatus('added'), 'added')
  assert.equal(mapRestFileStatus('removed'), 'deleted')
  assert.equal(mapRestFileStatus('changed'), 'modified')
  assert.equal(mapRestFileStatus('weird'), 'unknown')
})

test('github authenticated detail maps files, description and lifecycle state', async () => {
  const fetchImpl = createFakeFetch(call => {
    if (call.url === GITHUB_GRAPHQL_URL) {
      return {
        body: graphqlDetailPayload(graphqlNode({
          number: 42,
          state: 'OPEN',
          body: '## Summary\nreadable pull requests',
          reviewDecision: 'APPROVED',
          mergeable: 'MERGEABLE',
          statusCheckRollup: { state: 'SUCCESS' },
        })),
      }
    }
    if (call.url.includes('/files')) return { body: REST_FILES }
    return { status: 404, body: { message: 'not found' } }
  })
  const result = await fetchGitHubDetail({
    fetchImpl,
    remote: remoteInfo(),
    token: 'tok-secret',
    repositoryId: REPO_ID,
    fetchedAt: '2026-01-03T00:00:00.000Z',
    number: 42,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.pullRequest.state, 'open')
  assert.equal(result.value.pullRequest.reviewState, 'approved')
  assert.equal(result.value.pullRequest.checksState, 'success')
  assert.equal(result.value.pullRequest.mergeable, true)
  assert.deepEqual(result.value.pullRequest.actions, [{ kind: 'merge', reason: 'ready-to-merge' }])
  assert.equal(result.value.body, '## Summary\nreadable pull requests')
  assert.deepEqual(result.value.files, [
    { path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 },
    { path: 'src/new.ts', oldPath: 'src/old.ts', status: 'renamed', additions: 0, deletions: 0 },
  ])
  assert.equal(fetchImpl.calls.length, 2)
  for (const call of fetchImpl.calls) assert.equal(call.headers.authorization, 'bearer tok-secret')
})

test('github anonymous detail maps a closed pull request and degrades a failed files read', async () => {
  const fetchImpl = createFakeFetch(call => {
    if (/\/pulls\/9$/.test(call.url)) {
      return {
        body: {
          number: 9,
          title: 'Closed one',
          html_url: 'https://github.com/octo/repo/pull/9',
          state: 'closed',
          merged_at: null,
          draft: false,
          mergeable: true,
          user: { login: 'dev-one' },
          head: { ref: 'x' },
          base: { ref: 'main' },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
          body: 'description',
        },
      }
    }
    return { status: 403, body: { message: 'no files for you' } }
  })
  const result = await fetchGitHubDetail({
    fetchImpl,
    remote: remoteInfo(),
    token: null,
    repositoryId: REPO_ID,
    fetchedAt: '2026-01-03T00:00:00.000Z',
    number: 9,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.pullRequest.state, 'closed')
  assert.equal(result.value.pullRequest.mergeable, true)
  assert.deepEqual(result.value.pullRequest.actions, [{ kind: 'unknown', reason: 'needs-auth' }])
  assert.deepEqual(result.value.files, [])
  assert.ok(result.value.warnings.includes('the changed files of this pull request could not be read'))
  assert.equal(result.value.body, 'description')
})

// ---------------------------------------------------------------------------
// GitLab mapping
// ---------------------------------------------------------------------------

/** One GitLab merge-request fixture. */
function mergeRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iid: 5,
    title: 'Merge request reading',
    web_url: 'https://gitlab.com/group/sub/repo/-/merge_requests/5',
    state: 'opened',
    draft: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    author: { username: 'gl-author', name: 'Author' },
    source_branch: 'feat/pr',
    target_branch: 'main',
    user_notes_count: 4,
    changes_count: '3',
    has_conflicts: false,
    merge_status: 'can_be_merged',
    reviewers: [{ username: 'gl-viewer', name: 'Viewer' }],
    labels: ['backend'],
    ...overrides,
  }
}

test('gitlab list maps merge requests, assigned reviewers and the PRIVATE-TOKEN header', async () => {
  const fetchImpl = createFakeFetch(call => {
    if (call.url.endsWith('/user')) return { body: { username: 'gl-viewer', name: 'Viewer' } }
    return { body: [mergeRequest()] }
  })
  const result = await fetchGitLabList({
    fetchImpl,
    remote: remoteInfo({ provider: 'gitlab', host: 'gitlab.com', remotePath: 'group/sub/repo', webBase: 'https://gitlab.com' }),
    token: 'gl-secret',
    repositoryId: REPO_ID,
    fetchedAt: '2026-01-03T00:00:00.000Z',
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.viewer, 'gl-viewer')
  const pr = result.value.pullRequests[0]
  assert.ok(pr !== undefined)
  assert.equal(pr.provider, 'gitlab')
  assert.equal(pr.id, `${REPO_ID}!5`)
  assert.equal(pr.number, 5)
  assert.equal(pr.state, 'open')
  assert.equal(pr.author.login, 'gl-author')
  assert.equal(pr.branch, 'feat/pr')
  assert.equal(pr.baseBranch, 'main')
  assert.equal(pr.reviewState, 'none')
  assert.equal(pr.checksState, 'none')
  assert.equal(pr.mergeable, true)
  assert.deepEqual(pr.pendingReviewers, [{ login: 'gl-viewer' }])
  assert.equal(pr.requestedFromViewer, true)
  assert.deepEqual(pr.actions, [{ kind: 'review', reason: 'review-requested' }])
  assert.equal(pr.changedFiles, 3)
  assert.equal(pr.commentCount, 4)
  assert.deepEqual(pr.labels, ['backend'])
  assert.ok(!JSON.stringify(result.value).includes('gl-secret'))

  const listCall = fetchImpl.calls.find(call => call.url.includes('/merge_requests?'))
  assert.ok(listCall !== undefined)
  assert.ok(listCall.url.includes('/projects/group%2Fsub%2Frepo/merge_requests?'))
  assert.ok(listCall.url.includes('state=opened'))
  assert.equal(listCall.headers['private-token'], 'gl-secret')
  for (const call of fetchImpl.calls) assert.equal(call.headers['private-token'], 'gl-secret')
})

test('gitlab list reads public projects anonymously', async () => {
  const fetchImpl = createFakeFetch(() => ({ body: [mergeRequest({ reviewers: [], labels: [] })] }))
  const result = await fetchGitLabList({
    fetchImpl,
    remote: remoteInfo({ provider: 'gitlab', host: 'gitlab.com', remotePath: 'group/repo', webBase: 'https://gitlab.com' }),
    token: null,
    repositoryId: REPO_ID,
    fetchedAt: '2026-01-03T00:00:00.000Z',
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.viewer, null)
  const pr = result.value.pullRequests[0]
  assert.ok(pr !== undefined)
  assert.deepEqual(pr.actions, [{ kind: 'unknown', reason: 'needs-auth' }])
  assert.deepEqual(pr.pendingReviewers, [])
  assert.equal(fetchImpl.calls.length, 1)
  assert.equal(fetchImpl.calls[0]?.headers['private-token'], undefined)
})

test('gitlab detail maps the pipeline check state, diffs and description', async () => {
  const fetchImpl = createFakeFetch(call => {
    if (call.url.endsWith('/user')) return { body: { username: 'gl-viewer' } }
    if (call.url.includes('/diffs')) {
      return {
        body: [
          { old_path: 'src/a.ts', new_path: 'src/a.ts', new_file: false, deleted_file: false, renamed_file: false },
          { old_path: 'src/gone.ts', new_path: 'src/gone.ts', new_file: false, deleted_file: true, renamed_file: false },
          { old_path: 'src/old.ts', new_path: 'src/new.ts', new_file: false, deleted_file: false, renamed_file: true },
          { old_path: 'src/fresh.ts', new_path: 'src/fresh.ts', new_file: true, deleted_file: false, renamed_file: false },
        ],
      }
    }
    return {
      body: mergeRequest({
        description: 'MR description',
        reviewers: [],
        head_pipeline: { status: 'failed', web_url: 'https://gitlab.com/group/sub/repo/-/pipelines/1' },
        detailed_merge_status: 'mergeable',
      }),
    }
  })
  const result = await fetchGitLabDetail({
    fetchImpl,
    remote: remoteInfo({ provider: 'gitlab', host: 'gitlab.com', remotePath: 'group/sub/repo', webBase: 'https://gitlab.com' }),
    token: 'gl-secret',
    repositoryId: REPO_ID,
    fetchedAt: '2026-01-03T00:00:00.000Z',
    number: 5,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.value.pullRequest.checksState, 'failure')
  assert.deepEqual(result.value.pullRequest.checks, [
    { name: 'pipeline', state: 'failure', url: 'https://gitlab.com/group/sub/repo/-/pipelines/1' },
  ])
  assert.deepEqual(result.value.pullRequest.actions, [{ kind: 'fix-ci', reason: 'checks-failed' }])
  assert.equal(result.value.body, 'MR description')
  assert.deepEqual(result.value.files.map(file => [file.path, file.oldPath, file.status]), [
    ['src/a.ts', undefined, 'modified'],
    ['src/gone.ts', undefined, 'deleted'],
    ['src/new.ts', 'src/old.ts', 'renamed'],
    ['src/fresh.ts', undefined, 'added'],
  ])
})

// ---------------------------------------------------------------------------
// Service: mapping, caching, error mapping, token isolation
// ---------------------------------------------------------------------------

test('service list returns a contract-shaped list and never serializes the token', async () => {
  const fetchImpl = createFakeFetch(() => ({ body: graphqlListPayload([graphqlNode()]) }))
  const { service, runner } = createServiceHarness({
    fetchImpl,
    env: { GITHUB_TOKEN: 'tok-secret' },
    now: () => new Date('2026-01-03T00:00:00Z'),
  })
  const list = await service.list({ repositoryId: REPO_ID })
  assert.equal(isPullRequestList(list), true)
  assert.equal(list.repositoryId, REPO_ID)
  assert.equal(list.provider, 'github')
  assert.equal(list.host, 'github.com')
  assert.equal(list.remotePath, 'octo/repo')
  assert.equal(list.viewer, 'octocat')
  assert.equal(list.authenticated, true)
  assert.equal(list.fetchedAt, '2026-01-03T00:00:00.000Z')
  assert.equal(list.pullRequests.length, 1)
  assert.equal(JSON.stringify({ ok: true, value: list }).includes('tok-secret'), false)
  assert.equal(runner.calls.length, 1)
})

test('service list is anonymous without credentials and derives needs-auth actions', async () => {
  const fetchImpl = createFakeFetch(() => ({
    body: [{ number: 7, title: 'Public', html_url: 'https://github.com/octo/repo/pull/7', state: 'open', user: { login: 'a' } }],
  }))
  const { service } = createServiceHarness({ fetchImpl, env: {} })
  const list = await service.list({ repositoryId: REPO_ID })
  assert.equal(list.authenticated, false)
  assert.equal(list.viewer, null)
  const pr = list.pullRequests[0]
  assert.ok(pr !== undefined)
  assert.deepEqual(pr.actions, [{ kind: 'unknown', reason: 'needs-auth' }])
})

test('service list caches per repository for the TTL and refresh bypasses it', async () => {
  let clock = Date.parse('2026-01-03T00:00:00Z')
  let fetches = 0
  const fetchImpl = createFakeFetch(() => {
    fetches += 1
    return { body: graphqlListPayload([graphqlNode()]) }
  })
  const { service, runner } = createServiceHarness({
    fetchImpl,
    env: { GITHUB_TOKEN: 'tok-secret' },
    now: () => new Date(clock),
  })
  const first = await service.list({ repositoryId: REPO_ID })
  assert.equal(fetches, 1)
  assert.equal(runner.calls.length, 1)

  const second = await service.list({ repositoryId: REPO_ID })
  assert.equal(fetches, 1, 'a fresh cache entry performs no provider call')
  assert.equal(runner.calls.length, 1, 'a fresh cache entry does not re-read the remote')
  assert.equal(second.fetchedAt, first.fetchedAt)

  clock += PULL_REQUEST_CACHE_MS + 1
  const third = await service.list({ repositoryId: REPO_ID })
  assert.equal(fetches, 2, 'an expired cache entry refetches')
  assert.notEqual(third.fetchedAt, first.fetchedAt)

  await service.list({ repositoryId: REPO_ID, refresh: true })
  assert.equal(fetches, 3, 'refresh bypasses the cache')
})

test('service maps provider failures to stable API errors without provider text', async () => {
  const unauthorized = createFakeFetch(() => ({
    status: 401,
    headers: { 'x-ratelimit-remaining': '42' },
    body: 'SECRET-PROVIDER-BODY',
  }))
  const ranch = createServiceHarness({ fetchImpl: unauthorized, env: { GITHUB_TOKEN: 'tok-secret' } })
  const authError = await serviceErrorOf(ranch.service.list({ repositoryId: REPO_ID }), 'auth-required')
  assert.ok(!JSON.stringify(authError.toApiError()).includes('tok-secret'))
  assert.ok(!JSON.stringify(authError.toApiError()).includes('SECRET-PROVIDER-BODY'))

  // A 403 with quota left is an authorization failure, not a rate limit, even
  // though GitHub sends `x-ratelimit-reset` on every response.
  const forbiddenButFresh = createFakeFetch(() => ({
    status: 403,
    headers: { 'x-ratelimit-remaining': '42', 'x-ratelimit-reset': '1767225600' },
    body: 'SECRET-PROVIDER-BODY',
  }))
  const freshHarness = createServiceHarness({ fetchImpl: forbiddenButFresh, env: { GITHUB_TOKEN: 'tok-secret' } })
  await serviceErrorOf(freshHarness.service.list({ repositoryId: REPO_ID }), 'auth-required')

  const rateLimited = createFakeFetch(() => ({
    status: 403,
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1767225600' },
    body: 'SECRET-PROVIDER-BODY',
  }))
  const rateHarness = createServiceHarness({ fetchImpl: rateLimited, env: { GITHUB_TOKEN: 'tok-secret' } })
  const rateError = await serviceErrorOf(rateHarness.service.list({ repositoryId: REPO_ID }), 'rate-limited')
  assert.equal(rateError.retryable, true)
  assert.ok((rateError.detail ?? '').includes('2026-01-01T00:00:00.000Z'))

  const graphqlRateLimited = createFakeFetch(() => ({
    body: {
      data: { rateLimit: { remaining: 0, resetAt: '2026-01-01T01:00:00Z' } },
      errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }],
    },
  }))
  const graphqlRateHarness = createServiceHarness({ fetchImpl: graphqlRateLimited, env: { GITHUB_TOKEN: 'tok-secret' } })
  const graphqlRateError = await serviceErrorOf(graphqlRateHarness.service.list({ repositoryId: REPO_ID }), 'rate-limited')
  assert.ok((graphqlRateError.detail ?? '').includes('2026-01-01T01:00:00.000Z'))

  const network = createFakeFetch(() => {
    throw new TypeError('fetch failed: getaddrinfo ENOTFOUND api.github.com')
  })
  const networkHarness = createServiceHarness({ fetchImpl: network, env: { GITHUB_TOKEN: 'tok-secret' } })
  const networkError = await serviceErrorOf(networkHarness.service.list({ repositoryId: REPO_ID }), 'network-unknown')
  assert.equal(networkError.retryable, true)

  const badJson = createFakeFetch(() => ({ body: '{not json' }))
  const badJsonHarness = createServiceHarness({ fetchImpl: badJson, env: { GITHUB_TOKEN: 'tok-secret' } })
  await serviceErrorOf(badJsonHarness.service.list({ repositoryId: REPO_ID }), 'internal')

  // Anonymous 404 means "private or missing"; the Host asks for a token.
  const notFound = createFakeFetch(() => ({ status: 404, body: { message: 'Not Found' } }))
  const notFoundHarness = createServiceHarness({ fetchImpl: notFound, env: {} })
  await serviceErrorOf(notFoundHarness.service.list({ repositoryId: REPO_ID }), 'auth-required')

  // A GraphQL auth error is routed through the same mapping.
  const graphqlForbidden = createFakeFetch(() => ({
    body: { data: null, errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by token' }] },
  }))
  const forbiddenHarness = createServiceHarness({ fetchImpl: graphqlForbidden, env: { GITHUB_TOKEN: 'tok-secret' } })
  const forbiddenError = await serviceErrorOf(forbiddenHarness.service.list({ repositoryId: REPO_ID }), 'auth-required')
  assert.ok(!JSON.stringify(forbiddenError.toApiError()).includes('tok-secret'))

  // An oversized provider body is reported with the contract's dedicated code.
  const tooLarge = createFakeFetch(() => ({
    headers: { 'content-length': String(PROVIDER_MAX_BYTES + 1) },
    body: '{}',
  }))
  const tooLargeHarness = createServiceHarness({ fetchImpl: tooLarge, env: { GITHUB_TOKEN: 'tok-secret' } })
  await serviceErrorOf(tooLargeHarness.service.list({ repositoryId: REPO_ID }), 'output-too-large')
})

test('service rejects repositories without a supported origin remote', async () => {
  const noOrigin = createServiceHarness({ fetchImpl: createFakeFetch(() => ({ body: [] })), origin: null, env: {} })
  await serviceErrorOf(noOrigin.service.list({ repositoryId: REPO_ID }), 'unsupported-remote')

  const unsupported = createServiceHarness({
    fetchImpl: createFakeFetch(() => ({ body: [] })),
    origin: 'https://bitbucket.org/team/repo.git',
    env: {},
  })
  await serviceErrorOf(unsupported.service.list({ repositoryId: REPO_ID }), 'unsupported-remote')

  const unknownRepository = createServiceHarness({ fetchImpl: createFakeFetch(() => ({ body: [] })), env: {} })
  await serviceErrorOf(unknownRepository.service.list({ repositoryId: 'git:c:/other' }), 'unknown-repository')
})

test('service detail validates the pull-request number and truncates the body', async () => {
  const fetchImpl = createFakeFetch(call => {
    if (call.url === GITHUB_GRAPHQL_URL) {
      return { body: graphqlDetailPayload(graphqlNode({ state: 'OPEN', body: 'x'.repeat(8192 + 100) })) }
    }
    return { body: REST_FILES }
  })
  const { service } = createServiceHarness({ fetchImpl, env: { GITHUB_TOKEN: 'tok-secret' } })
  await serviceErrorOf(service.detail({ repositoryId: REPO_ID, number: 0 }), 'invalid-request')
  await serviceErrorOf(service.detail({ repositoryId: REPO_ID, number: 1.5 }), 'invalid-request')

  const detail = await service.detail({ repositoryId: REPO_ID, number: 42 })
  assert.equal(isPullRequestDetail(detail), true)
  assert.equal(detail.truncated, true)
  assert.ok((detail.body ?? '').length > 0)
  assert.ok((detail.body ?? '').length < 8192 + 100)
  assert.ok(detail.warnings?.includes('the pull-request description was truncated'))
  assert.equal(JSON.stringify({ ok: true, value: detail }).includes('tok-secret'), false)
})

test('service dispatches GitLab remotes and keeps the viewer resolution honest', async () => {
  const fetchImpl = createFakeFetch(call => {
    if (call.url.endsWith('/user')) return { body: { username: 'gl-viewer' } }
    return { body: [mergeRequest()] }
  })
  const { service } = createServiceHarness({
    fetchImpl,
    origin: 'https://gitlab.com/group/repo.git',
    env: { GITLAB_TOKEN: 'gl-secret' },
  })
  const list = await service.list({ repositoryId: REPO_ID })
  assert.equal(list.provider, 'gitlab')
  assert.equal(list.host, 'gitlab.com')
  assert.equal(list.remotePath, 'group/repo')
  assert.equal(list.authenticated, true)
  assert.equal(list.viewer, 'gl-viewer')
  assert.equal(list.pullRequests[0]?.provider, 'gitlab')
  const listCall = fetchImpl.calls.find(call => call.url.includes('/merge_requests?'))
  assert.ok(listCall !== undefined)
  assert.equal(listCall.headers['private-token'], 'gl-secret')
})

test('service keeps at most two provider requests in flight', async () => {
  let active = 0
  let maxActive = 0
  const roots: Record<string, string> = {
    'git:c:/fake/one': 'C:\\fake\\one',
    'git:c:/fake/two': 'C:\\fake\\two',
    'git:c:/fake/three': 'C:\\fake\\three',
  }
  const fetchImpl = createFakeFetch(async () => {
    active += 1
    maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, 15))
    active -= 1
    return { body: graphqlListPayload([graphqlNode()]) }
  })
  const { service } = createServiceHarness({
    fetchImpl,
    env: { GITHUB_TOKEN: 'tok-secret' },
    roots,
    origin: 'https://github.com/octo/repo.git',
  })
  const lists = await Promise.all([
    service.list({ repositoryId: 'git:c:/fake/one' }),
    service.list({ repositoryId: 'git:c:/fake/two' }),
    service.list({ repositoryId: 'git:c:/fake/three' }),
  ])
  assert.equal(lists.length, 3)
  assert.ok(maxActive <= 2, `expected at most 2 concurrent provider calls, saw ${maxActive}`)
  assert.equal(fetchImpl.calls.length, 3)
})

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------

test('the service result keeps contract invariants', async () => {
  const fetchImpl = createFakeFetch(() => ({ body: graphqlListPayload([graphqlNode()]) }))
  const { service } = createServiceHarness({ fetchImpl, env: { GITHUB_TOKEN: 'tok-secret' } })
  const list = await service.list({ repositoryId: REPO_ID })
  const pr = list.pullRequests[0]
  assert.ok(pr !== undefined)
  assert.equal(pr.schemaVersion, 1)
  assert.equal(pr.repositoryId, REPO_ID)
  assert.ok(Number.isInteger(pr.number) && pr.number > 0)
  assert.ok(pr.actions.length > 0 && pr.actions.length <= 3)
})
