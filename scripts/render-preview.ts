/**
 * Render static previews of the panel for visual review.
 *
 * This is a design-verification aid, not a product feature: it renders the
 * real `renderPanelView` with fixture data into standalone HTML pages, using a
 * neutral approximation of the DSH light/dark theme tokens so a 400px-wide
 * Chromium screenshot shows the intended density and hierarchy. The live app
 * uses the real `--dsw-*` tokens from the host theme.
 *
 * Usage: node --experimental-strip-types scripts/render-preview.ts
 * Output: docs/ui-preview/*.html (screenshot with docs/ui-preview/render.md)
 * @module scripts/render-preview
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  ChangeSet,
  Diagnostics,
  DiffResult,
  OperationAttempt,
  Repository,
  VcsEvent,
  WorkingTreeStatus,
} from '../src/shared/contracts.ts'
import { createNoopHandlers, createInitialState, type PanelState } from '../src/client/types.ts'
import { renderPanelView } from '../src/client/components.ts'
import { createTranslator } from '../src/client/i18n.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'docs/ui-preview')
const t = createTranslator('zh')

const LIGHT_TOKENS: Record<string, string> = {
  '--dsw-alias-bg-base': '#ffffff',
  '--dsw-alias-bg-layer-1': '#f7f8fa',
  '--dsw-alias-bg-layer-2': '#eceff3',
  '--dsw-alias-bg-overlay': '#ffffff',
  '--dsw-alias-bg-mask-drop': 'rgba(15, 23, 42, 0.32)',
  '--dsw-alias-border-l1': '#e3e6ea',
  '--dsw-alias-border-l2': '#cfd4da',
  '--dsw-alias-label-primary': '#1c2229',
  '--dsw-alias-label-secondary': '#4d5865',
  '--dsw-alias-label-tertiary': '#7d8894',
  '--dsw-alias-brand-primary': '#2f6feb',
  '--dsw-alias-state-success-primary': '#1a7f37',
  '--dsw-alias-state-error-primary': '#cf222e',
  '--dsw-alias-state-warn-primary': '#9a6700',
  '--dsw-alias-interactive-hover': 'rgba(15, 23, 42, 0.05)',
  '--dsw-alias-interactive-pressed': 'rgba(15, 23, 42, 0.09)',
  '--dsw-alias-interactive-selected': 'rgba(47, 111, 235, 0.10)',
  '--dsw-specific-sidebar-fill': '#f6f8fa',
  '--dsw-specific-button-secondary-fill': '#ffffff',
  '--dsw-alias-bg-mask-drop-x': 'rgba(15, 23, 42, 0.32)',
}

const DARK_TOKENS: Record<string, string> = {
  '--dsw-alias-bg-base': '#0d1117',
  '--dsw-alias-bg-layer-1': '#161b22',
  '--dsw-alias-bg-layer-2': '#20262e',
  '--dsw-alias-bg-overlay': '#161b22',
  '--dsw-alias-bg-mask-drop': 'rgba(0, 0, 0, 0.55)',
  '--dsw-alias-border-l1': '#232a33',
  '--dsw-alias-border-l2': '#333c47',
  '--dsw-alias-label-primary': '#e6edf3',
  '--dsw-alias-label-secondary': '#a7b1bd',
  '--dsw-alias-label-tertiary': '#7d8894',
  '--dsw-alias-brand-primary': '#58a6ff',
  '--dsw-alias-state-success-primary': '#3fb950',
  '--dsw-alias-state-error-primary': '#f85149',
  '--dsw-alias-state-warn-primary': '#d29922',
  '--dsw-alias-interactive-hover': 'rgba(255, 255, 255, 0.06)',
  '--dsw-alias-interactive-pressed': 'rgba(255, 255, 255, 0.10)',
  '--dsw-alias-interactive-selected': 'rgba(88, 166, 255, 0.14)',
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
    parentHashes: input.parents ?? ['0000000000000000000000000000000000000000'],
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
    parents: ['1a2b3c4d5e6f', '9d2f41ab0000'],
    files: [],
  }),
  commit({
    hash: '41ee77c2',
    summary: 'fix: 提交详情中的重命名路径显示旧文件名，并补齐二进制标记',
    actor: 'Zhao Min',
    time: '2026-10-26T11:28:00.000Z',
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

/** One preview scenario: a state, a theme and the stage size it needs. */
interface Scenario {
  name: string
  theme: 'light' | 'dark'
  state: PanelState
  mode?: 'sidebar' | 'overlay'
  width?: number
  height?: number
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
    name: 'overlay-light',
    theme: 'light',
    mode: 'overlay',
    width: 1440,
    height: 900,
    state: stateWith({ expandedDirs: { src: true, 'src/client': true } }),
  },
  {
    name: 'overlay-dark',
    theme: 'dark',
    mode: 'overlay',
    width: 1440,
    height: 900,
    state: stateWith({
      selectedFilePath: 'src/client/ui/detail.ts',
      expandedDirs: { src: true, 'src/client': true, 'src/client/ui': true },
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
      },
    }),
  },
  { name: 'diagnostics-light', theme: 'light', state: stateWith({ diagnosticsOpen: true }) },
  { name: 'loading-dark', theme: 'dark', state: { ...initial, boot: 'loading' } },
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
]

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
for (const scenario of scenarios) {
  const overlay = scenario.mode === 'overlay'
  const panel = renderToStaticMarkup(renderPanelView({
    state: scenario.state,
    deps: { t, locale: 'zh-CN' },
    handlers: createNoopHandlers(),
    ...(overlay
      ? {
        mode: 'overlay' as const,
        fullscreen: false,
        onClose: () => {},
        onToggleFullscreen: () => {},
      }
      : {}),
  }))
  const tokens = scenario.theme === 'dark' ? DARK_TOKENS : LIGHT_TOKENS
  const html = PAGE(tokens, panel, scenario.width ?? 400, scenario.height ?? 900)
  await writeFile(resolve(outDir, `${scenario.name}.html`), html, 'utf8')
}

await writeFile(resolve(outDir, 'render.md'), [
  '# UI 预览（设计验证用）',
  '',
  '这些页面由 `scripts/render-preview.ts` 用**固定示例数据**渲染真实的面板组件，',
  '用于检查密度、层级与明暗主题（400px 侧栏宽度，以及 1440px 全屏浮层）。',
  '它们不是运行时截图：颜色使用近似 DSH 主题 token 的调色板，实际运行时颜色来自宿主 `--dsw-*` token。',
  '',
  '重新生成：',
  '',
  '```powershell',
  'node --experimental-strip-types scripts/render-preview.ts',
  'node scripts/preview-shots.mjs   # 用本机 Edge 无头模式截图',
  '```',
  '',
  '场景：文件树 + 变更时间线（亮/暗）、单文件时间线、全屏浮层（亮/暗）、提交详情、Diff、',
  '审计列表/详情、写操作确认、操作菜单、诊断展开、加载中、空仓库、未初始化仓库。',
].join('\n'), 'utf8')

console.log(`rendered ${scenarios.length} preview pages into ${outDir}`)
