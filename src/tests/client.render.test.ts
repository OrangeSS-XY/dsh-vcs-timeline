/**
 * Client render smoke tests for the IDE-style panel.
 *
 * `react-dom/server` is used deliberately: it exercises the pure view layer
 * (the stateful wrapper only adds effects that need a browser), so a crashing
 * view or a broken state branch fails here instead of blanking the slot.
 * @module dsh-vcs-timeline/tests/client.render.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  ChangeSet,
  Diagnostics,
  DiffResult,
  OperationAttempt,
  Repository,
  VcsEvent,
  WorkingTreeStatus,
} from '../shared/contracts.ts'
import { createInitialState, createNoopHandlers, type PanelState } from '../client/types.ts'
import { renderPanelView } from '../client/components.ts'
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
  currentRevision: 'abcdef0123456789abcdef0123456789abcdef01',
  remoteUrls: ['https://example.com/org/repo.git'],
  detectedAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
}

const svnRepository: Repository = {
  ...repository,
  id: 'svn:c:/fake/svn-wc',
  vcsType: 'svn',
  displayName: 'svn-wc',
  currentRevision: '42',
  currentBranch: undefined,
}

const event: VcsEvent = {
  schemaVersion: 1,
  id: 'commit:abcdef',
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
  metadata: { filesChanged: 3, additions: 12, deletions: 4, binaryFiles: 1 },
}

const mergeEvent: VcsEvent = {
  ...event,
  id: 'commit:merge',
  summary: 'Merge branch feature',
  commitHash: 'fedcba9876543210fedcba9876543210fedcba98',
  parentHashes: ['1234567890abcdef', 'abcdef0123456789'],
  metadata: { filesChanged: 0, additions: 0, deletions: 0 },
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
  entries: [
    { path: 'src/a.ts', status: 'M', worktreeStatus: 'M', staged: true },
    { path: 'src/b.ts', status: 'M', worktreeStatus: 'M' },
  ],
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
    { path: 'src/components/a.ts', status: 'modified', additions: 12, deletions: 4 },
    { path: 'assets/logo.png', status: 'added', binary: true },
    { path: 'src/renamed.ts', oldPath: 'src/old.ts', status: 'renamed', additions: 2, deletions: 2 },
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

const unknownAttempt: OperationAttempt = {
  ...attempt,
  id: 'op-0002',
  operation: 'push',
  state: 'unknown',
  remoteOutcome: 'unknown',
  correlationId: 'corr-2',
}

const textDiff: DiffResult = {
  repositoryId: repository.id,
  revisionA: null,
  revisionB: 'abcdef0123456789',
  filePath: 'src/components/a.ts',
  text: 'diff --git a/src/components/a.ts b/src/components/a.ts\nindex 111..222 100644\n--- a/src/components/a.ts\n+++ b/src/components/a.ts\n@@ -10,3 +10,4 @@\n context line\n-removed line\n+added line\n+second added\n',
  truncated: false,
  binary: false,
  bytes: 240,
}

const binaryDiff: DiffResult = {
  ...textDiff,
  filePath: 'assets/logo.png',
  text: '',
  binary: true,
  bytes: 0,
}

/** A stub Host client: the view layer never calls it during render. */
const api = new Proxy({}, {
  get() {
    return async () => ({ ok: true as const, value: null })
  },
}) as unknown as VcsClient

/** Render the panel including its inline stylesheet. */
function renderFull(overrides: Partial<PanelState>): string {
  const state: PanelState = { ...createInitialState(), ...overrides }
  return renderToStaticMarkup(renderPanelView({
    state,
    deps: { api, t, locale: 'zh-CN', styles: STYLES },
    handlers: createNoopHandlers(),
  }))
}

/**
 * Render without the `<style>` block: class names also occur in the
 * stylesheet text, so DOM-shaped assertions must look at markup alone.
 */
function render(overrides: Partial<PanelState>): string {
  return renderFull(overrides).replace(/<style[\s\S]*?<\/style>/g, '')
}

function ready(overrides: Partial<PanelState> = {}): PanelState {
  const base = createInitialState()
  return {
    ...base,
    boot: 'ready',
    repositories: [repository],
    diagnostics,
    selectedRepositoryId: repository.id,
    status,
    timeline: { ...base.timeline, events: [event] },
    ...overrides,
  }
}

test('the loading state renders skeleton rows and the stylesheet, never undefined text', () => {
  const full = renderFull({ boot: 'loading' })
  assert.ok(full.includes('<style'))
  assert.ok(full.includes('--dsw-alias-bg-base'))
  const html = render({ boot: 'loading' })
  assert.ok(html.includes('dvt-skeleton'))
  assert.ok(html.includes('aria-busy="true"'))
  assert.ok(html.includes('dvt-toolbar'))
  assert.ok(!html.includes('>undefined<'))
})

test('a boot failure renders the localized cause with a retry action', () => {
  const html = render({ boot: 'error', bootError: { code: 'vcs-not-installed', message: 'git is missing' } })
  assert.ok(html.includes(t('state.error.title')))
  assert.ok(html.includes(t('error.vcs-not-installed')))
  assert.ok(html.includes(t('common.retry')))
})

test('no workspace and no repositories render two distinct states', () => {
  const noWorkspace = render({ boot: 'ready', repositories: [], noWorkspace: true, diagnostics })
  assert.ok(noWorkspace.includes(t('state.noWorkspace.title')))
  assert.ok(!noWorkspace.includes(t('state.noRepositories.title')))

  const noRepos = render({ boot: 'ready', repositories: [], noWorkspace: false, diagnostics })
  assert.ok(noRepos.includes(t('state.noRepositories.title')))
  assert.ok(noRepos.includes(t('common.refresh')))
})

test('the toolbar renders the repository, its VCS badge and the branch chip', () => {
  const html = render(ready())
  assert.ok(html.includes('demo-repo'))
  assert.ok(html.includes('Git'))
  assert.ok(html.includes('main'))
  assert.ok(html.includes('dvt-repo'))
  assert.ok(html.includes('dvt-branch'))
})

test('a commit row shows summary, short hash, author, compact time, branch and real stats', () => {
  const html = render(ready())
  assert.ok(html.includes('feat: add the timeline panel'))
  assert.ok(html.includes('abcdef0'))
  assert.ok(html.includes('Alice'))
  assert.ok(html.includes('+12'))
  assert.ok(html.includes('−4'))
  assert.ok(html.includes(t('timeline.stats.files', { count: 3 })))
  assert.ok(html.includes('dvt-node'))
  assert.ok(html.includes('dvt-commit'))
})

test('a merge commit renders the merge marker and never fakes 0/0 stats', () => {
  const html = render(ready({ timeline: { ...createInitialState().timeline, events: [mergeEvent] } }))
  assert.ok(html.includes(t('timeline.merge')))
  assert.ok(html.includes('dvt-node-merge'))
  assert.ok(!html.includes('+0'))
  assert.ok(!html.includes('−0'))
})

test('a commit without stats renders no fake numbers', () => {
  const bare: VcsEvent = { ...event, metadata: undefined }
  const html = render(ready({ timeline: { ...createInitialState().timeline, events: [bare] } }))
  assert.ok(!html.includes('+12'))
  assert.ok(!html.includes(t('timeline.stats.files', { count: 3 })))
})

test('an uninitialized repository, a filtered miss and an empty history are distinct', () => {
  const uninitialized = render(ready({
    repositories: [{ ...repository, currentRevision: undefined }],
    timeline: {
      ...createInitialState().timeline,
      events: [],
      warnings: ['this repository has no commits yet'],
    },
  }))
  assert.ok(uninitialized.includes(t('timeline.empty.uninitialized')))
  assert.ok(uninitialized.includes(t('timeline.empty.uninitialized.hint')))

  const filtered = render(ready({
    timeline: { ...createInitialState().timeline, events: [] },
    filters: { text: 'zzz', debouncedText: 'zzz', eventTypes: [], author: '', showAuthor: false },
  }))
  assert.ok(filtered.includes(t('timeline.empty.filtered')))
  assert.ok(filtered.includes(t('filter.clear')))

  const empty = render(ready({ timeline: { ...createInitialState().timeline, events: [] } }))
  assert.ok(empty.includes(t('timeline.empty')))
  assert.ok(!empty.includes(t('timeline.empty.filtered')))
})

test('a partial history renders the warning banner with the Host-provided reason', () => {
  const html = render(ready({
    timeline: {
      ...createInitialState().timeline,
      events: [event],
      partial: true,
      warnings: ['history scan reached its bound'],
    },
  }))
  assert.ok(html.includes(t('state.partial.title')))
  assert.ok(html.includes('history scan reached its bound'))
})

test('the filter bar keeps search, event-type chips and the filter toggle together', () => {
  const html = render(ready())
  assert.ok(html.includes('dvt-search-input'))
  assert.ok(html.includes(t('filter.chip.all')))
  assert.ok(html.includes(t('filter.chip.commit')))
  assert.ok(html.includes('dvt-filterbar'))
  const expanded = render(ready({
    filters: { text: '', debouncedText: '', eventTypes: [], author: '', showAuthor: true },
  }))
  assert.ok(expanded.includes('dvt-author-row'))
})

test('the write operations live in the header menu, not in a card', () => {
  const closed = render(ready())
  assert.ok(!closed.includes('role="menu"'))
  assert.ok(!closed.includes(t('op.fetch')))
  const open = render(ready({ menuOpen: true }))
  assert.ok(open.includes('role="menu"'))
  for (const key of ['op.fetch', 'op.pull', 'op.push', 'op.commit']) {
    assert.ok(open.includes(t(key)), `menu must offer ${key}`)
  }
  assert.ok(open.includes(t('toolbar.menu.sync')))
})

test('an SVN repository offers update and commit only', () => {
  const html = render(ready({
    repositories: [svnRepository],
    selectedRepositoryId: svnRepository.id,
    status: { ...status, repositoryId: svnRepository.id, vcsType: 'svn' },
    menuOpen: true,
  }))
  assert.ok(html.includes(t('op.update')))
  assert.ok(html.includes(t('op.commit')))
  assert.ok(!html.includes(t('op.fetch')))
})

test('a commit detail renders metadata, changed files, rename source and totals', () => {
  const html = render(ready({
    changeSet: { event, revision: changeSet.revision, data: changeSet, loading: false, error: null },
  }))
  assert.ok(html.includes('dvt-subbar'))
  assert.ok(html.includes('src/components/a.ts') || html.includes('components/a.ts'))
  assert.ok(html.includes('src/renamed.ts'))
  assert.ok(html.includes('BIN'))
  assert.ok(html.includes(t('detail.files.header')))
  assert.ok(html.includes('+14'))
  assert.ok(html.includes('−6'))
})

test('a text diff renders gutter line numbers and add/remove rows', () => {
  const html = render(ready({
    diff: { filePath: textDiff.filePath ?? '', data: textDiff, loading: false, error: null },
  }))
  assert.ok(html.includes('dvt-diff'))
  assert.ok(html.includes('dvt-diff-added'))
  assert.ok(html.includes('dvt-diff-removed'))
  assert.ok(html.includes('+added line'))
  assert.ok(html.includes('removed line'))
  assert.ok(html.includes('dvt-diff-gutter'))
})

test('a binary diff says so and shows no text rows', () => {
  const html = render(ready({
    diff: { filePath: binaryDiff.filePath ?? '', data: binaryDiff, loading: false, error: null },
  }))
  assert.ok(html.includes(dictionaries.zh['diff.binary'] as string))
  assert.ok(html.includes(dictionaries.zh['diff.binary.hint'] as string))
  assert.ok(!html.includes('dvt-diff-gutter'))
  assert.ok(!html.includes('dvt-diff-row'))
})

test('the audit list renders attempts with state badges, and the empty state has a hint', () => {
  const withRows = render(ready({
    source: 'audit',
    audit: { ...createInitialState().audit, operations: [attempt, unknownAttempt], loading: false },
  }))
  assert.ok(withRows.includes('dvt-audit-row'))
  assert.ok(withRows.includes(t('op.state.succeeded')))
  assert.ok(withRows.includes(t('op.state.unknown')))
  assert.ok(withRows.includes(t('audit.unknownResult')))

  const empty = render(ready({
    source: 'audit',
    audit: { ...createInitialState().audit, operations: [], loading: false },
  }))
  assert.ok(empty.includes(t('audit.empty')))
  assert.ok(empty.includes(t('audit.empty.hint')))
})

test('an audit detail shows exit code, correlation id and the unconfirmed notice', () => {
  const html = render(ready({
    source: 'audit',
    audit: { ...createInitialState().audit, operations: [unknownAttempt], selected: unknownAttempt, loading: false },
  }))
  assert.ok(html.includes('corr-2'))
  assert.ok(html.includes(t('audit.state.unknown.hint')))
  assert.ok(html.includes(t('audit.exitCode')))
})

test('the status bar summarizes tree state, branch and change count', () => {
  const html = render(ready())
  assert.ok(html.includes('dvt-statusbar'))
  assert.ok(html.includes(t('status.dirty')))
  assert.ok(html.includes(t('status.changes', { count: 2 })))
  assert.ok(html.includes(t('status.diagnostics')))
  const clean = render(ready({ status: { ...status, clean: true, entries: [] } }))
  assert.ok(clean.includes(t('status.clean')))
})

test('diagnostics are collapsed by default and expandable', () => {
  const collapsed = render(ready())
  assert.ok(!collapsed.includes(diagnostics.dataDir), 'collapsed diagnostics must not render the data directory')
  assert.ok(collapsed.includes('aria-expanded="false"'))
  const open = render(ready({ diagnosticsOpen: true }))
  assert.ok(open.includes(diagnostics.dataDir))
  assert.ok(open.includes('git version 2.45.1'))
  assert.ok(open.includes('svn executable not found'))
  assert.ok(open.includes('aria-expanded="true"'))
})

test('the write dialog mounts only with dialog state and shows argv plus commit input', () => {
  assert.ok(!render(ready()).includes('role="dialog"'))

  const html = render(ready({
    dialog: {
      operation: 'commit',
      phase: 'previewing',
      preview: null,
      previewError: null,
      executeError: null,
      result: null,
      message: 'fix: keep me',
      remote: 'origin',
      branch: 'main',
    },
  }))
  assert.ok(html.includes('role="dialog"'))
  assert.ok(html.includes('dvt-overlay'))
  assert.ok(html.includes('fix: keep me'))
  assert.ok(html.includes('dvt-commit-message'))

  const blocked = render(ready({
    dialog: {
      operation: 'commit',
      phase: 'blocked',
      preview: {
        repositoryId: repository.id,
        operation: 'commit',
        allowed: false,
        blockedReason: 'nothing is staged',
        summary: 'commit blocked',
        argv: [],
        before: { branch: 'main', clean: false },
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
  assert.ok(blocked.includes('nothing is staged'))
  assert.ok(blocked.includes(t('op.repreview')))
  assert.ok(!blocked.includes(t('op.confirm')))
})

test('the stylesheet uses theme tokens only: no literal color, no global selector', () => {
  assert.ok(STYLES.length > 3_000)
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(STYLES), 'no literal hex colors')
  assert.ok(!/\brgba?\(/.test(STYLES), 'no literal rgb()/rgba() colors')
  assert.ok(!/(^|[}\s,])(body|html|:root)\s*[,{]/.test(STYLES), 'no bare document selectors')
  assert.ok(STYLES.includes('--dsw-alias-'))
  assert.ok(STYLES.includes('.dvt-root'))
  assert.ok(STYLES.includes('@media'))
})

test('the zh and en dictionaries stay complete and non-empty', () => {
  const keys = Object.keys(dictionaries.zh)
  assert.ok(keys.length > 100)
  for (const key of keys) {
    assert.notEqual(String(dictionaries.zh[key]).trim(), '', `empty zh value for ${key}`)
    assert.notEqual(String(dictionaries.en[key]).trim(), '', `empty en value for ${key}`)
  }
})
