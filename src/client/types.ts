/**
 * dsh-vcs-timeline — client-side panel state model.
 *
 * The panel keeps one immutable state object; every slice below is either a
 * loaded value, a loading flag, or one stable {@link ApiError}. Separating
 * repository history (`timeline`) from plugin audit (`audit`) is structural,
 * not cosmetic: the two never share a list or a badge.
 * @module dsh-vcs-timeline/client/types
 */

import type {
  ApiError,
  BranchCompare,
  ChangeSet,
  ChecksReport,
  Diagnostics,
  DiffResult,
  FileChangeStatus,
  HotspotReport,
  OperationAttempt,
  OperationPreview,
  OperationState,
  OperationType,
  PullRequestDetail,
  PullRequestList,
  Repository,
  SessionChanges,
  VcsEvent,
  VcsEventType,
  WorkingTreeStatus,
  WorktreeDiffResult,
} from '../shared/contracts.ts'
import type * as React from 'react'
import type { VcsClient } from './api.ts'
import type { TranslateFn } from './i18n.ts'

/** Which source the panel body currently lists. */
export type PanelSource = 'timeline' | 'pending' | 'hotspots' | 'pr' | 'audit'

/** Which side of the working tree a diff/checks request describes. */
export type ChecksScope = 'staged' | 'worktree'

/** Sort keys of the hotspot table (client-side re-ordering only). */
export type HotspotSort = 'churn' | 'commits' | 'authors' | 'recent'

/** Server-side history window presets offered by the time filter. */
export type TimePreset = 'all' | '24h' | '7d' | '30d'

/** Debounced filter state plus the raw search box text. */
export interface FilterState {
  /** Current value of the search input. */
  text: string
  /** Debounced value that actually reaches the Host. */
  debouncedText: string
  /** Active event-type chips; empty means "全部". */
  eventTypes: VcsEventType[]
  /** Author filter text. */
  author: string
  /** Whether the advanced filter row is expanded. */
  showAuthor: boolean
  /** File-name search inside the tree pane (client-side only). */
  treeQuery: string
  /** Change-status filter shared by the tree and the timeline (client-side). */
  fileStatus: FileChangeStatus | 'all'
  /** Audit lifecycle filter (client-side, audit source only). */
  auditState: OperationState | 'all'
  /** History window preset, applied by the Host when the page is fetched. */
  timePreset: TimePreset
  /** Branch decoration the user clicked; empty means every loaded branch. */
  branch: string
  /** `current` walks HEAD only; `all` walks every local branch. */
  branchScope: 'current' | 'all'
  /** Interleave plugin-audit operation nodes into the commit timeline. */
  auditInTimeline: boolean
}

/** Repository-history page state. */
export interface TimelineSlice {
  events: VcsEvent[]
  cursor: string | null
  hasMore: boolean
  partial: boolean
  warnings: string[]
  loading: boolean
  loadingMore: boolean
  error: ApiError | null
}

/** One open event detail. */
export interface ChangeSetSlice {
  event: VcsEvent | null
  revision: string
  data: ChangeSet | null
  loading: boolean
  error: ApiError | null
}

/** One open file diff. */
export interface DiffSlice {
  filePath: string | null
  data: DiffResult | null
  loading: boolean
  error: ApiError | null
}

/** Plugin-audit page state. */
export interface AuditSlice {
  operations: OperationAttempt[]
  cursor: string | null
  hasMore: boolean
  warnings: string[]
  loading: boolean
  loadingMore: boolean
  error: ApiError | null
  selected: OperationAttempt | null
}

/** Pull-request list/detail state. */
export interface PullRequestSlice {
  data: PullRequestList | null
  loading: boolean
  error: ApiError | null
  /** Selected pull-request number; null means the list only. */
  selectedNumber: number | null
  detail: PullRequestDetail | null
  detailLoading: boolean
  detailError: ApiError | null
  /** Local branch insight (works without any provider network/credentials). */
  compare: BranchCompare | null
  compareLoading: boolean
  compareError: ApiError | null
  /** Bumped by the refresh control. */
  refreshTick: number
}

/** State of the manual "add repository" dialog. */
export interface AddRepositoryState {
  open: boolean
  /** Path typed by the user (repository root or a directory inside it). */
  path: string
  loading: boolean
  error: ApiError | null
}

/** Pending-workbench state: dirty files, their diffs, checks and attribution. */
export interface PendingSlice {
  /** Selected working-tree path, or null while no file is open. */
  path: string | null
  /** Which side the selected diff shows. */
  staged: boolean
  diff: WorktreeDiffResult | null
  diffLoading: boolean
  diffError: ApiError | null
  checks: ChecksReport | null
  checksLoading: boolean
  checksError: ApiError | null
  checksScope: ChecksScope
  /** Session attribution for the current session (inferred, never exact). */
  session: SessionChanges | null
  sessionLoading: boolean
  sessionError: ApiError | null
}

/** File-hotspot ranking state. */
export interface HotspotSlice {
  data: HotspotReport | null
  loading: boolean
  error: ApiError | null
  /** Client-side sort key over the already-loaded rows. */
  sort: HotspotSort
  refreshTick: number
}

/** Lifecycle of the write-operation confirmation dialog. */
export type DialogPhase = 'previewing' | 'previewed' | 'blocked' | 'error' | 'executing' | 'result'

/** One write-operation dialog in flight. */
export interface DialogState {
  operation: OperationType
  phase: DialogPhase
  preview: OperationPreview | null
  previewError: ApiError | null
  executeError: ApiError | null
  result: OperationAttempt | null
  /** Commit message typed by the user; never prefilled from data. */
  message: string
  /** Push remote name typed by the user. */
  remote: string
  /** Push branch typed by the user. */
  branch: string
  /** Pre-commit checks of the staged diff (commit dialog only). */
  checks: ChecksReport | null
  checksLoading: boolean
  /** The user explicitly acknowledged blocking findings. */
  acknowledged: boolean
}

/** Complete panel state. */
export interface PanelState {
  boot: 'loading' | 'ready' | 'error'
  bootError: ApiError | null
  repositories: Repository[]
  diagnostics: Diagnostics | null
  selectedRepositoryId: string | null
  workspacePath: string | null
  noWorkspace: boolean
  source: PanelSource
  filters: FilterState
  /** File whose history the right pane is narrowed to; null = whole repository. */
  selectedFilePath: string | null
  /** Directories the user expanded in the tree, keyed by repository path. */
  expandedDirs: Record<string, boolean>
  refreshTick: number
  statusTick: number
  timeline: TimelineSlice
  changeSet: ChangeSetSlice
  diff: DiffSlice
  audit: AuditSlice
  pullRequests: PullRequestSlice
  status: WorkingTreeStatus | null
  statusLoading: boolean
  statusError: ApiError | null
  /** Dirty-file workbench (diff/checks/attribution) state. */
  pending: PendingSlice
  /** File-hotspot ranking state. */
  hotspots: HotspotSlice
  dialog: DialogState | null
  copied: boolean
  /** The header overflow menu (write operations) is open. */
  menuOpen: boolean
  /** The collapsible diagnostics block above the status bar is open. */
  diagnosticsOpen: boolean
  /** Manual repository addition (needed for checkouts outside DSH workspaces). */
  addRepository: AddRepositoryState
}

/** Every user intent the views can raise. */
export interface PanelHandlers {
  onRefreshRepositories(): void
  onSelectRepository(repositoryId: string): void
  onSetSource(source: PanelSource): void
  onTextChange(text: string): void
  onToggleEventType(eventType: VcsEventType): void
  onShowAllEventTypes(): void
  onAuthorChange(author: string): void
  onToggleAuthor(): void
  onClearFilters(): void
  onLoadMoreTimeline(): void
  onRetryTimeline(): void
  /** Narrow both panes to one repository-relative file; `null` shows all files. */
  onSelectFile(path: string | null): void
  /** Change the tree's file-name search. */
  onTreeQueryChange(query: string): void
  /** Change the status filter shared by the tree and the timeline. */
  onSetFileStatus(status: FileChangeStatus | 'all'): void
  /** Expand/collapse one directory of the tree. */
  onToggleDir(path: string): void
  /** Expand every directory of the current tree. */
  onExpandAllDirs(): void
  /** Collapse every directory of the current tree. */
  onCollapseAllDirs(): void
  /** Change the history window preset (refetches from the Host). */
  onSetTimePreset(preset: TimePreset): void
  onOpenEvent(event: VcsEvent): void
  onBackFromDetail(): void
  onOpenFile(path: string): void
  onBackFromDiff(): void
  onCopyDiff(): void
  onLoadMoreAudit(): void
  onRetryAudit(): void
  /** Reload the pull-request list (bypasses the Host cache). */
  onRefreshPullRequests(): void
  /** Open one pull request's detail in the detail pane. */
  onSelectPullRequest(number: number): void
  /** Show the newest/another commit's diff for the selected file. */
  onOpenFileRevision(revision: string): void
  /** Open/close the manual add-repository dialog. */
  onToggleAddRepository(): void
  /** Update the typed repository path. */
  onAddRepositoryPathChange(path: string): void
  /** Validate and add the typed repository path. */
  onAddRepositorySubmit(): void
  /** Close the pull-request detail pane. */
  onClosePullRequest(): void
  /** Change the audit lifecycle filter. */
  onSetAuditState(state: OperationState | 'all'): void
  onOpenOperation(attempt: OperationAttempt): void
  onBackFromAuditDetail(): void
  onStartOperation(operation: OperationType): void
  onDialogClose(): void
  onDialogMessageChange(message: string): void
  onDialogRemoteChange(remote: string): void
  onDialogBranchChange(branch: string): void
  onDialogConfirm(): void
  onDialogRepreview(): void
  onRetryStatus(): void
  /** Toggle the header overflow menu that holds the write operations. */
  onToggleWriteMenu(): void
  /** Close the overflow menu without choosing an action. */
  onCloseWriteMenu(): void
  /** Toggle the collapsible diagnostics block. */
  onToggleDiagnostics(): void
  /** Open one dirty file's working-tree diff (`staged` selects the index side). */
  onSelectPendingFile(path: string, staged: boolean): void
  onBackFromPendingDiff(): void
  /** Switch the checks report between the staged and working-tree sides. */
  onSetChecksScope(scope: ChecksScope): void
  /** Re-run the pre-commit checks (refresh control). */
  onRefreshChecks(): void
  /** Re-read the current session's touched files. */
  onRefreshSessionChanges(): void
  /** Reload the hotspot ranking (bypasses the Host cache). */
  onRefreshHotspots(): void
  /** Re-sort the already-loaded hotspot rows. */
  onSetHotspotSort(sort: HotspotSort): void
  /** Jump from a hotspot row to that file's history in the timeline. */
  onOpenHotspotFile(path: string): void
  /** Filter history to one branch decoration. */
  onSelectBranch(branch: string): void
  onClearBranchFilter(): void
  /** Toggle "current branch only" vs "all branches" history walking. */
  onSetBranchScope(scope: 'current' | 'all'): void
  /** Interleave plugin-audit operation nodes into the commit timeline. */
  onToggleAuditInTimeline(): void
  /** Acknowledge blocking pre-commit findings so the commit may proceed. */
  onToggleDialogAck(): void
}

/** Service/style dependencies injected once by `index.ts`. */
export interface PanelDeps {
  api: VcsClient
  t: TranslateFn
  /** Locale tag for `Intl.DateTimeFormat`. */
  locale?: string
  /** Clock used by dialogs/tests; defaults to `Date.now`. */
  now?: () => number
  /** Stylesheet override (tests pass an empty string to assert isolation). */
  styles?: string
  /** Resolve the workspace root for the slot's session, or null when unknown. */
  resolveWorkspacePath?: (props: PanelProps) => string | null
}

/** Props the sidebar slot or the Conversation View passes to the panel. */
export interface PanelProps {
  sessionId?: string
  workspacePath?: string | null
}

/** Presentational props of one full panel render. */
export interface PanelViewProps {
  state: PanelState
  deps: PanelDeps
  handlers: PanelHandlers
  /** Attached to the root element so the panel can size itself in a host area. */
  rootRef?: React.Ref<HTMLDivElement>
}

/** Empty repository-history slice. */
export function createTimelineSlice(): TimelineSlice {
  return {
    events: [],
    cursor: null,
    hasMore: false,
    partial: false,
    warnings: [],
    loading: false,
    loadingMore: false,
    error: null,
  }
}

/** Empty change-set slice. */
export function createChangeSetSlice(): ChangeSetSlice {
  return { event: null, revision: '', data: null, loading: false, error: null }
}

/** Empty diff slice. */
export function createDiffSlice(): DiffSlice {
  return { filePath: null, data: null, loading: false, error: null }
}

/** Empty audit slice. */
export function createAuditSlice(): AuditSlice {
  return {
    operations: [],
    cursor: null,
    hasMore: false,
    warnings: [],
    loading: false,
    loadingMore: false,
    error: null,
    selected: null,
  }
}

/** Empty pull-request slice. */
export function createPullRequestSlice(): PullRequestSlice {
  return {
    data: null,
    loading: false,
    error: null,
    selectedNumber: null,
    detail: null,
    detailLoading: false,
    detailError: null,
    compare: null,
    compareLoading: false,
    compareError: null,
    refreshTick: 0,
  }
}

/** Empty add-repository dialog state. */
export function createAddRepositoryState(): AddRepositoryState {
  return { open: false, path: '', loading: false, error: null }
}

/** Empty pending-workbench state. */
export function createPendingSlice(): PendingSlice {
  return {
    path: null,
    staged: false,
    diff: null,
    diffLoading: false,
    diffError: null,
    checks: null,
    checksLoading: false,
    checksError: null,
    checksScope: 'worktree',
    session: null,
    sessionLoading: false,
    sessionError: null,
  }
}

/** Empty hotspot state. */
export function createHotspotSlice(): HotspotSlice {
  return { data: null, loading: false, error: null, sort: 'churn', refreshTick: 0 }
}

/** Fully empty panel state; tests start from here and override slices. */
export function createInitialState(): PanelState {
  return {
    boot: 'loading',
    bootError: null,
    repositories: [],
    diagnostics: null,
    selectedRepositoryId: null,
    workspacePath: null,
    noWorkspace: false,
    source: 'timeline',
    filters: {
      text: '',
      debouncedText: '',
      eventTypes: [],
      author: '',
      showAuthor: false,
      treeQuery: '',
      fileStatus: 'all',
      auditState: 'all',
      timePreset: 'all',
      branch: '',
      branchScope: 'current',
      auditInTimeline: false,
    },
    selectedFilePath: null,
    expandedDirs: {},
    refreshTick: 0,
    statusTick: 0,
    timeline: createTimelineSlice(),
    changeSet: createChangeSetSlice(),
    diff: createDiffSlice(),
    audit: createAuditSlice(),
    pullRequests: createPullRequestSlice(),
    status: null,
    statusLoading: false,
    statusError: null,
    pending: createPendingSlice(),
    hotspots: createHotspotSlice(),
    dialog: null,
    copied: false,
    menuOpen: false,
    diagnosticsOpen: false,
    addRepository: createAddRepositoryState(),
  }
}

/** Empty handler set, used by presentational tests. */
export function createNoopHandlers(): PanelHandlers {
  const noop = (): void => {}
  return {
    onRefreshRepositories: noop,
    onSelectRepository: noop,
    onSetSource: noop,
    onTextChange: noop,
    onToggleEventType: noop,
    onShowAllEventTypes: noop,
    onAuthorChange: noop,
    onToggleAuthor: noop,
    onClearFilters: noop,
    onLoadMoreTimeline: noop,
    onRetryTimeline: noop,
    onSelectFile: noop,
    onTreeQueryChange: noop,
    onSetFileStatus: noop,
    onToggleDir: noop,
    onExpandAllDirs: noop,
    onCollapseAllDirs: noop,
    onSetTimePreset: noop,
    onOpenEvent: noop,
    onBackFromDetail: noop,
    onOpenFile: noop,
    onBackFromDiff: noop,
    onCopyDiff: noop,
    onLoadMoreAudit: noop,
    onRetryAudit: noop,
    onRefreshPullRequests: noop,
    onSelectPullRequest: noop,
    onClosePullRequest: noop,
    onOpenFileRevision: noop,
    onToggleAddRepository: noop,
    onAddRepositoryPathChange: noop,
    onAddRepositorySubmit: noop,
    onSetAuditState: noop,
    onOpenOperation: noop,
    onBackFromAuditDetail: noop,
    onStartOperation: noop,
    onDialogClose: noop,
    onDialogMessageChange: noop,
    onDialogRemoteChange: noop,
    onDialogBranchChange: noop,
    onDialogConfirm: noop,
    onDialogRepreview: noop,
    onRetryStatus: noop,
    onToggleWriteMenu: noop,
    onCloseWriteMenu: noop,
    onToggleDiagnostics: noop,
    onSelectPendingFile: noop,
    onBackFromPendingDiff: noop,
    onSetChecksScope: noop,
    onRefreshChecks: noop,
    onRefreshSessionChanges: noop,
    onRefreshHotspots: noop,
    onSetHotspotSort: noop,
    onOpenHotspotFile: noop,
    onSelectBranch: noop,
    onClearBranchFilter: noop,
    onSetBranchScope: noop,
    onToggleAuditInTimeline: noop,
    onToggleDialogAck: noop,
  }
}
