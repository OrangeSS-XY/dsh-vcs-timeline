/**
 * Render static previews of the panel for visual review.
 *
 * This is a design-verification aid, not a product feature: it renders the
 * real `renderPanelView` with fixture data into standalone HTML pages, using a
 * neutral approximation of the DSH light/dark theme tokens so a 400px-wide
 * Chromium screenshot shows the intended density and hierarchy. The live app
 * uses the real `--dsw-*` tokens from the host theme.
 *
 * Usage: node --experimental-strip-types scripts/render-preview.ts [--demo-only]
 *   --demo-only renders only the standalone `SwimlaneDemo` stages, which is
 *   useful while the panel integration is still in progress.
 * Output: docs/ui-preview/*.html (screenshot with docs/ui-preview/render.md)
 * @module scripts/render-preview
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  ChangeSet,
  Diagnostics,
  DiffResult,
  HotspotReport,
  OperationAttempt,
  Repository,
  VcsEvent,
  WorkingTreeStatus,
} from '../src/shared/contracts.ts'
import { createNoopHandlers, createInitialState, type PanelState } from '../src/client/types.ts'
import { renderPanelView } from '../src/client/components.ts'
import { createTranslator } from '../src/client/i18n.ts'
import { SwimlaneDemo } from '../src/client/ui/swimlane.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'docs/ui-preview')
const t = createTranslator('zh')

/**
 * Light-theme tokens copied from the installed DSH monochrome theme.
 *
 * The important truth: `--dsw-alias-brand-primary` is MONOCHROME (#0f1115),
 * not a blue accent. Chart/heat colours must therefore come from the explicit
 * `--dvt-data-blue` / `--dvt-data-purple` palette owned by the panel stylesheet;
 * this fixture is what proves they do. Neutral greys and semantic
 * green/red/amber are the installed theme's values.
 */
const LIGHT_TOKENS: Record<string, string> = {
  '--dsw-alias-bg-base': '#ffffff',
  '--dsw-alias-bg-layer-1': '#f4f4f4',
  '--dsw-alias-bg-layer-2': '#ebebeb',
  '--dsw-alias-bg-overlay': '#ffffff',
  '--dsw-alias-bg-mask-drop': 'rgba(15, 17, 21, 0.32)',
  '--dsw-alias-border-l1': '#e6e6e6',
  '--dsw-alias-border-l2': '#d2d2d2',
  '--dsw-alias-label-primary': '#0f1115',
  '--dsw-alias-label-secondary': '#5b616b',
  '--dsw-alias-label-tertiary': '#8a909a',
  '--dsw-alias-brand-primary': '#0f1115',
  '--dsw-alias-state-success-primary': '#1a7f37',
  '--dsw-alias-state-error-primary': '#cf222e',
  '--dsw-alias-state-warn-primary': '#9a6700',
  '--dsw-alias-interactive-hover': 'rgba(15, 17, 21, 0.05)',
  '--dsw-alias-interactive-pressed': 'rgba(15, 17, 21, 0.09)',
  '--dsw-alias-interactive-selected': 'rgba(15, 17, 21, 0.07)',
  '--dsw-specific-sidebar-fill': '#f4f4f4',
  '--dsw-specific-button-secondary-fill': '#ffffff',
  '--dsw-alias-bg-mask-drop-x': 'rgba(15, 17, 21, 0.32)',
}

/** Dark monochrome theme: brand is near-white, so charts must not use it either. */
const DARK_TOKENS: Record<string, string> = {
  '--dsw-alias-bg-base': '#0d1117',
  '--dsw-alias-bg-layer-1': '#161b22',
  '--dsw-alias-bg-layer-2': '#20262e',
  '--dsw-alias-bg-overlay': '#161b22',
  '--dsw-alias-bg-mask-drop': 'rgba(0, 0, 0, 0.55)',
  '--dsw-alias-border-l1': '#232a33',
  '--dsw-alias-border-l2': '#333c47',
  '--dsw-alias-label-primary': '#f5f6f8',
  '--dsw-alias-label-secondary': '#a6adb8',
  '--dsw-alias-label-tertiary': '#7c8590',
  '--dsw-alias-brand-primary': '#f5f6f8',
  '--dsw-alias-state-success-primary': '#3fb950',
  '--dsw-alias-state-error-primary': '#f85149',
  '--dsw-alias-state-warn-primary': '#d29922',
  '--dsw-alias-interactive-hover': 'rgba(255, 255, 255, 0.06)',
  '--dsw-alias-interactive-pressed': 'rgba(255, 255, 255, 0.10)',
  '--dsw-alias-interactive-selected': 'rgba(245, 246, 248, 0.10)',
  '--dsw-specific-sidebar-fill': '#0d1117',
  '--dsw-specific-button-secondary-fill': '#20262e',
}

const repository: Repository = {
  schemaVersion: 1,
  id: 'git:d:/workspace/web-console',
  vcsType: 'git',
  rootPath: 'D:/workspace/web-console',
  displayName: 'web-console',
  currentBranch: 'feature/sidebar-timeline',
  currentRevision: 'b5685a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60',
  remoteUrls: ['https://example.com/team/web-console.git'],
  detectedAt: '2026-10-27T08:00:00.000Z',
  lastSeenAt: '2026-10-27T09:00:00.000Z',
}

const diagnostics: Diagnostics = {
  pluginVersion: '0.1.0',
  dshVersion: '0.2.1-rc.3',
  platform: 'win32 x64',
  dataDir: 'C:/Users/dev/.dsh/storages/dsh-vcs-timeline',
  gitVersion: 'git version 2.45.1.windows.1',
  svnVersion: null,
  workspaceCount: 3,
  warnings: ['svn executable not found'],
}

const status: WorkingTreeStatus = {
  repositoryId: repository.id,
  vcsType: 'git',
  clean: false,
  branch: 'feature/sidebar-timeline',
  head: 'b5685a0c1d2e',
  entries: [
    { path: 'src/client/ui/history.ts', status: 'M', worktreeStatus: 'M', staged: true },
    { path: 'src/client/styles.ts', status: 'M', worktreeStatus: 'M' },
    { path: 'docs/ui-preview.md', status: '?', worktreeStatus: '?' },
  ],
  conflicts: [],
}

/** A commit event with real-looking but explicitly fixture stats and files. */
function commit(input: {
  hash: string
  summary: string
  actor: string
  time: string
  branch?: string
  stats?: { files: number; additions: number; deletions: number }
  parents?: string[]
  files?: Array<{ path: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; oldPath?: string; additions?: number; deletions?: number; binary?: boolean }>
}): VcsEvent {
  return {
    schemaVersion: 1,
    id: `commit:${input.hash}`,
    repositoryId: repository.id,
    vcsType: 'git',
    eventType: 'commit',
    source: 'repository',
    timestamp: input.time,
    actor: input.actor,
    summary: input.summary,
    commitHash: input.hash.padEnd(40, '0'),
    parentHashes: (input.parents ?? []).map((parent) => parent.padEnd(40, '0')),
    ...(input.branch === undefined ? {} : { branch: input.branch }),
    ...(input.stats === undefined
      ? {}
      : {
        metadata: {
          filesChanged: input.stats.files,
          additions: input.stats.additions,
          deletions: input.stats.deletions,
        },
      }),
    ...(input.files === undefined ? {} : { changedFiles: input.files }),
  }
}

const events: VcsEvent[] = [
  commit({
    hash: 'b5685a0c',
    summary: 'feat(timeline): 紧凑工具栏、提交图与增删统计',
    actor: 'Lin Wei',
    time: '2026-10-27T09:12:00.000Z',
    branch: 'feature/sidebar-timeline',
    parents: ['9d2f41ab'],
    stats: { files: 7, additions: 214, deletions: 158 },
    files: [
      { path: 'src/client/ui/toolbar.ts', status: 'added', additions: 186, deletions: 0 },
      { path: 'src/client/styles.ts', status: 'modified', additions: 214, deletions: 158 },
      { path: 'src/client/ui/history.ts', status: 'renamed', oldPath: 'src/client/components.ts', additions: 62, deletions: 41 },
      { path: 'src/client/ui/detail.ts', status: 'modified', additions: 48, deletions: 22 },
      { path: 'assets/branch-graph.svg', status: 'added', binary: true },
      { path: 'docs/ARCHITECTURE.md', status: 'modified', additions: 12, deletions: 4 },
      { path: 'src/tests/client.render.test.ts', status: 'modified', additions: 31, deletions: 9 },
    ],
  }),
  commit({
    hash: '9d2f41ab',
    summary: 'refactor: 把审计页签拆到独立视图模块',
    actor: 'Chen Yu',
    time: '2026-10-27T08:41:00.000Z',
    parents: ['73ac90fe'],
    stats: { files: 3, additions: 96, deletions: 210 },
    files: [
      { path: 'src/client/ui/audit.ts', status: 'added', additions: 96, deletions: 0 },
      { path: 'src/client/components.ts', status: 'modified', additions: 0, deletions: 210 },
      { path: 'src/tests/client.render.test.ts', status: 'modified', additions: 12, deletions: 8 },
    ],
  }),
  commit({
    hash: '73ac90fe',
    summary: 'Merge branch \'fix/unicode-paths\' into main',
    actor: 'Lin Wei',
    time: '2026-10-26T17:05:00.000Z',
    parents: ['41ee77c2', '0c58b3d1'],
    files: [],
  }),
  commit({
    hash: '41ee77c2',
    summary: 'fix: 提交详情中的重命名路径显示旧文件名，并补齐二进制标记',
    actor: 'Zhao Min',
    time: '2026-10-26T11:28:00.000Z',
    parents: ['0c58b3d1'],
    stats: { files: 2, additions: 18, deletions: 6 },
    files: [
      { path: 'src/client/ui/detail.ts', status: 'modified', additions: 18, deletions: 6 },
      { path: 'src/client/ui/history.ts', status: 'modified', additions: 4, deletions: 2 },
    ],
  }),
  commit({
    hash: '0c58b3d1',
    summary: 'chore: 引入 JSONL 审计存储与写入串行化',
    actor: 'Chen Yu',
    time: '2026-10-25T15:02:00.000Z',
    parents: ['f1c0a9e4'],
    stats: { files: 5, additions: 432, deletions: 12 },
    files: [
      { path: 'src/host/storage/jsonl.ts', status: 'added', additions: 402, deletions: 0 },
      { path: 'src/host/audit/audit-service.ts', status: 'added', additions: 28, deletions: 0 },
      { path: 'src/host/index.ts', status: 'modified', additions: 2, deletions: 12 },
      { path: 'docs/TEST-REPORT.md', status: 'modified', additions: 2, deletions: 0 },
      { path: 'src/tests/storage.test.ts', status: 'added', additions: 0, deletions: 0 },
    ],
  }),
  commit({
    hash: 'f1c0a9e4',
    summary: 'docs: 兼容性记录补充右侧栏 slot 契约',
    actor: 'Lin Wei',
    time: '2026-10-25T09:36:00.000Z',
    stats: { files: 1, additions: 64, deletions: 4 },
    files: [{ path: 'docs/DSH-COMPATIBILITY.md', status: 'modified', additions: 64, deletions: 4 }],
  }),
]

const changeSet: ChangeSet = {
  schemaVersion: 1,
  id: `${repository.id}:b5685a0c`,
  repositoryId: repository.id,
  vcsType: 'git',
  revision: 'b5685a0c1d2e',
  createdAt: '2026-10-27T09:12:00.000Z',
  files: [
    { path: 'src/client/ui/toolbar.ts', status: 'added', additions: 186, deletions: 0 },
    { path: 'src/client/styles.ts', status: 'modified', additions: 214, deletions: 158 },
    { path: 'src/client/ui/history.ts', status: 'renamed', oldPath: 'src/client/components.ts', additions: 62, deletions: 41 },
    { path: 'assets/branch-graph.svg', status: 'added', binary: true },
    { path: 'src/client/ui/detail.ts', status: 'modified', additions: 48, deletions: 22 },
  ],
}

type FixtureActionKind =
  | 'review'
  | 'address-feedback'
  | 'merge'
  | 'fix-ci'
  | 'fix-conflicts'
  | 'wait'
  | 'unknown'

const pullRequest = (input: {
  number: number
  title: string
  author: string
  branch: string
  state?: 'open' | 'draft' | 'merged' | 'closed'
  reviewState?: 'approved' | 'changes-requested' | 'review-required' | 'none'
  checksState?: 'success' | 'failure' | 'pending' | 'none'
  mergeable?: boolean | null
  action?: { kind: FixtureActionKind; reason: string }
  actions?: Array<{ kind: FixtureActionKind; reason: string }>
  mergedAt?: string
  closedAt?: string
  additions?: number
  deletions?: number
  changedFiles?: number
  createdAt?: string
  updatedAt: string
}) => ({
  schemaVersion: 1 as const,
  id: `${repository.id}#${input.number}`,
  repositoryId: repository.id,
  provider: 'github' as const,
  number: input.number,
  title: input.title,
  url: `https://github.com/example/web-console/pull/${input.number}`,
  state: input.state ?? 'open',
  author: { login: input.author },
  branch: input.branch,
  baseBranch: 'main',
  createdAt: input.createdAt ?? input.updatedAt,
  updatedAt: input.updatedAt,
  ...(input.mergedAt === undefined ? {} : { mergedAt: input.mergedAt }),
  ...(input.closedAt === undefined ? {} : { closedAt: input.closedAt }),
  reviewState: input.reviewState ?? 'none',
  checksState: input.checksState ?? 'none',
  mergeable: input.mergeable ?? null,
  reviews: [],
  checks: [],
  pendingReviewers: [],
  requestedFromViewer: (input.actions ?? (input.action === undefined ? [] : [input.action]))
    .some((action) => action.kind === 'review'),
  actions: input.actions ?? (input.action === undefined ? [] : [input.action]),
  changedFiles: input.changedFiles ?? 4,
  additions: input.additions ?? 96,
  deletions: input.deletions ?? 24,
  commitCount: 3,
  commentCount: 2,
})

const pullRequests = {
  repositoryId: repository.id,
  provider: 'github' as const,
  host: 'github.com',
  remotePath: 'example/web-console',
  viewer: 'linwei',
  authenticated: true,
  pullRequests: [
    pullRequest({
      number: 42,
      title: 'feat: 文件中心的双栏变更浏览器',
      author: 'linwei',
      branch: 'feat/file-browser',
      reviewState: 'review-required',
      checksState: 'success',
      mergeable: true,
      action: { kind: 'review', reason: 'review-requested' },
      updatedAt: '2026-10-27T09:20:00.000Z',
    }),
    pullRequest({
      number: 41,
      title: 'fix: 重命名路径在详情中的显示',
      author: 'zhaomin',
      branch: 'fix/rename-path',
      reviewState: 'changes-requested',
      checksState: 'failure',
      mergeable: false,
      action: { kind: 'fix-ci', reason: 'checks-failed' },
      updatedAt: '2026-10-27T08:40:00.000Z',
    }),
    pullRequest({
      number: 39,
      title: 'docs: 补全 PR 与审计说明',
      author: 'chenyu',
      branch: 'docs/pr-and-audit',
      reviewState: 'approved',
      checksState: 'success',
      mergeable: true,
      action: { kind: 'merge', reason: 'ready-to-merge' },
      updatedAt: '2026-10-26T15:10:00.000Z',
    }),
  ],
  fetchedAt: '2026-10-27T09:30:00.000Z',
}

/**
 * Analytics dashboard fixture: every merge-readiness class the tiles count.
 *
 * Loaded 9 PRs with a 30-day merged/closed window and a truncated history cap:
 * one ready-to-merge, one conflicting, one draft, one change-requested, one
 * unknown-mergeability, three merged (three different ISO weeks) and one closed.
 * Four authors carry additions/deletions so the ranking bars are meaningful.
 */
const prAnalyticsList = {
  repositoryId: repository.id,
  provider: 'github' as const,
  host: 'github.com',
  remotePath: 'example/web-console',
  viewer: 'linwei',
  authenticated: true,
  closedWindowDays: 30,
  historyTruncated: true,
  pullRequests: [
    pullRequest({
      number: 57,
      title: 'feat: 热点日历与分析看板',
      author: 'linwei',
      branch: 'feat/pr-analytics',
      reviewState: 'approved',
      checksState: 'success',
      mergeable: true,
      action: { kind: 'merge', reason: 'ready-to-merge' },
      additions: 412,
      deletions: 96,
      changedFiles: 9,
      createdAt: '2026-10-22T08:10:00.000Z',
      updatedAt: '2026-10-29T02:41:00.000Z',
    }),
    pullRequest({
      number: 56,
      title: 'fix: 冲突分支的合并顺序',
      author: 'zhaomin',
      branch: 'fix/conflict-order',
      reviewState: 'changes-requested',
      checksState: 'failure',
      mergeable: false,
      actions: [
        { kind: 'fix-conflicts', reason: 'merge-conflict' },
        { kind: 'address-feedback', reason: 'changes-requested-by-others' },
      ],
      additions: 180,
      deletions: 74,
      changedFiles: 6,
      createdAt: '2026-10-20T09:15:00.000Z',
      updatedAt: '2026-10-28T17:40:00.000Z',
    }),
    pullRequest({
      number: 55,
      title: 'docs: 兼容性矩阵与升级说明',
      author: 'chenyu',
      branch: 'docs/compat-matrix',
      state: 'draft',
      reviewState: 'review-required',
      mergeable: null,
      additions: 64,
      deletions: 12,
      changedFiles: 3,
      createdAt: '2026-10-26T06:30:00.000Z',
      updatedAt: '2026-10-28T11:08:00.000Z',
    }),
    pullRequest({
      number: 54,
      title: 'refactor: 收敛数据色板 token',
      author: 'linwei',
      branch: 'refactor/data-tokens',
      reviewState: 'changes-requested',
      checksState: 'success',
      mergeable: true,
      action: { kind: 'address-feedback', reason: 'your-pr-has-feedback' },
      additions: 96,
      deletions: 24,
      changedFiles: 5,
      createdAt: '2026-10-19T03:05:00.000Z',
      updatedAt: '2026-10-27T15:22:00.000Z',
    }),
    pullRequest({
      number: 53,
      title: 'feat: PR 分析看板与作者排行',
      author: 'chenyu',
      branch: 'feat/pr-dashboard',
      state: 'merged',
      reviewState: 'approved',
      checksState: 'success',
      mergeable: true,
      mergedAt: '2026-10-27T09:12:00.000Z',
      additions: 986,
      deletions: 219,
      changedFiles: 12,
      createdAt: '2026-10-18T10:40:00.000Z',
      updatedAt: '2026-10-27T09:12:00.000Z',
    }),
    pullRequest({
      number: 52,
      title: 'fix: 旧版浏览器兼容问题',
      author: 'zhaomin',
      branch: 'fix/legacy-browser',
      state: 'closed',
      mergeable: null,
      closedAt: '2026-10-21T10:30:00.000Z',
      additions: 48,
      deletions: 90,
      changedFiles: 4,
      createdAt: '2026-10-05T07:20:00.000Z',
      updatedAt: '2026-10-21T10:30:00.000Z',
    }),
    pullRequest({
      number: 51,
      title: 'chore: 依赖升级与锁文件同步',
      author: 'sunqi',
      branch: 'chore/deps',
      reviewState: 'review-required',
      checksState: 'pending',
      mergeable: null,
      action: { kind: 'wait', reason: 'waiting' },
      additions: 18,
      deletions: 14,
      changedFiles: 2,
      createdAt: '2026-10-16T02:35:00.000Z',
      updatedAt: '2026-10-26T09:36:00.000Z',
    }),
    pullRequest({
      number: 50,
      title: 'feat: 作者贡献卡片',
      author: 'linwei',
      branch: 'feat/author-cards',
      state: 'merged',
      reviewState: 'approved',
      checksState: 'success',
      mergeable: true,
      mergedAt: '2026-10-14T16:05:00.000Z',
      additions: 640,
      deletions: 120,
      changedFiles: 7,
      createdAt: '2026-10-02T08:00:00.000Z',
      updatedAt: '2026-10-14T16:05:00.000Z',
    }),
    pullRequest({
      number: 49,
      title: 'fix: 日历热力图的边界日期',
      author: 'zhaomin',
      branch: 'fix/calendar-edge',
      state: 'merged',
      reviewState: 'approved',
      checksState: 'success',
      mergeable: true,
      mergedAt: '2026-09-30T11:20:00.000Z',
      additions: 220,
      deletions: 80,
      changedFiles: 5,
      createdAt: '2026-09-21T04:50:00.000Z',
      updatedAt: '2026-09-30T11:20:00.000Z',
    }),
  ],
  fetchedAt: '2026-10-29T05:55:00.000Z',
}

/**
 * Anonymous variant: no viewer and no merged/closed window was requested, so
 * the list carries only active PRs (no history rows) and the merged tile must
 * say "unavailable" (never a fabricated 0) while the trend card explains that
 * history was not read.
 */
const prAnalyticsAnonymous = {
  ...prAnalyticsList,
  viewer: null,
  authenticated: false,
  closedWindowDays: undefined,
  historyTruncated: false,
  pullRequests: prAnalyticsList.pullRequests.filter((pr) => pr.state === 'open' || pr.state === 'draft'),
}

const branchCompare = {
  repositoryId: repository.id,
  vcsType: 'git' as const,
  currentBranch: 'feature/sidebar-timeline',
  baseBranch: 'main',
  available: true,
  ahead: 3,
  behind: 1,
  commits: [
    { hash: 'b5685a0c1d2e', summary: 'feat(timeline): 紧凑工具栏、提交图与增删统计', author: 'Lin Wei', timestamp: '2026-10-27T09:12:00.000Z' },
    { hash: '9d2f41ab0000', summary: 'refactor: 把审计页签拆到独立视图模块', author: 'Chen Yu', timestamp: '2026-10-27T08:41:00.000Z' },
  ],
  filesChanged: 7,
  additions: 214,
  deletions: 158,
  conflictPaths: [] as string[],
  unpushed: 2,
  hasUpstream: true,
  actions: [{ kind: 'push' as const, reason: 'unpushed-commits' }],
  computedAt: '2026-10-27T09:30:00.000Z',
}

const diff: DiffResult = {
  repositoryId: repository.id,
  revisionA: null,
  revisionB: 'b5685a0c1d2e',
  filePath: 'src/client/ui/history.ts',
  text: [
    'diff --git a/src/client/ui/history.ts b/src/client/ui/history.ts',
    'index 4c1d2e3..8f9a0b1 100644',
    '--- a/src/client/ui/history.ts',
    '+++ b/src/client/ui/history.ts',
    '@@ -41,9 +41,14 @@ function CommitRow(props: CommitRowProps): React.ReactElement {',
    '   const stats = F.eventStats(props.event)',
    '   const time = F.formatCompactTime(props.event.timestamp, deps.locale)',
    '-  return h(\'li\', { className: \'dvt-list-item\' },',
    '-    h(Glyph, { kind: props.event.eventType }),',
    '+  return h(\'li\', { className: \'dvt-commit\' },',
    '+    h(\'span\', { className: \'dvt-graph\' },',
    '+      h(\'span\', { className: `dvt-node${merge ? \' dvt-node-merge\' : \'\'}` }),',
    '+    ),',
    '     h(\'span\', { className: \'dvt-commit-top\' }, summary),',
    '   )',
    '@@ -58,3 +63,4 @@ function CommitRow(props: CommitRowProps): React.ReactElement {',
    '     )',
    '   )',
    '+  // The graph gutter replaces the per-row glyph: one line, one node.',
    ' }',
    '',
  ].join('\n'),
  truncated: false,
  binary: false,
  bytes: 1_284,
}

const attempts: OperationAttempt[] = [
  {
    schemaVersion: 1,
    id: 'op-7f3a91c2',
    repositoryId: repository.id,
    vcsType: 'git',
    operation: 'commit',
    state: 'succeeded',
    startedAt: '2026-10-27T09:20:11.000Z',
    finishedAt: '2026-10-27T09:20:13.400Z',
    actor: 'user-via-plugin',
    requestSummary: 'commit 3 staged path(s) on feature/sidebar-timeline',
    beforeRevision: '9d2f41ab',
    afterRevision: 'b5685a0c',
    exitCode: 0,
    correlationId: 'corr-5c1e8d0b7a4412ef',
    remoteOutcome: 'confirmed-success',
  },
  {
    schemaVersion: 1,
    id: 'op-2b8e44d1',
    repositoryId: repository.id,
    vcsType: 'git',
    operation: 'push',
    state: 'unknown',
    startedAt: '2026-10-27T09:22:40.000Z',
    finishedAt: '2026-10-27T09:24:40.000Z',
    actor: 'user-via-plugin',
    requestSummary: 'push feature/sidebar-timeline to origin',
    beforeRevision: 'b5685a0c',
    exitCode: null as unknown as number,
    errorCode: 'timeout',
    correlationId: 'corr-9a4f2c6d1b8e7033',
    remoteOutcome: 'unknown',
  },
  {
    schemaVersion: 1,
    id: 'op-c04a17f9',
    repositoryId: repository.id,
    vcsType: 'git',
    operation: 'fetch',
    state: 'failed',
    startedAt: '2026-10-27T08:12:02.000Z',
    finishedAt: '2026-10-27T08:12:04.000Z',
    actor: 'user-via-plugin',
    requestSummary: 'fetch new commits and objects from the default remote',
    exitCode: 128,
    errorCode: 'operation-failed',
    safeErrorMessage: 'fatal: unable to access remote: Could not resolve host',
    correlationId: 'corr-1d5b3e8a9c2074f6',
  },
]

const initial = createInitialState()

function stateWith(overrides: Partial<PanelState>): PanelState {
  return {
    ...initial,
    boot: 'ready',
    repositories: [repository],
    selectedRepositoryId: repository.id,
    diagnostics,
    status,
    timeline: { ...initial.timeline, events },
    ...overrides,
  }
}

/* ---------------------------------------------- hotspot dashboard fixture */

/**
 * One realistic hotspot report for the multi-dimensional dashboard: a 20-file
 * churn ranking with a long tail (17 238 down to 40 plus one binary file with
 * unreported churn), six contributors of very different commit share (one of
 * them with `churn: null`), and ten recent commits including a merge, a commit
 * whose `files` array is capped below `fileCount`, and a binary-only commit.
 * `daily` is carried even though the dashboard currently renders only the three
 * explicit dimensions; scope/truncated/cached drive the honesty badges.
 */
const hotspotReport: HotspotReport = {
  repositoryId: repository.id,
  vcsType: 'git',
  available: true,
  files: [
    { path: 'src/client/components.ts', commits: 48, additions: 12_004, deletions: 5_234, churn: 17_238, authors: ['Lin Wei', 'Chen Yu', 'Zhao Min', 'Sun Qi', 'Wang Bo'], authorCount: 5, lastChangedAt: '2026-10-29T02:41:00.000Z', lastAuthor: 'Lin Wei' },
    { path: 'src/client/ui/hotspots.ts', commits: 31, additions: 9_860, deletions: 2_199, churn: 12_059, authors: ['Chen Yu', 'Lin Wei', 'Zhao Min', 'Sun Qi'], authorCount: 4, lastChangedAt: '2026-10-29T02:05:00.000Z', lastAuthor: 'Chen Yu' },
    { path: 'src/client/styles.ts', commits: 29, additions: 7_010, deletions: 2_411, churn: 9_421, authors: ['Lin Wei', 'Zhao Min', 'Chen Yu', 'Wang Bo', 'Sun Qi'], authorCount: 5, lastChangedAt: '2026-10-28T17:40:00.000Z', lastAuthor: 'Zhao Min' },
    { path: 'src/client/ui/swimlane.ts', commits: 22, additions: 6_390, deletions: 1_817, churn: 8_207, authors: ['Chen Yu', 'Lin Wei', 'Sun Qi'], authorCount: 3, lastChangedAt: '2026-10-27T09:12:00.000Z', lastAuthor: 'Chen Yu' },
    { path: 'src/client/ui/history.ts', commits: 26, additions: 5_210, deletions: 1_680, churn: 6_890, authors: ['Zhao Min', 'Chen Yu', 'Lin Wei', 'Sun Qi'], authorCount: 4, lastChangedAt: '2026-10-28T11:08:00.000Z', lastAuthor: 'Zhao Min' },
    { path: 'src/client/ui/toolbar.ts', commits: 19, additions: 3_980, deletions: 1_140, churn: 5_120, authors: ['Lin Wei', 'Chen Yu', 'Wang Bo'], authorCount: 3, lastChangedAt: '2026-10-27T08:41:00.000Z', lastAuthor: 'Lin Wei' },
    { path: 'src/host/services/stats-service.ts', commits: 14, additions: 3_380, deletions: 920, churn: 4_300, authors: ['Chen Yu', 'Lin Wei'], authorCount: 2, lastChangedAt: '2026-10-29T01:12:00.000Z', lastAuthor: 'Chen Yu' },
    { path: 'src/client/ui/filetree.ts', commits: 12, additions: 2_410, deletions: 770, churn: 3_180, authors: ['Lin Wei', 'Zhao Min'], authorCount: 2, lastChangedAt: '2026-10-26T15:22:00.000Z', lastAuthor: 'Lin Wei' },
    { path: 'src/client/ui/detail.ts', commits: 11, additions: 1_830, deletions: 620, churn: 2_450, authors: ['Zhao Min', 'Lin Wei', 'Chen Yu'], authorCount: 3, lastChangedAt: '2026-10-28T17:40:00.000Z', lastAuthor: 'Zhao Min' },
    { path: 'src/client/ui/pr.ts', commits: 9, additions: 1_430, deletions: 440, churn: 1_870, authors: ['Sun Qi', 'Chen Yu'], authorCount: 2, lastChangedAt: '2026-10-25T15:02:00.000Z', lastAuthor: 'Sun Qi' },
    { path: 'src/host/adapters/git/commands.ts', commits: 8, additions: 1_090, deletions: 330, churn: 1_420, authors: ['Lin Wei', 'Chen Yu'], authorCount: 2, lastChangedAt: '2026-10-27T09:12:00.000Z', lastAuthor: 'Lin Wei' },
    { path: 'src/shared/contracts.ts', commits: 7, additions: 860, deletions: 320, churn: 1_180, authors: ['Lin Wei', 'Zhao Min'], authorCount: 2, lastChangedAt: '2026-10-28T11:08:00.000Z', lastAuthor: 'Zhao Min' },
    { path: 'src/client/ui/audit.ts', commits: 6, additions: 640, deletions: 250, churn: 890, authors: ['Sun Qi', 'Chen Yu'], authorCount: 2, lastChangedAt: '2026-10-24T09:36:00.000Z', lastAuthor: 'Sun Qi' },
    { path: 'docs/ARCHITECTURE.md', commits: 5, additions: 520, deletions: 120, churn: 640, authors: ['Lin Wei', 'Wang Bo'], authorCount: 2, lastChangedAt: '2026-10-29T02:41:00.000Z', lastAuthor: 'Lin Wei' },
    { path: 'src/client/format.ts', commits: 5, additions: 410, deletions: 110, churn: 520, authors: ['Chen Yu', 'Lin Wei'], authorCount: 2, lastChangedAt: '2026-10-25T15:02:00.000Z', lastAuthor: 'Chen Yu' },
    { path: 'src/tests/hotspots.test.ts', commits: 4, additions: 380, deletions: 80, churn: 460, authors: ['Chen Yu'], authorCount: 1, lastChangedAt: '2026-10-29T02:05:00.000Z', lastAuthor: 'Chen Yu' },
    { path: 'src/host/routes.ts', commits: 4, additions: 240, deletions: 70, churn: 310, authors: ['Lin Wei', 'Zhao Min'], authorCount: 2, lastChangedAt: '2026-10-24T09:36:00.000Z', lastAuthor: 'Lin Wei' },
    { path: 'src/client/ui/icons.ts', commits: 3, additions: 170, deletions: 40, churn: 210, authors: ['Sun Qi'], authorCount: 1, lastChangedAt: '2026-10-23T14:12:00.000Z', lastAuthor: 'Sun Qi' },
    { path: 'package.json', commits: 3, additions: 62, deletions: 34, churn: 96, authors: ['Lin Wei', 'Zhao Min'], authorCount: 2, lastChangedAt: '2026-10-22T10:05:00.000Z', lastAuthor: 'Lin Wei' },
    { path: 'assets/branch-graph.svg', commits: 2, churn: null, authors: ['Lin Wei'], authorCount: 1, lastChangedAt: '2026-10-26T17:05:00.000Z', lastAuthor: 'Lin Wei' },
  ],
  authors: [
    { name: 'Lin Wei', commits: 62, additions: 19_040, deletions: 8_360, churn: 27_400, files: 38, firstCommitAt: '2026-09-03T02:10:00.000Z', lastCommitAt: '2026-10-29T02:41:00.000Z' },
    { name: 'Chen Yu', commits: 41, additions: 10_980, deletions: 4_250, churn: 15_230, files: 31, firstCommitAt: '2026-09-08T06:22:00.000Z', lastCommitAt: '2026-10-29T02:05:00.000Z' },
    { name: 'Zhao Min', commits: 26, additions: 6_820, deletions: 3_020, churn: 9_840, files: 24, firstCommitAt: '2026-09-15T03:40:00.000Z', lastCommitAt: '2026-10-28T17:40:00.000Z' },
    { name: 'Sun Qi', commits: 14, additions: 3_050, deletions: 1_160, churn: 4_210, files: 12, firstCommitAt: '2026-09-28T08:15:00.000Z', lastCommitAt: '2026-10-25T15:02:00.000Z' },
    { name: 'Wang Bo', commits: 7, additions: 1_430, deletions: 550, churn: 1_980, files: 8, firstCommitAt: '2026-10-02T12:31:00.000Z', lastCommitAt: '2026-10-23T14:12:00.000Z' },
    { name: 'dependabot[bot]', commits: 3, churn: null, files: 3, firstCommitAt: '2026-10-11T01:05:00.000Z', lastCommitAt: '2026-10-22T10:05:00.000Z' },
  ],
  recent: [
    {
      hash: 'b5685a0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60', author: 'Lin Wei', timestamp: '2026-10-29T02:41:00.000Z',
      subject: "Merge branch 'fix/unicode-paths' into main", merge: true, fileCount: 9, additions: 96, deletions: 210,
      files: ['src/client/components.ts', 'src/client/styles.ts', 'src/client/ui/hotspots.ts', 'docs/ARCHITECTURE.md', 'src/client/ui/history.ts', 'src/host/services/stats-service.ts', 'src/client/ui/toolbar.ts'],
    },
    {
      hash: '9d2f41ab0c58b3d1f1c0a9e473ac90fe41ee77c2', author: 'Chen Yu', timestamp: '2026-10-29T02:05:00.000Z',
      subject: 'feat(hotspots): 三维热点仪表盘与 sqrt 压缩微条形图', merge: false, fileCount: 14, additions: 986, deletions: 219,
      files: ['src/client/ui/hotspots.ts', 'src/client/styles.ts', 'src/shared/contracts.ts', 'src/client/types.ts', 'src/tests/hotspots.test.ts', 'src/host/services/stats-service.ts', 'src/client/components.ts', 'src/client/ui-i18n.ts'],
    },
    {
      hash: '0c58b3d1e9a44177b26e147b5685a0c1d2e3f4a5', author: 'Zhao Min', timestamp: '2026-10-29T01:12:00.000Z',
      subject: 'chore: 更新分支图与预览截图', merge: false, fileCount: 2,
      files: ['assets/branch-graph.svg', 'docs/ui-preview/wide-light.png'],
    },
    {
      hash: '73ac90fe41ee77c2b5685a0c9d2f41ab0c58b3d1', author: 'Zhao Min', timestamp: '2026-10-28T17:40:00.000Z',
      subject: 'fix: 提交详情中的重命名路径显示旧文件名', merge: false, fileCount: 3, additions: 18, deletions: 6,
      files: ['src/client/ui/detail.ts', 'src/client/ui/history.ts', 'src/client/format.ts'],
    },
    {
      hash: '41ee77c2f1c0a9e4b5685a0c9d2f41ab73ac90fe', author: 'Sun Qi', timestamp: '2026-10-28T15:22:00.000Z',
      subject: 'refactor: 收敛主题变量到 --swl-* 并移除硬编码色值', merge: false, fileCount: 5, additions: 96, deletions: 158,
      files: ['src/client/styles.ts', 'src/client/ui/swimlane.ts', 'src/client/ui/hotspots.ts', 'src/shared/contracts.ts', 'docs/ARCHITECTURE.md'],
    },
    {
      hash: 'f1c0a9e4b5685a0c9d2f41ab73ac90fe41ee77c2', author: 'Chen Yu', timestamp: '2026-10-28T11:08:00.000Z',
      subject: 'test: 补充热点聚合边界用例', merge: false, fileCount: 2, additions: 232, deletions: 12,
      files: ['src/tests/hotspots.test.ts', 'src/host/services/stats-service.ts'],
    },
    {
      hash: 'b5685a0c9d2f41ab73ac90fe41ee77c2f1c0a9e4', author: 'Lin Wei', timestamp: '2026-10-27T09:12:00.000Z',
      subject: 'feat(timeline): 紧凑工具栏、提交图与增删统计', merge: false, fileCount: 7, additions: 214, deletions: 158,
      files: ['src/client/components.ts', 'src/client/styles.ts', 'src/client/ui/history.ts', 'src/client/ui/detail.ts'],
    },
    {
      hash: 'de72be4b5685a0c9d2f41ab73ac90fe41ee77c2', author: 'Wang Bo', timestamp: '2026-10-26T17:05:00.000Z',
      subject: 'docs: 兼容性记录补充右侧栏 slot 契约', merge: false, fileCount: 1, additions: 64, deletions: 4,
      files: ['docs/ARCHITECTURE.md'],
    },
    {
      hash: 'a1f30d4b5685a0c9d2f41ab73ac90fe41ee77c2', author: 'Lin Wei', timestamp: '2026-10-25T15:02:00.000Z',
      subject: 'chore: 引入 JSONL 审计存储与写入串行化', merge: false, fileCount: 5, additions: 432, deletions: 12,
      files: ['src/host/services/stats-service.ts', 'src/host/routes.ts', 'src/client/ui/audit.ts'],
    },
    {
      hash: '66826a8b5685a0c9d2f41ab73ac90fe41ee77c2', author: 'Chen Yu', timestamp: '2026-10-24T09:36:00.000Z',
      subject: 'style: 调整胶囊徽标与分组标题密度', merge: false, fileCount: 2, additions: 28, deletions: 12,
      files: ['src/client/styles.ts', 'src/client/ui/toolbar.ts'],
    },
  ],
  daily: [
    // 20 recent UTC days: a realistic weekday/weekend rhythm, one empty day and
    // one day whose line stats the VCS did not report (churn: null, level 0).
    { date: '2026-10-10', commits: 3, files: 8, additions: 220, deletions: 90 },
    { date: '2026-10-11', commits: 1, files: 3, additions: 60, deletions: 20 },
    { date: '2026-10-12', commits: 6, files: 14, additions: 480, deletions: 160 },
    { date: '2026-10-13', commits: 8, files: 19, additions: 690, deletions: 240 },
    { date: '2026-10-14', commits: 4, files: 11, additions: 310, deletions: 120 },
    { date: '2026-10-15', commits: 7, files: 16, additions: 560, deletions: 190 },
    { date: '2026-10-16', commits: 5, files: 12, additions: 420, deletions: 150 },
    { date: '2026-10-17', commits: 2, files: 6, additions: 140, deletions: 60 },
    { date: '2026-10-18', commits: 0, files: 0, additions: 0, deletions: 0 },
    { date: '2026-10-19', commits: 9, files: 21, additions: 780, deletions: 260 },
    { date: '2026-10-20', commits: 6, files: 15, additions: 510, deletions: 180 },
    { date: '2026-10-21', commits: 5, files: 13 },
    { date: '2026-10-22', commits: 8, files: 18, additions: 640, deletions: 230 },
    { date: '2026-10-23', commits: 10, files: 24, additions: 880, deletions: 310 },
    { date: '2026-10-24', commits: 3, files: 9, additions: 210, deletions: 80 },
    { date: '2026-10-25', commits: 1, files: 4, additions: 70, deletions: 30 },
    { date: '2026-10-26', commits: 7, files: 17, additions: 600, deletions: 210 },
    { date: '2026-10-27', commits: 12, files: 28, additions: 1_100, deletions: 420 },
    { date: '2026-10-28', commits: 6, files: 15, additions: 520, deletions: 190 },
    { date: '2026-10-29', commits: 9, files: 22, additions: 810, deletions: 300 },
  ],
  scannedCommits: 187,
  truncated: true,
  scope: {
    branch: 'feature/sidebar-timeline',
    mergesIncluded: true,
    since: '2026-10-01T00:00:00.000Z',
    windowCommits: 500,
  },
  computedAt: '2026-10-29T02:45:00.000Z',
  cached: true,
}

/**
 * Push operations for the calendar's `pushes` metric: six successful pushes on
 * four UTC days plus one failed push on a day that already has a success, so a
 * wrong filter (counting every push attempt) changes the total from 6 to 7.
 */
const hotspotPushes: OperationAttempt[] = [
  {
    schemaVersion: 1, id: 'push-2026-10-23-a', repositoryId: repository.id, vcsType: 'git',
    operation: 'push', state: 'succeeded', actor: 'user-via-plugin',
    startedAt: '2026-10-23T09:12:00.000Z', finishedAt: '2026-10-23T09:12:06.000Z',
    requestSummary: 'push feature/sidebar-timeline to origin',
    beforeRevision: 'b5685a0c', afterRevision: '9d2f41ab', exitCode: 0,
    correlationId: 'corr-push-1023-a', remoteOutcome: 'confirmed-success',
  },
  {
    schemaVersion: 1, id: 'push-2026-10-27-a', repositoryId: repository.id, vcsType: 'git',
    operation: 'push', state: 'succeeded', actor: 'user-via-plugin',
    startedAt: '2026-10-27T08:40:00.000Z', finishedAt: '2026-10-27T08:40:04.000Z',
    requestSummary: 'push feature/sidebar-timeline to origin',
    beforeRevision: '9d2f41ab', afterRevision: '73ac90fe', exitCode: 0,
    correlationId: 'corr-push-1027-a', remoteOutcome: 'confirmed-success',
  },
  {
    schemaVersion: 1, id: 'push-2026-10-27-b', repositoryId: repository.id, vcsType: 'git',
    operation: 'push', state: 'succeeded', actor: 'user-via-plugin',
    startedAt: '2026-10-27T14:05:00.000Z', finishedAt: '2026-10-27T14:05:05.000Z',
    requestSummary: 'push feature/sidebar-timeline to origin',
    beforeRevision: '73ac90fe', afterRevision: '41ee77c2', exitCode: 0,
    correlationId: 'corr-push-1027-b', remoteOutcome: 'confirmed-success',
  },
  {
    schemaVersion: 1, id: 'push-2026-10-27-c-failed', repositoryId: repository.id, vcsType: 'git',
    operation: 'push', state: 'failed', actor: 'user-via-plugin',
    startedAt: '2026-10-27T16:30:00.000Z', finishedAt: '2026-10-27T16:30:03.000Z',
    requestSummary: 'push feature/sidebar-timeline to origin',
    beforeRevision: '41ee77c2', exitCode: 128, errorCode: 'operation-failed',
    safeErrorMessage: 'fatal: unable to access remote: Could not resolve host',
    correlationId: 'corr-push-1027-c', remoteOutcome: 'confirmed-failure',
  },
  {
    schemaVersion: 1, id: 'push-2026-10-28-a', repositoryId: repository.id, vcsType: 'git',
    operation: 'push', state: 'succeeded', actor: 'user-via-plugin',
    startedAt: '2026-10-28T10:20:00.000Z', finishedAt: '2026-10-28T10:20:07.000Z',
    requestSummary: 'push feature/sidebar-timeline to origin',
    beforeRevision: '41ee77c2', afterRevision: 'b5685a0c', exitCode: 0,
    correlationId: 'corr-push-1028-a', remoteOutcome: 'confirmed-success',
  },
  {
    schemaVersion: 1, id: 'push-2026-10-29-a', repositoryId: repository.id, vcsType: 'git',
    operation: 'push', state: 'succeeded', actor: 'user-via-plugin',
    startedAt: '2026-10-29T02:41:00.000Z', finishedAt: '2026-10-29T02:41:05.000Z',
    requestSummary: 'push feature/sidebar-timeline to origin',
    beforeRevision: 'b5685a0c', afterRevision: '9d2f41ab', exitCode: 0,
    correlationId: 'corr-push-1029-a', remoteOutcome: 'confirmed-success',
  },
  {
    schemaVersion: 1, id: 'push-2026-10-29-b', repositoryId: repository.id, vcsType: 'git',
    operation: 'push', state: 'succeeded', actor: 'user-via-plugin',
    startedAt: '2026-10-29T09:05:00.000Z', finishedAt: '2026-10-29T09:05:04.000Z',
    requestSummary: 'push feature/sidebar-timeline to origin',
    beforeRevision: '9d2f41ab', afterRevision: '73ac90fe', exitCode: 0,
    correlationId: 'corr-push-1029-b', remoteOutcome: 'confirmed-success',
  },
]

/** Fixed "now" for the calendar scenarios, so the grid anchor is deterministic. */
const HOTSPOT_NOW = Date.parse('2026-10-29T06:00:00.000Z')

/** One preview scenario: a state, a theme and the stage size it needs. */
interface Scenario {
  name: string
  theme: 'light' | 'dark'
  state: PanelState
  width?: number
  height?: number
  /** Fixed wall clock for previews whose layout depends on "today" (calendar). */
  now?: number
}

const scenarios: Scenario[] = [
  { name: 'list-light', theme: 'light', state: stateWith({ expandedDirs: { src: true, 'src/client': true } }) },
  { name: 'list-dark', theme: 'dark', state: stateWith({ expandedDirs: { src: true, 'src/client': true } }) },
  {
    name: 'tree-file-light',
    theme: 'light',
    state: stateWith({
      selectedFilePath: 'src/client/ui/detail.ts',
      expandedDirs: { src: true, 'src/client': true, 'src/client/ui': true },
    }),
  },
  {
    name: 'wide-light',
    theme: 'light',
    width: 1600,
    height: 900,
    state: stateWith({ expandedDirs: { src: true, 'src/client': true } }),
  },
  {
    name: 'wide-dark',
    theme: 'dark',
    width: 1600,
    height: 900,
    state: stateWith({
      selectedFilePath: 'src/client/ui/detail.ts',
      expandedDirs: { src: true, 'src/client': true, 'src/client/ui': true },
    }),
  },
  {
    name: 'pr-list-light',
    theme: 'light',
    width: 1600,
    height: 900,
    state: stateWith({ source: 'pr', pullRequests: { ...initial.pullRequests, data: pullRequests, compare: branchCompare } }),
  },
  {
    name: 'pr-auth-light',
    theme: 'light',
    width: 1600,
    height: 900,
    state: stateWith({
      source: 'pr',
      pullRequests: { ...initial.pullRequests, error: { code: 'auth-required', message: 'token missing' }, compare: branchCompare },
    }),
  },
  {
    name: 'file-diff-light',
    theme: 'light',
    width: 1600,
    height: 900,
    state: stateWith({
      selectedFilePath: 'src/client/ui/history.ts',
      expandedDirs: { src: true, 'src/client': true, 'src/client/ui': true },
      diff: { filePath: 'src/client/ui/history.ts', data: diff, loading: false, error: null },
    }),
  },
  {
    name: 'detail-light',
    theme: 'light',
    state: stateWith({
      changeSet: { event: events[0]!, revision: changeSet.revision, data: changeSet, loading: false, error: null },
    }),
  },
  {
    name: 'diff-light',
    theme: 'light',
    state: stateWith({
      changeSet: { event: events[0]!, revision: changeSet.revision, data: changeSet, loading: false, error: null },
      diff: { filePath: diff.filePath ?? '', data: diff, loading: false, error: null },
    }),
  },
  { name: 'audit-light', theme: 'light', state: stateWith({ source: 'audit', audit: { ...initial.audit, operations: attempts } }) },
  {
    name: 'audit-detail-light',
    theme: 'light',
    state: stateWith({ source: 'audit', audit: { ...initial.audit, operations: attempts, selected: attempts[1]! } }),
  },
  {
    name: 'dialog-light',
    theme: 'light',
    state: stateWith({
      dialog: {
        operation: 'commit',
        phase: 'previewed',
        preview: {
          repositoryId: repository.id,
          operation: 'commit',
          allowed: true,
          summary: 'commit 3 staged path(s) on feature/sidebar-timeline',
          argv: ['git', '--no-pager', 'commit', '-m', 'feat(timeline): 紧凑工具栏、提交图与增删统计'],
          before: { branch: 'feature/sidebar-timeline', revision: '9d2f41ab', clean: false, stagedFiles: ['a.ts', 'b.ts', 'c.ts'], ahead: 2, behind: 0 },
          warnings: ['the branch is 2 commit(s) ahead of its upstream'],
          confirmationToken: 'fixture-token',
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        },
        previewError: null,
        executeError: null,
        result: null,
        message: 'feat(timeline): 紧凑工具栏、提交图与增删统计',
        remote: 'origin',
        branch: 'feature/sidebar-timeline',
        checks: {
          repositoryId: repository.id,
          scope: 'staged',
          findings: [{ rule: 'lockfile', severity: 'warning', path: 'package-lock.json' }],
          filesChecked: 3,
          truncated: false,
          empty: false,
          generatedAt: '2026-10-27T09:20:11.000Z',
        },
        checksLoading: false,
        acknowledged: false,
      },
    }),
  },
  { name: 'menu-light', theme: 'light', state: stateWith({ menuOpen: true }) },
  {
    name: 'dialog-dark',
    theme: 'dark',
    state: stateWith({
      dialog: {
        operation: 'commit',
        phase: 'previewed',
        preview: {
          repositoryId: repository.id,
          operation: 'commit',
          allowed: true,
          summary: 'commit 3 staged path(s) on feature/sidebar-timeline',
          argv: ['git', '--no-pager', 'commit', '-m', 'feat(timeline): 紧凑工具栏、提交图与增删统计'],
          before: { branch: 'feature/sidebar-timeline', revision: '9d2f41ab', clean: false, stagedFiles: ['a.ts', 'b.ts', 'c.ts'], ahead: 2, behind: 0 },
          warnings: ['the branch is 2 commit(s) ahead of its upstream'],
          confirmationToken: 'fixture-token',
          expiresAt: new Date(Date.now() + 120_000).toISOString(),
        },
        previewError: null,
        executeError: null,
        result: null,
        message: 'feat(timeline): 紧凑工具栏、提交图与增删统计',
        remote: 'origin',
        branch: 'feature/sidebar-timeline',
        checks: {
          repositoryId: repository.id,
          scope: 'staged',
          findings: [{ rule: 'lockfile', severity: 'warning', path: 'package-lock.json' }],
          filesChecked: 3,
          truncated: false,
          empty: false,
          generatedAt: '2026-10-27T09:20:11.000Z',
        },
        checksLoading: false,
        acknowledged: false,
      },
    }),
  },
  { name: 'diagnostics-light', theme: 'light', state: stateWith({ diagnosticsOpen: true }) },
  { name: 'loading-dark', theme: 'dark', state: { ...initial, boot: 'loading' } },
  {
    name: 'loading-skeleton-light',
    theme: 'light',
    width: 1600,
    height: 900,
    // First timeline page: the gray layout skeleton with its white sweep.
    state: stateWith({ timeline: { ...initial.timeline, events: [], loading: true } }),
  },
  {
    name: 'loading-skeleton-dark',
    theme: 'dark',
    width: 1600,
    height: 900,
    state: stateWith({ timeline: { ...initial.timeline, events: [], loading: true } }),
  },
  {
    name: 'empty-repos-light',
    theme: 'light',
    state: { ...initial, boot: 'ready', repositories: [], noWorkspace: false, diagnostics },
  },
  {
    name: 'uninitialized-light',
    theme: 'light',
    state: stateWith({
      repositories: [{ ...repository, currentRevision: undefined }],
      timeline: { ...initial.timeline, events: [], warnings: ['this repository has no commits yet'] },
    }),
  },
  {
    name: 'hotspot-files-light',
    theme: 'light',
    width: 1600,
    height: 900,
    state: stateWith({
      source: 'hotspots',
      hotspots: { ...initial.hotspots, data: hotspotReport, dimension: 'files' },
    }),
  },
  {
    name: 'hotspot-authors-light',
    theme: 'light',
    width: 1600,
    height: 900,
    state: stateWith({
      source: 'hotspots',
      hotspots: { ...initial.hotspots, data: hotspotReport, dimension: 'authors' },
    }),
  },
  {
    name: 'hotspot-activity-light',
    theme: 'light',
    width: 1600,
    height: 900,
    state: stateWith({
      source: 'hotspots',
      hotspots: { ...initial.hotspots, data: hotspotReport, dimension: 'activity' },
    }),
  },
  {
    name: 'hotspot-authors-dark',
    theme: 'dark',
    width: 1600,
    height: 900,
    state: stateWith({
      source: 'hotspots',
      hotspots: { ...initial.hotspots, data: hotspotReport, dimension: 'authors' },
    }),
  },
  {
    name: 'hotspot-calendar-churn-light',
    theme: 'light',
    width: 1600,
    height: 900,
    now: HOTSPOT_NOW,
    state: stateWith({
      source: 'hotspots',
      hotspots: { ...initial.hotspots, data: hotspotReport, dimension: 'calendar', calendarMetric: 'churn' },
      audit: { ...initial.audit, operations: hotspotPushes },
    }),
  },
  {
    name: 'hotspot-calendar-pushes-light',
    theme: 'light',
    width: 1600,
    height: 900,
    now: HOTSPOT_NOW,
    state: stateWith({
      source: 'hotspots',
      hotspots: { ...initial.hotspots, data: hotspotReport, dimension: 'calendar', calendarMetric: 'pushes' },
      audit: { ...initial.audit, operations: hotspotPushes },
    }),
  },
  {
    name: 'hotspot-calendar-churn-dark',
    theme: 'dark',
    width: 1600,
    height: 900,
    now: HOTSPOT_NOW,
    state: stateWith({
      source: 'hotspots',
      hotspots: { ...initial.hotspots, data: hotspotReport, dimension: 'calendar', calendarMetric: 'churn' },
      audit: { ...initial.audit, operations: hotspotPushes },
    }),
  },
  {
    name: 'hotspot-calendar-sidebar',
    theme: 'light',
    width: 420,
    height: 900,
    now: HOTSPOT_NOW,
    state: stateWith({
      source: 'hotspots',
      hotspots: { ...initial.hotspots, data: hotspotReport, dimension: 'calendar', calendarMetric: 'churn' },
      audit: { ...initial.audit, operations: hotspotPushes },
    }),
  },
  {
    name: 'pr-dashboard-light',
    theme: 'light',
    width: 1600,
    height: 900,
    now: HOTSPOT_NOW,
    state: stateWith({
      source: 'pr',
      pullRequests: { ...initial.pullRequests, data: prAnalyticsList, filter: 'all' },
    }),
  },
  {
    name: 'pr-dashboard-conflicts-light',
    theme: 'light',
    width: 1600,
    height: 900,
    now: HOTSPOT_NOW,
    state: stateWith({
      source: 'pr',
      pullRequests: { ...initial.pullRequests, data: prAnalyticsList, filter: 'conflicts' },
    }),
  },
  {
    name: 'pr-dashboard-anonymous-light',
    theme: 'light',
    width: 1600,
    height: 900,
    now: HOTSPOT_NOW,
    state: stateWith({
      source: 'pr',
      pullRequests: { ...initial.pullRequests, data: prAnalyticsAnonymous, filter: 'all' },
    }),
  },
  {
    name: 'pr-dashboard-dark',
    theme: 'dark',
    width: 1600,
    height: 900,
    now: HOTSPOT_NOW,
    state: stateWith({
      source: 'pr',
      pullRequests: { ...initial.pullRequests, data: prAnalyticsList, filter: 'all' },
    }),
  },
  {
    name: 'pr-dashboard-sidebar',
    theme: 'light',
    width: 420,
    height: 900,
    now: HOTSPOT_NOW,
    state: stateWith({
      source: 'pr',
      pullRequests: { ...initial.pullRequests, data: prAnalyticsList, filter: 'all' },
    }),
  },
]

/**
 * The standalone `SwimlaneDemo` page at the two widths that matter: the full
 * 1440x900 page from the design brief, and the 420px plugin right sidebar.
 * The demo carries its own stylesheet and mock data; only the DSH theme tokens
 * come from the shared wrapper, exactly like the panel previews.
 */
interface DemoStage {
  name: string
  width: number
  height: number
}

const demoStages: DemoStage[] = [
  { name: 'swimlane-wide', width: 1440, height: 900 },
  { name: 'swimlane-sidebar', width: 420, height: 900 },
]

const demoOnly = process.argv.includes('--demo-only')

/**
 * Undo React's server-render text escaping inside `<style>` blocks.
 *
 * `<style>` is a raw-text element: browsers do not decode `&quot;` / `&gt;`
 * inside it, and React escapes text children during SSR. Left as-is, every
 * attribute selector (`[data-merge="true"]`, `[aria-selected="true"]`, …) and
 * child combinator would silently drop out of the preview stylesheet, so the
 * static shots would not match what the browser-side React render produces.
 */
function unescapeStyleBlocks(markup: string): string {
  return markup.replace(/<style>([\s\S]*?)<\/style>/g, (_match, css: string) => {
    const text = css
      .replaceAll('&quot;', '"')
      .replaceAll('&gt;', '>')
      .replaceAll('&lt;', '<')
      .replaceAll('&#x27;', "'")
      .replaceAll('&amp;', '&')
    return `<style>${text}</style>`
  })
}

const PAGE = (
  tokens: Record<string, string>,
  panel: string,
  width: number,
  height: number,
): string => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>dsh-vcs-timeline preview</title>
<style>
  :root { ${Object.entries(tokens).map(([key, value]) => `${key}: ${value};`).join('\n    ')} }
  html, body { margin: 0; padding: 0; height: 100%; }
  body { background: var(--dsw-alias-bg-base); font-family: "Segoe UI", system-ui, sans-serif; }
  .stage { width: ${width}px; height: ${height}px; display: flex; overflow: hidden; }
  .stage > * { flex: 1 1 auto; }
</style></head>
<body><div class="stage" data-stage="${width}x${height}">${panel}</div></body></html>`

await mkdir(outDir, { recursive: true })
if (demoOnly) {
  console.log('rendering demo stages only (--demo-only)')
} else {
  for (const scenario of scenarios) {
    const deps = {
      t,
      locale: 'zh-CN',
      ...(scenario.now === undefined ? {} : { now: () => scenario.now as number }),
    }
    const panel = unescapeStyleBlocks(renderToStaticMarkup(renderPanelView({
      state: scenario.state,
      deps,
      handlers: createNoopHandlers(),
    })))
    const tokens = scenario.theme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS
    const html = PAGE(tokens, panel, scenario.width ?? 400, scenario.height ?? 900)
    await writeFile(resolve(outDir, `${scenario.name}.html`), html, 'utf8')
  }
}

// The demo is pure and takes no props, so one SSR pass feeds both stages.
const demoMarkup = unescapeStyleBlocks(renderToStaticMarkup(createElement(SwimlaneDemo)))
for (const stage of demoStages) {
  const html = PAGE(LIGHT_TOKENS, demoMarkup, stage.width, stage.height)
  await writeFile(resolve(outDir, `${stage.name}.html`), html, 'utf8')
}

await writeFile(resolve(outDir, 'render.md'), [
  '# UI 预览（设计验证用）',
  '',
  '这些页面由 `scripts/render-preview.ts` 用**固定示例数据**渲染真实的面板组件，',
  '用于检查密度、层级与明暗主题（400px 侧栏宽度，以及 1600px 对话区宽度）。',
  '它们不是运行时截图：亮/暗 token 取自安装的 DSH 单色主题——`--dsw-alias-brand-primary` 是单色',
  '`#0f1115`（亮）/ `#f5f6f8`（暗），不是蓝色强调色；图表与热力的蓝紫色只来自面板样式表里的',
  '`--dvt-data-blue` / `--dvt-data-purple`，因此两套 token 下数据色保持一致。',
  '',
  '截图前会把 SSR 生成的 `<style>` 内容反转义（React 服务端渲染会转义文本，而 `<style>` 是原始文本元素，',
  '不反转义的话 `[data-*="…"]` 属性选择器与子选择器会在预览样式表里静默失效）。',
  '',
  '重新生成：',
  '',
  '```powershell',
  'node --experimental-strip-types scripts/render-preview.ts',
  'node scripts/preview-shots.mjs   # 用本机 Edge 无头模式截图',
  '```',
  '',
  '场景：文件树 + 时间线（亮/暗，侧栏与宽屏）、单文件三栏（树 | Diff | 操作信息）、提交详情、',
  'PR 列表 / 未认证提示、审计列表/详情、写操作确认、操作菜单、诊断展开、加载中、空仓库、未初始化仓库。',
  '',
  '热点仪表盘（`source: hotspots`，1600×900）：`hotspot-files-light` / `hotspot-authors-light` /',
  '`hotspot-activity-light` 三个维度各一个亮色场景，外加 `hotspot-authors-dark` 验证暗色 token；',
  '固定报告里包含 20 个文件的 churn 长尾、6 位贡献者（含一位 churn 未知）、10 条近期提交（含合并、',
  '文件列表被截断与纯二进制提交）。',
  '',
  '活动日历（热点默认维度）：`hotspot-calendar-churn-light`（1600×900，代码修改量热力）、',
  '`hotspot-calendar-pushes-light`（推送次数热力，审计 fixture 含 6 次成功推送 + 1 次失败推送）、',
  '`hotspot-calendar-churn-dark`（暗色）与 `hotspot-calendar-sidebar`（420×900，单列 + 日历横向滚动）。',
  '固定日数据覆盖最近 20 个 UTC 日（含一个零提交日与一个未提供行级统计的日），窗口外与未来格分别淡显。',
  '',
  'PR 分析看板（`source: pr`，1600×900）：`pr-dashboard-light`（filter=all）、',
  '`pr-dashboard-conflicts-light`（filter=conflicts，只保留冲突行）、`pr-dashboard-anonymous-light`',
  '（`authenticated:false`，合并数显示不可用并给诚实提示）、`pr-dashboard-dark` 与',
  '`pr-dashboard-sidebar`（420×900，单列）。fixture 含可合并 / 冲突 / 草稿 / 修改意见 / 已合并（mergedAt）/',
  '已关闭 / 可合并性未知的 PR、4 位作者与 30 天合并窗口（`historyTruncated:true`）。',
  '',
  '另外两个场景渲染独立演示页 `SwimlaneDemo`（`src/client/ui/swimlane.ts`，自带样式与 MOCK 数据）：',
  '`swimlane-wide`（1440×900，260px 文件树 + 页头/工具栏 + 多轨道泳道）与',
  '`swimlane-sidebar`（420×900，插件右侧栏宽度，窄屏下文件树折叠为抽屉）。',
  '只重建这两个演示页时可用 `node --experimental-strip-types scripts/render-preview.ts --demo-only`。',
].join('\n'), 'utf8')

console.log([
  `rendered ${demoStages.length} demo stage(s)`,
  demoOnly ? '(demo only)' : `and ${scenarios.length} panel preview page(s)`,
  `into ${outDir}`,
].join(' '))
