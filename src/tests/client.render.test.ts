/**
 * Client render smoke tests: the presentational panel renders every required
 * state without throwing, and the stylesheet stays on theme tokens.
 *
 * `react-dom/server` is used deliberately: it exercises the pure view layer
 * (the stateful wrapper only adds effects that need a browser).
 * @module dsh-vcs-timeline/tests/client.render.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChangeSet, Diagnostics, DiffResult, OperationAttempt, OperationPreview, OperationRequest, Repository, VcsEvent, WorkingTreeStatus } from '../shared/contracts.ts'
import { createNoopHandlers, createInitialState, type PanelState } from '../client/types.ts'
import { renderPanelView } from '../client/components.ts'
import {
  createOperationDraft,
  operationParams,
  requestExecute,
  requestPreview,
} from '../client/panel.ts'
import { apiErrorKey } from '../client/format.ts'
import { createTranslator, dictionaries } from '../client/i18n.ts'
import { STYLES } from '../client/styles.ts'
import type { VcsClient } from '../client/api.ts'

const t = createTranslator('zh')

const repository: Repository = {
  schemaVersion: 1,
  id: 'git:c:/fake/repo',
  vcsType: 'git',
  rootPath: 'C:/fake/repo',
  displayName: 'demo-repo',
  currentBranch: 'main',
  currentRevision: 'abcdef0123456789',
  remoteUrls: ['https://example.com/org/repo.git'],
  detectedAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
}

const event: VcsEvent = {
  schemaVersion: 1,
  id: 'commit:git:c:/fake/repo:abcdef',
  repositoryId: repository.id,
  vcsType: 'git',
  eventType: 'commit',
  source: 'repository',
  timestamp: '2026-01-02T03:04:05.000Z',
  actor: 'Alice',
  summary: 'feat: add the timeline panel',
  commitHash: 'abcdef0123456789abcdef0123456789abcdef01',
  parentHashes: ['1234567890abcdef1234567890abcdef12345678'],
  branch: 'main',
}

const diagnostics: Diagnostics = {
  pluginVersion: '0.1.0',
  dshVersion: '0.2.1-rc.3',
  platform: 'win32 x64',
  dataDir: 'C:/Users/test/.dsh/storages/dsh-vcs-timeline',
  gitVersion: 'git version 2.45.1',
  svnVersion: null,
  workspaceCount: 2,
  warnings: ['svn executable not found'],
}

const status: WorkingTreeStatus = {
  repositoryId: repository.id,
  vcsType: 'git',
  clean: false,
  branch: 'main',
  head: 'abcdef0123456789',
  entries: [{ path: 'src/a.ts', status: 'M', worktreeStatus: 'M', staged: true }],
  conflicts: [],
}

const changeSet: ChangeSet = {
  schemaVersion: 1,
  id: `${repository.id}:abcdef`,
  repositoryId: repository.id,
  vcsType: 'git',
  revision: 'abcdef0123456789',
  createdAt: '2026-01-02T03:04:05.000Z',
  files: [
    { path: 'src/a.ts', status: 'modified', additions: 3, deletions: 1 },
    { path: 'assets/logo.png', status: 'added', binary: true },
  ],
}

const attempt: OperationAttempt = {
  schemaVersion: 1,
  id: 'op-0001',
  repositoryId: repository.id,
  vcsType: 'git',
  operation: 'commit',
  state: 'succeeded',
  startedAt: '2026-01-02T03:04:05.000Z',
  finishedAt: '2026-01-02T03:04:09.000Z',
  actor: 'user-via-plugin',
  requestSummary: 'commit 1 staged path(s) on main',
  beforeRevision: '1234567890abcdef',
  afterRevision: 'abcdef0123456789',
  exitCode: 0,
  correlationId: 'corr-1',
  remoteOutcome: 'confirmed-success',
}

const textDiff: DiffResult = {
  repositoryId: repository.id,
  revisionA: null,
  revisionB: 'abcdef0123456789',
  filePath: 'src/a.ts',
  text: 'diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old line\n+new line\n',
  truncated: false,
  binary: false,
  bytes: 60,
}

const binaryDiff: DiffResult = {
  repositoryId: repository.id,
  revisionA: null,
  revisionB: 'abcdef0123456789',
  filePath: 'assets/logo.png',
  text: '',
  truncated: false,
  binary: true,
  bytes: 0,
}

/** A stub Host client: the view layer never calls it during render. */
const api = new Proxy({}, {
  get() {
    return async () => ({ ok: true as const, value: null })
  },
}) as unknown as VcsClient

function render(overrides: Partial<PanelState>): string {
  const state: PanelState = { ...createInitialState(), ...overrides }
  return renderToStaticMarkup(renderPanelView({
    state,
    deps: { api, t, locale: 'zh-CN', styles: STYLES },
    handlers: createNoopHandlers(),
  }))
}

function readyState(overrides: Partial<PanelState> = {}): PanelState {
  const base = createInitialState()
  return {
    ...base,
    boot: 'ready',
    repositories: [repository],
    diagnostics,
    selectedRepositoryId: repository.id,
    status,
    timeline: { ...base.timeline, events: [event], hasMore: false },
    ...overrides,
  }
}

test('the initial loading state renders a stylesheet and no undefined text', () => {
  const html = render({})
  assert.ok(html.includes('<style'))
  assert.ok(html.includes('dvt-'))
  assert.ok(!html.includes('>undefined<'))
})

test('a boot error renders the localized cause and a retry action', () => {
  const error = { code: 'vcs-not-installed' as const, message: 'git is missing' }
  const html = render({ boot: 'error', bootError: error })
  assert.ok(html.includes(t(apiErrorKey(error))))
  assert.ok(html.includes('dvt-'))
})

test('the empty repository list renders without throwing', () => {
  const html = render({ boot: 'ready', repositories: [], diagnostics, noWorkspace: true })
  assert.ok(html.length > 200)
  assert.ok(!html.includes('>undefined<'))
})

test('a ready timeline renders the event summary, author and repository', () => {
  const html = render(readyState())
  assert.ok(html.includes('feat: add the timeline panel'))
  assert.ok(html.includes('Alice'))
  assert.ok(html.includes('demo-repo'))
  assert.ok(html.includes('git version 2.45.1'))
})

test('the empty history state renders its localized message', () => {
  const html = render(readyState({
    timeline: { ...createInitialState().timeline, events: [], hasMore: false },
  }))
  assert.ok(html.includes(dictionaries.zh['timeline.empty'] as string))
})

test('an event detail renders its changed files', () => {
  const html = render(readyState({
    changeSet: { event, revision: changeSet.revision, data: changeSet, loading: false, error: null },
  }))
  assert.ok(html.includes('src/a.ts'))
  assert.ok(html.includes('assets/logo.png'))
})

test('a binary diff renders the binary notice instead of text', () => {
  const html = render(readyState({
    changeSet: { event, revision: changeSet.revision, data: changeSet, loading: false, error: null },
    diff: { filePath: 'assets/logo.png', data: binaryDiff, loading: false, error: null },
  }))
  assert.ok(html.includes(dictionaries.zh['diff.binary'] as string))
})

test('a text diff renders added and removed lines with distinct classes', () => {
  const html = render(readyState({
    changeSet: { event, revision: changeSet.revision, data: changeSet, loading: false, error: null },
    diff: { filePath: 'src/a.ts', data: textDiff, loading: false, error: null },
  }))
  assert.ok(html.includes('new line'))
  assert.ok(html.includes('old line'))
  assert.ok(/dvt-diff-(add|del)/.test(html))
})

test('the audit view renders operation rows and the empty state', () => {
  const withOperations = render(readyState({
    source: 'audit',
    audit: { ...createInitialState().audit, operations: [attempt], loading: false, hasMore: false },
  }))
  assert.ok(withOperations.includes('dvt-list-item'))
  assert.ok(withOperations.includes('demo-repo'))
  assert.ok(!withOperations.includes('>undefined<'))

  const empty = render(readyState({
    source: 'audit',
    audit: { ...createInitialState().audit, operations: [], loading: false, hasMore: false },
  }))
  assert.ok(empty.includes(dictionaries.zh['audit.empty'] as string))
})

test('an audit detail renders the attempt fields', () => {
  const html = render(readyState({
    source: 'audit',
    audit: { ...createInitialState().audit, operations: [attempt], loading: false, hasMore: false, selected: attempt },
  }))
  assert.ok(html.includes('corr-1'))
  assert.ok(html.includes('commit 1 staged path(s) on main'))
})

test('a partial timeline renders its warning', () => {
  const html = render(readyState({
    timeline: {
      ...createInitialState().timeline,
      events: [event],
      partial: true,
      warnings: ['repository is larger than the scan bound'],
    },
  }))
  assert.ok(html.includes('repository is larger than the scan bound') || html.includes('dvt-warn'))
})

test('the operation dialog appears only with a dialog state', () => {
  assert.ok(!render(readyState()).includes('role="dialog"'))

  const dialog = render(readyState({
    dialog: {
      operation: 'commit',
      phase: 'previewed',
      preview: {
        repositoryId: repository.id,
        operation: 'commit',
        allowed: true,
        summary: 'commit 1 staged path(s) on main',
        argv: ['git', '--no-pager', 'commit', '-m', 'msg'],
        before: { branch: 'main', head: 'abcdef', clean: true, stagedFiles: ['src/a.ts'] },
        warnings: ['the working tree has uncommitted changes'],
        confirmationToken: 'token',
        expiresAt: '2026-01-02T03:06:05.000Z',
      },
      previewError: null,
      executeError: null,
      result: null,
      message: 'msg',
      remote: 'origin',
      branch: 'main',
    },
  }))
  assert.ok(dialog.includes('role="dialog"'))
  assert.ok(dialog.includes('commit 1 staged path(s) on main'))
})

test('the stylesheet uses theme tokens only, with no literal colors and no global selectors', () => {
  assert.ok(STYLES.length > 1_000)
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(STYLES), 'no literal hex colors')
  assert.ok(!/\brgba?\(/.test(STYLES), 'no literal rgb()/rgba() colors')
  assert.ok(!/\b(?:body|html|:root)\s*\{/.test(STYLES), 'no global selectors')
  assert.ok(STYLES.includes('--dsw-alias-'))
  assert.ok(STYLES.includes('.dvt-'))
})

test('the zh and en dictionaries are complete and non-empty', () => {
  const keys = Object.keys(dictionaries.zh)
  assert.ok(keys.length > 50)
  for (const key of keys) {
    assert.notEqual(String(dictionaries.zh[key]).trim(), '', `empty zh value for ${key}`)
    assert.notEqual(String(dictionaries.en[key]).trim(), '', `empty en value for ${key}`)
  }
})

test('the commit message field renders before a preview exists, so a blocked preview is correctable', () => {
  const previewing = render(readyState({
    dialog: {
      operation: 'commit',
      phase: 'previewing',
      preview: null,
      previewError: null,
      executeError: null,
      result: null,
      message: '',
      remote: 'origin',
      branch: 'main',
    },
  }))
  assert.ok(previewing.includes('id="dvt-commit-message"'), 'the textarea exists while the first preview is in flight')
  assert.ok(!previewing.includes(t('op.confirm')), 'no execute action before a preview exists')

  const blocked = render(readyState({
    dialog: {
      operation: 'commit',
      phase: 'blocked',
      preview: {
        repositoryId: repository.id,
        operation: 'commit',
        allowed: false,
        blockedReason: 'a commit message is required',
        summary: 'commit the staged changes',
        argv: [],
        before: { branch: 'main', clean: false, stagedFiles: ['src/a.ts'] },
        warnings: [],
        confirmationToken: '',
        expiresAt: '',
      },
      previewError: null,
      executeError: null,
      result: null,
      message: '',
      remote: 'origin',
      branch: 'main',
    },
  }))
  assert.ok(blocked.includes('id="dvt-commit-message"'), 'the textarea exists in the blocked phase')
  assert.ok(blocked.includes('a commit message is required'), 'the blocked reason is rendered')
  assert.ok(blocked.includes(t('op.repreview')), 're-preview is offered for a blocked preview')
  assert.ok(!blocked.includes(t('op.confirm')), 'a blocked preview offers no execute action')
})

test('the push remote and branch fields render before a preview exists', () => {
  const html = render(readyState({
    dialog: {
      operation: 'push',
      phase: 'previewing',
      preview: null,
      previewError: null,
      executeError: null,
      result: null,
      message: '',
      remote: 'origin',
      branch: 'main',
    },
  }))
  assert.ok(html.includes('id="dvt-push-remote"'))
  assert.ok(html.includes('id="dvt-push-branch"'))
})

test('re-previewing the same operation preserves the typed message and push target', () => {
  const typed = { operation: 'commit' as const, message: 'fix: keep me', remote: 'origin', branch: 'main' }
  const sameOperation = createOperationDraft('commit', repository, typed)
  assert.equal(sameOperation.message, 'fix: keep me')
  assert.deepEqual(operationParams(sameOperation), { message: 'fix: keep me' })

  const push = createOperationDraft('push', repository, typed)
  assert.equal(push.message, '', 'a different operation does not inherit the commit message')
  assert.equal(push.remote, 'origin')
  assert.equal(push.branch, 'main')
  assert.deepEqual(operationParams(push), { remote: 'origin', branch: 'main' })
})

test('the preview request carries the typed commit message and execute reuses identical params', async () => {
  const calls: OperationRequest[] = []
  const previewFixture: OperationPreview = {
    repositoryId: repository.id,
    operation: 'commit',
    allowed: true,
    summary: 'commit 1 staged path(s) on main',
    argv: ['git', 'commit', '-m', 'fix: keep me'],
    before: { branch: 'main', clean: false, stagedFiles: ['src/a.ts'] },
    warnings: [],
    confirmationToken: 'token-1',
    expiresAt: '2026-01-02T03:06:05.000Z',
  }
  const recordingApi = {
    previewOperation: async (request: OperationRequest) => {
      calls.push(request)
      return { ok: true as const, value: previewFixture }
    },
    executeOperation: async (request: OperationRequest) => {
      calls.push(request)
      return { ok: true as const, value: attempt }
    },
  } as unknown as VcsClient

  const draft = { operation: 'commit' as const, message: 'fix: keep me', remote: 'origin', branch: 'main' }
  const previewResult = await requestPreview(recordingApi, repository.id, draft)
  assert.equal(previewResult.ok, true)
  const executeResult = await requestExecute(recordingApi, repository.id, draft, 'token-1')
  assert.equal(executeResult.ok, true)

  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0]?.params, { message: 'fix: keep me' }, 'the preview body carries the typed message')
  assert.equal(calls[0]?.operation, 'commit')
  assert.deepEqual(calls[1]?.params, calls[0]?.params, 'execute re-sends the exact params the token was bound to')
  assert.equal(calls[1]?.confirmationToken, 'token-1')
})

