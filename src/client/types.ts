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
  ChangeSet,
  Diagnostics,
  DiffResult,
  FileChangeStatus,
  OperationAttempt,
  OperationPreview,
  OperationType,
  Repository,
  VcsEvent,
  VcsEventType,
  WorkingTreeStatus,
} from '../shared/contracts.ts'
import type { VcsClient } from './api.ts'
import type { TranslateFn } from './i18n.ts'

/** Which source the panel body currently lists. */
export type PanelSource = 'timeline' | 'audit'

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
  /** History window preset, applied by the Host when the page is fetched. */
  timePreset: TimePreset
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
  status: WorkingTreeStatus | null
  statusLoading: boolean
  statusError: ApiError | null
  dialog: DialogState | null
  copied: boolean
  /** The header overflow menu (write operations) is open. */
  menuOpen: boolean
  /** The collapsible diagnostics block above the status bar is open. */
  diagnosticsOpen: boolean
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

/** Props the sidebar slot (or the fullscreen overlay) passes to the panel. */
export interface PanelProps {
  sessionId?: string
  workspacePath?: string | null
  /** `overlay` adds the frame-wide close/fullscreen controls to the toolbar. */
  mode?: 'sidebar' | 'overlay'
  /** Close the fullscreen overlay (overlay mode only). */
  onClose?: () => void
  /** Toggle browser fullscreen for the overlay (overlay mode only). */
  onToggleFullscreen?: () => void
  /** Whether the overlay is currently in browser fullscreen. */
  fullscreen?: boolean
  /**
   * Emit the component stylesheet inside this panel's tree.
   *
   * The fullscreen overlay is hosted by the composer dock, which already emits
   * one copy of the stylesheet for its own row; passing `false` there keeps a
   * single copy in the document.
   */
  inlineStyles?: boolean
}

/** Presentational props of one full panel render. */
export interface PanelViewProps {
  state: PanelState
  deps: PanelDeps
  handlers: PanelHandlers
  /** Layout variant; `overlay` fills a fullscreen frame. */
  mode?: 'sidebar' | 'overlay'
  fullscreen?: boolean
  onClose?: () => void
  onToggleFullscreen?: () => void
  /** Emit the `<style>` block; the dock host passes `false` when it already did. */
  withStyles?: boolean
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
      timePreset: 'all',
    },
    selectedFilePath: null,
    expandedDirs: {},
    refreshTick: 0,
    statusTick: 0,
    timeline: createTimelineSlice(),
    changeSet: createChangeSetSlice(),
    diff: createDiffSlice(),
    audit: createAuditSlice(),
    status: null,
    statusLoading: false,
    statusError: null,
    dialog: null,
    copied: false,
    menuOpen: false,
    diagnosticsOpen: false,
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
  }
}
