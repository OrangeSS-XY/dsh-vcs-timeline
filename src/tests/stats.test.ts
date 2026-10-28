/**
 * Host hotspot statistics tests: the window aggregation and its ranking, the
 * two-stream git read, the SVN refusal, the empty repository answer, the
 * in-process cache, and the stable error codes.
 *
 * Everything here is hermetic: the runner is scripted, so no real repository is
 * touched and no command ever runs. Fixtures are built in the exact framing the
 * production parsers consume (`\x01<hash>` commit tokens, NUL-separated
 * numstat records, four NUL-separated metadata fields per commit).
 * @module dsh-vcs-timeline/tests/stats.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { HotspotQuery, Repository } from '../shared/contracts.ts'
import { DEFAULT_HOTSPOT_COMMITS, HOTSPOT_CACHE_MS, isHotspotReport, MAX_HOTSPOT_FILES } from '../shared/contracts.ts'
import type { NumstatEntry } from '../host/adapters/git/commands.ts'
import type { Runner, VcsAdapter } from '../host/adapters/types.ts'
import type { RepositoryResolver, ServiceError as ServiceErrorType } from '../host/services/timeline-service.ts'
import {
  aggregateHotspots,
  MAX_HOTSPOT_COMMITS,
  parseHotspotMetaZ,
  type HotspotCommitMeta,
} from '../host/stats/hotspots.ts'
import { createStatsService } from '../host/stats/service.ts'
import { createFakeAdapter, createFakeRunner } from './helpers.ts'

const HASH_A = 'a'.repeat(40)
const HASH_B = 'b'.repeat(40)
const HASH_C = 'c'.repeat(40)
const NOW = new Date('2026-02-03T04:05:06.000Z')

/** A git repository record used by the statistics tests. */
function makeRepository(overrides: Partial<Repository> = {}): Repository {
  return {
    schemaVersion: 1,
    id: 'git:c:/fake/repo',
    vcsType: 'git',
    rootPath: 'C:/fake/repo',
    displayName: 'repo',
    currentBranch: 'feature',
    detectedAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Resolver returning exactly one repository. */
function createStubResolver(repository: Repository): RepositoryResolver {
  const git = createFakeAdapter()
  const svn = createFakeAdapter({ vcsType: 'svn' })
  const pick = (): VcsAdapter => (repository.vcsType === 'git' ? git : svn)
  return {
    adapters: { git, svn },
    async resolve(id) {
      if (id !== repository.id) {
        return { ok: false, error: { code: 'unknown-repository', message: 'unknown repository id' } }
      }
      return { ok: true, value: { repository, root: repository.rootPath, adapter: pick() } }
    },
  }
}

/** Build the statistics service over a stub resolver and a scripted runner. */
function makeService(
  repository: Repository,
  runner: Runner,
  now: () => Date = () => NOW,
): ReturnType<typeof createStatsService> {
  return createStatsService({ resolver: createStubResolver(repository), runner, now })
}

/** One commit record of the metadata stream (`%H%x00%an%x00%aI%x00%P`). */
function metaStream(commits: ReadonlyArray<{ hash: string; author: string; date: string; parents?: string }>): string {
  return commits
    .map(commit => [commit.hash, commit.author, commit.date, commit.parents ?? ''].join('\u0000'))
    .join('\u0000') + '\u0000'
}

/** One commit's numstat records (`\x01<hash>` then NUL-separated file lines). */
function numstatStream(commits: ReadonlyArray<{ hash: string; lines: readonly string[] }>): string {
  const tokens: string[] = []
  for (const commit of commits) {
    tokens.push(`\u0001${commit.hash}`)
    let first = true
    for (const line of commit.lines) {
      // git separates the format output from the first numstat record with a
      // newline, so the newline rides on the following token.
      tokens.push(first ? `\n${line}` : line)
      first = false
    }
  }
  return `${tokens.join('\u0000')}\u0000`
}

/** Three commits: A newest, C oldest; a.txt is the churn leader. */
const HISTORY_META = metaStream([
  { hash: HASH_A, author: 'Ada Lovelace', date: '2026-01-03T00:00:00Z' },
  { hash: HASH_B, author: 'Bob', date: '2026-01-02T00:00:00Z' },
  { hash: HASH_C, author: 'Cara', date: '2026-01-01T00:00:00Z' },
])

const HISTORY_NUMSTAT = numstatStream([
  { hash: HASH_A, lines: ['5\t1\ta.txt', '2\t0\tb.txt'] },
  { hash: HASH_B, lines: ['1\t1\ta.txt', '-\t-\tbin.dat'] },
  { hash: HASH_C, lines: ['1\t0\tc.txt', '-\t-\tbin.dat'] },
])

/** Scripted runner answering the two history streams of the fixture window. */
function historyRunner(options: { meta?: string; numstat?: string } = {}): Runner & { calls: Array<{ argv: readonly string[]; cwd: string }> } {
  return createFakeRunner((argv) => {
    const text = argv.join(' ')
    if (text.includes('--numstat')) return { exitCode: 0, stdout: options.numstat ?? HISTORY_NUMSTAT, stderr: '' }
    return { exitCode: 0, stdout: options.meta ?? HISTORY_META, stderr: '' }
  })
}

/** Join argv for readable matching in a scripted runner. */
function argvText(argv: readonly string[]): string {
  return argv.join(' ')
}

// ---------------------------------------------------------------------------
// A. Window aggregation
// ---------------------------------------------------------------------------

test('stats: the two streams of one window aggregate into a ranked, limited report', async () => {
  const repository = makeRepository()
  const runner = historyRunner()
  const service = makeService(repository, runner, () => NOW)
  const report = await service.hotspots({ repositoryId: repository.id })

  assert.equal(isHotspotReport(report), true)
  assert.equal(report.repositoryId, repository.id)
  assert.equal(report.vcsType, 'git')
  assert.equal(report.available, true)
  assert.equal(report.unsupportedReason, undefined)
  assert.equal(report.scannedCommits, 3)
  assert.equal(report.truncated, false)
  assert.equal(report.cached, false)
  assert.equal(report.computedAt, NOW.toISOString())
  assert.equal(report.warnings, undefined)
  assert.deepEqual(report.scope, {
    branch: 'feature',
    mergesIncluded: true,
    since: new Date('2026-01-01T00:00:00Z').toISOString(),
    windowCommits: DEFAULT_HOTSPOT_COMMITS,
  })

  // The chart buckets are real: one bucket per UTC day, newest first, and the
  // commits they report add up to the scanned window.
  assert.ok(report.daily.length > 0)
  assert.equal(report.daily.reduce((sum, day) => sum + day.commits, 0), 3)
  assert.deepEqual(
    report.daily.map(day => day.date),
    [...report.daily.map(day => day.date)].sort((x, y) => y.localeCompare(x)),
  )
  for (const day of report.daily) {
    assert.match(day.date, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(day.files >= 0)
  }

  // churn 8 > 2 > 1 > unknown.
  assert.deepEqual(report.files.map(file => file.path), ['a.txt', 'b.txt', 'c.txt', 'bin.dat'])
  const [a, b, c, binary] = report.files
  assert.deepEqual(a, {
    path: 'a.txt',
    commits: 2,
    additions: 6,
    deletions: 2,
    churn: 8,
    authors: ['Ada Lovelace', 'Bob'],
    authorCount: 2,
    lastChangedAt: new Date('2026-01-03T00:00:00Z').toISOString(),
    lastAuthor: 'Ada Lovelace',
  })
  assert.deepEqual(b, {
    path: 'b.txt',
    commits: 1,
    additions: 2,
    deletions: 0,
    churn: 2,
    authors: ['Ada Lovelace'],
    authorCount: 1,
    lastChangedAt: new Date('2026-01-03T00:00:00Z').toISOString(),
    lastAuthor: 'Ada Lovelace',
  })
  assert.equal(c?.churn, 1)
  assert.equal(c?.lastAuthor, 'Cara')
  assert.deepEqual(binary, {
    path: 'bin.dat',
    commits: 2,
    churn: null,
    authors: ['Bob', 'Cara'],
    authorCount: 2,
    lastChangedAt: new Date('2026-01-02T00:00:00Z').toISOString(),
    lastAuthor: 'Bob',
  })

  // Both invocations describe the same window, and the window asks for one
  // extra commit so `truncated` is a fact instead of a guess.
  assert.equal(runner.calls.length, 2)
  const numstatCall = runner.calls[0]?.argv ?? []
  const metaCall = runner.calls[1]?.argv ?? []
  for (const argv of [numstatCall, metaCall]) {
    assert.ok(argv.includes('--no-color'))
    assert.ok(argv.includes('-z'))
    assert.ok(argv.includes('--date-order'))
    assert.ok(argv.includes(`--max-count=${DEFAULT_HOTSPOT_COMMITS + 1}`))
  }
  assert.ok(numstatCall.includes('--numstat'))
  assert.ok(numstatCall.includes('--format=%x01%H'))
  assert.ok(metaCall.includes('--format=%H%x00%an%x00%aI%x00%P'))
  assert.equal(numstatCall.includes('--numstat'), true)
  assert.equal(argvText(runner.calls[0]?.argv ?? []).includes('core.quotepath=false'), true)
})

test('stats: a file whose every record is binary keeps its churn unknown', async () => {
  const repository = makeRepository()
  const meta = metaStream([{ hash: HASH_A, author: 'Ada Lovelace', date: '2026-01-03T00:00:00Z' }])
  const numstat = numstatStream([{ hash: HASH_A, lines: ['-\t-\timage.png'] }])
  const report = await makeService(repository, historyRunner({ meta, numstat })).hotspots({ repositoryId: repository.id })

  const file = report.files[0]
  assert.ok(file !== undefined)
  assert.equal(file.path, 'image.png')
  assert.equal(file.commits, 1)
  assert.equal(file.churn, null)
  assert.equal(file.additions, undefined)
  assert.equal(file.deletions, undefined)
  assert.deepEqual(file.authors, ['Ada Lovelace'])
  assert.equal(report.scannedCommits, 1)
  assert.equal(report.truncated, false)
})

test('stats: the extra probe commit makes truncated exact without widening the ranking', async () => {
  const repository = makeRepository()
  const runner = historyRunner()
  const report = await makeService(repository, runner).hotspots({ repositoryId: repository.id, maxCommits: 2 })

  // The window allowed two commits and one probe commit was requested.
  assert.ok(runner.calls[0]?.argv.includes('--max-count=3'))
  assert.ok(runner.calls[1]?.argv.includes('--max-count=3'))
  assert.equal(report.truncated, true)
  assert.equal(report.scannedCommits, 2)
  assert.equal(report.scope.windowCommits, 2)
  // The probe commit (C) is not part of the ranking.
  assert.deepEqual(report.files.map(file => file.path), ['a.txt', 'b.txt', 'bin.dat'])
  assert.ok(!report.files.some(file => file.path === 'c.txt'))
  assert.equal(report.scope.since, new Date('2026-01-02T00:00:00Z').toISOString())
})

test('stats: the commit window is clamped between 1 and the supported maximum', async () => {
  const repository = makeRepository()

  const wideRunner = historyRunner()
  await makeService(repository, wideRunner).hotspots({ repositoryId: repository.id, maxCommits: 99_999 })
  assert.ok(wideRunner.calls[0]?.argv.includes(`--max-count=${MAX_HOTSPOT_COMMITS + 1}`))

  const narrowRunner = historyRunner()
  const narrow = await makeService(repository, narrowRunner).hotspots({ repositoryId: repository.id, maxCommits: 0 })
  assert.ok(narrowRunner.calls[0]?.argv.includes('--max-count=2'))
  assert.equal(narrow.scope.windowCommits, 1)
  assert.equal(narrow.scannedCommits, 1)
  assert.equal(narrow.truncated, true)
})

test('stats: the row limit defaults to 30 and never exceeds MAX_HOTSPOT_FILES', async () => {
  const repository = makeRepository()
  const paths = Array.from({ length: 120 }, (_, index) => `f${String(index).padStart(3, '0')}.txt`)
  const meta = metaStream([{ hash: HASH_A, author: 'Ada Lovelace', date: '2026-01-03T00:00:00Z' }])
  const numstat = numstatStream([{ hash: HASH_A, lines: paths.map((path, index) => `${index + 1}\t0\t${path}`) }])
  const service = makeService(repository, historyRunner({ meta, numstat }))

  const wide = await service.hotspots({ repositoryId: repository.id, limit: 500 })
  assert.equal(wide.files.length, MAX_HOTSPOT_FILES)
  assert.equal(wide.files[0]?.path, 'f119.txt')
  assert.equal(wide.files[0]?.churn, 120)

  const zero = await service.hotspots({ repositoryId: repository.id, limit: 0 })
  assert.equal(zero.files.length, 1)
  assert.equal(zero.files[0]?.path, 'f119.txt')
})

test('stats: churn ties fall back to commit count, then to path order', () => {
  const commits: HotspotCommitMeta[] = [
    { hash: HASH_A, author: 'Ada Lovelace', authorDate: '2026-01-03T00:00:00.000Z', parents: [] },
    { hash: HASH_B, author: 'Bob', authorDate: '2026-01-02T00:00:00.000Z', parents: [HASH_A] },
  ]
  const numstat = new Map<string, NumstatEntry[]>([
    [HASH_A, [
      { path: 'z.txt', additions: 2, deletions: 0, binary: false },
      { path: 'a.txt', additions: 2, deletions: 0, binary: false },
      { path: 'b.txt', additions: 1, deletions: 0, binary: false },
    ]],
    [HASH_B, [
      { path: 'b.txt', additions: 1, deletions: 0, binary: false },
      { path: 'm.txt', additions: 0, deletions: 0, binary: false },
    ]],
  ])

  const result = aggregateHotspots({ commits, numstat, windowCommits: 2, limit: 10 })
  // b.txt: churn 2 over 2 commits; a.txt and z.txt: churn 2 over 1 commit each,
  // path order decides; m.txt: churn 0.
  assert.deepEqual(result.files.map(file => file.path), ['b.txt', 'a.txt', 'z.txt', 'm.txt'])
  assert.equal(result.scannedCommits, 2)
  assert.equal(result.truncated, false)
  assert.equal(result.since, '2026-01-02T00:00:00.000Z')
  assert.equal(result.files[0]?.commits, 2)
})

test('stats: the metadata stream parses hash, author, date and parents', () => {
  const stream = metaStream([
    { hash: HASH_A, author: 'Ada Lovelace', date: '2026-01-03T10:00:00+08:00', parents: `${HASH_B} ${HASH_C}` },
    { hash: HASH_B, author: 'Bob', date: 'not-a-date' },
    { hash: HASH_C, author: '', date: '2026-01-01T00:00:00Z' },
  ])
  const commits = parseHotspotMetaZ(stream)
  assert.equal(commits.length, 3)
  assert.equal(commits[0]?.hash, HASH_A)
  assert.equal(commits[0]?.author, 'Ada Lovelace')
  assert.equal(commits[0]?.authorDate, new Date('2026-01-03T10:00:00+08:00').toISOString())
  assert.deepEqual(commits[0]?.parents, [HASH_B, HASH_C])
  assert.equal(commits[1]?.authorDate, undefined)
  assert.deepEqual(commits[1]?.parents, [])
  assert.equal(commits[2]?.author, '')
  assert.equal(commits[2]?.authorDate, new Date('2026-01-01T00:00:00Z').toISOString())
  // An untrusted stream never throws.
  assert.deepEqual(parseHotspotMetaZ(''), [])
  assert.deepEqual(parseHotspotMetaZ('\u0000\u0000'), [])
})

// ---------------------------------------------------------------------------
// B. Unavailable and empty repositories
// ---------------------------------------------------------------------------

test('stats: SVN is unavailable with a stable reason and runs no command', async () => {
  const repository = makeRepository({
    id: 'svn:c:/fake/wc',
    vcsType: 'svn',
    rootPath: 'C:/fake/wc',
    currentBranch: 'trunk',
  })
  const runner = createFakeRunner(() => {
    throw new Error('no command should run for SVN')
  })
  const report = await makeService(repository, runner).hotspots({ repositoryId: repository.id })

  assert.equal(isHotspotReport(report), true)
  assert.equal(report.repositoryId, repository.id)
  assert.equal(report.vcsType, 'svn')
  assert.equal(report.available, false)
  assert.equal(report.unsupportedReason, 'svn-history-line-stats-unsupported')
  assert.deepEqual(report.files, [])
  assert.equal(report.scannedCommits, 0)
  assert.equal(report.truncated, false)
  assert.equal(report.computedAt, NOW.toISOString())
  assert.equal(report.scope.branch, 'trunk')
  assert.equal(report.scope.windowCommits, DEFAULT_HOTSPOT_COMMITS)
  assert.equal(runner.calls.length, 0)
})

test('stats: an empty repository is available, empty and explains itself', async () => {
  const repository = makeRepository({ currentBranch: undefined })
  const runner = createFakeRunner(() => ({
    exitCode: 128,
    stdout: '',
    stderr: "fatal: your current branch 'main' does not have any commits yet",
  }))
  const report = await makeService(repository, runner).hotspots({ repositoryId: repository.id })

  assert.equal(isHotspotReport(report), true)
  assert.equal(report.available, true)
  assert.deepEqual(report.files, [])
  assert.equal(report.scannedCommits, 0)
  assert.equal(report.truncated, false)
  assert.equal(report.cached, false)
  assert.equal(report.scope.branch, null)
  assert.equal(report.scope.mergesIncluded, true)
  assert.ok((report.warnings ?? []).some(warning => /no commits yet/.test(warning)))
  assert.equal(runner.calls.length, 2)
})

// ---------------------------------------------------------------------------
// C. Cache
// ---------------------------------------------------------------------------

test('stats: a cache hit answers from the cache and a caller cannot corrupt it', async () => {
  let clock = new Date('2026-02-03T04:05:06.000Z')
  const repository = makeRepository()
  const runner = historyRunner()
  const service = makeService(repository, runner, () => clock)

  const first = await service.hotspots({ repositoryId: repository.id })
  assert.equal(first.cached, false)
  const second = await service.hotspots({ repositoryId: repository.id })
  assert.equal(second.cached, true)
  assert.equal(second.computedAt, first.computedAt)
  assert.equal(runner.calls.length, 2)
  assert.notEqual(second, first)
  assert.notEqual(second.files[0], first.files[0])

  // Mutating the returned copy must not poison the cached ranking.
  const mutated = second.files[0]
  assert.ok(mutated !== undefined)
  mutated.authors.push('Intruder')
  const third = await service.hotspots({ repositoryId: repository.id })
  assert.equal(third.cached, true)
  assert.deepEqual(third.files[0]?.authors, ['Ada Lovelace', 'Bob'])
  assert.equal(runner.calls.length, 2)

  // A different window is a different cache entry.
  clock = new Date('2026-02-03T04:06:00.000Z')
  const narrow = await service.hotspots({ repositoryId: repository.id, limit: 2 })
  assert.equal(narrow.cached, false)
  assert.equal(narrow.files.length, 2)
  assert.equal(runner.calls.length, 4)

  // After the TTL the same key is recomputed instead of answering stale data.
  clock = new Date(first.computedAt)
  clock = new Date(clock.getTime() + HOTSPOT_CACHE_MS + 1)
  const resumed = await service.hotspots({ repositoryId: repository.id })
  assert.equal(resumed.cached, false)
  assert.equal(runner.calls.length, 6)
})

// ---------------------------------------------------------------------------
// D. Errors
// ---------------------------------------------------------------------------

test('stats: a missing client, a timeout and a failed read are stable errors', async () => {
  const repository = makeRepository()

  const missing = createFakeRunner(() => ({ exitCode: null, stdout: '', stderr: '', spawnFailed: true, failureMessage: 'ENOENT git' }))
  await assert.rejects(
    async () => makeService(repository, missing).hotspots({ repositoryId: repository.id }),
    (error: unknown) => (error as ServiceErrorType).code === 'vcs-not-installed',
  )

  const timedOut = createFakeRunner(() => ({ exitCode: null, stdout: '', stderr: '', timedOut: true }))
  await assert.rejects(
    async () => makeService(repository, timedOut).hotspots({ repositoryId: repository.id }),
    (error: unknown) => (error as ServiceErrorType).code === 'timeout',
  )

  const failed = createFakeRunner(() => ({ exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' }))
  await assert.rejects(
    async () => makeService(repository, failed).hotspots({ repositoryId: repository.id }),
    (error: unknown) => (error as ServiceErrorType).code === 'operation-failed',
  )
})

test('stats: an unknown repository fails through the gated resolver', async () => {
  const repository = makeRepository()
  const service = makeService(repository, historyRunner())
  await assert.rejects(
    async () => service.hotspots({ repositoryId: 'git:c:/elsewhere' }),
    (error: unknown) => (error as ServiceErrorType).code === 'unknown-repository',
  )
})

test('stats: a non-object query is rejected before resolution', async () => {
  const repository = makeRepository()
  const runner = historyRunner()
  const service = makeService(repository, runner)
  await assert.rejects(
    async () => service.hotspots(null as unknown as HotspotQuery),
    (error: unknown) => (error as ServiceErrorType).code === 'invalid-request',
  )
  assert.equal(runner.calls.length, 0)
})
