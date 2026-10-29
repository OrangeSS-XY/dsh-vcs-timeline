/**
 * dsh-vcs-timeline — stateful timeline panel.
 *
 * `createTimelinePanel(deps)` returns the component the sidebar slot mounts.
 * The component owns one immutable {@link PanelState}, performs Host calls
 * through the injected {@link VcsClient}, and delegates every pixel to the
 * pure views in `components.ts`. Writes follow preview → confirm → execute
 * with a single-use token, never auto-retry, and refresh the timeline plus
 * working-tree status after a terminal state.
 * @module dsh-vcs-timeline/client/panel
 */

import * as React from 'react'
import { DEFAULT_PAGE_SIZE } from '../shared/contracts.ts'
import type {
  ApiError,
  ChecksReport,
  DiffQuery,
  DiffResult,
  OperationAttempt,
  OperationPage,
  OperationPreview,
  OperationRequest,
  OperationType,
  Repository,
  TimelinePage,
  TimelineQuery,
  VcsEvent,
} from '../shared/contracts.ts'
import { renderPanelView } from './components.ts'
import { timelineQueryKey } from './cache.ts'
import {
  aggregateChangedFiles,
  buildFileTree,
  buildTimelineView,
  directoryPaths,
  filterFileEntries,
} from './file-index.ts'
import { windowSince } from './format.ts'
import { computeGraph } from './graph.ts'
import type { ApiResult, VcsClient } from './api.ts'
import {
  createAuditSlice,
  createChangeSetSlice,
  createDiffSlice,
  createHotspotSlice,
  createInitialState,
  createPendingSlice,
  createPullRequestSlice,
  createTimelineSlice,
} from './types.ts'
import type {
  ChecksScope,
  DialogState,
  HotspotDimension,
  HydrationSnapshot,
  PanelDeps,
  PanelHandlers,
  PanelProps,
  PanelSource,
  PanelState,
  PullRequestFilter,
} from './types.ts'

/** Interval of the cheap working-tree probe while the panel is visible. */
export const STATUS_POLL_INTERVAL_MS = 10_000

/** Interval of the quiet full revalidation of the visible source. */
export const AUTO_REFRESH_INTERVAL_MS = 30_000

/** Minimum gap between two focus-triggered revalidations. */
const FOCUS_REFRESH_THROTTLE_MS = 5_000

/** The timeline query the panel issues for an unfiltered first page. */
export function defaultTimelineQuery(repositoryId: string): TimelineQuery {
  return { repositoryId, limit: DEFAULT_PAGE_SIZE, includeFiles: true }
}

/** Resolve the workspace root for one panel occurrence, defensively. */
export function resolveWorkspacePathFor(deps: PanelDeps, props: PanelProps): string | null {
  try {
    const injected = deps.resolveWorkspacePath?.(props)
    if (typeof injected === 'string' && injected !== '') return injected
  } catch {
    // fall through to the prop
  }
  return typeof props.workspacePath === 'string' && props.workspacePath !== '' ? props.workspacePath : null
}

/** Convert one cached timeline page into a panel slice. */
function timelineSliceFromPage(page: TimelinePage): PanelState['timeline'] {
  return {
    events: page.events,
    cursor: page.nextCursor,
    hasMore: page.hasMore,
    partial: page.partial === true,
    warnings: page.warnings ?? [],
    loading: false,
    loadingMore: false,
    error: null,
  }
}

/**
 * Merge a refreshed first page into the already-loaded history.
 *
 * A quiet refresh must not throw away pages the user scrolled to ("加载更多"),
 * and it must not drop the cursor of those older pages. New commits are
 * prepended, events the Host no longer reports are removed only when the page
 * covers their window, and everything else keeps its order.
 */
export function mergeTimelineRefresh(
  previous: PanelState['timeline'],
  page: TimelinePage,
): PanelState['timeline'] {
  const pageIds = new Set(page.events.map((event) => event.id))
  const older = previous.events.filter((event) => !pageIds.has(event.id))
  return {
    events: [...page.events, ...older],
    cursor: previous.cursor ?? page.nextCursor,
    hasMore: previous.hasMore || page.hasMore,
    partial: previous.partial || page.partial === true,
    warnings: [...new Set([...previous.warnings, ...(page.warnings ?? [])])],
    loading: false,
    loadingMore: false,
    error: null,
  }
}

/** Merge a refreshed first audit page into the already-loaded records. */
export function mergeAuditRefresh(
  previous: PanelState['audit'],
  page: OperationPage,
): PanelState['audit'] {
  const pageIds = new Set(page.operations.map((attempt) => attempt.id))
  const older = previous.operations.filter((attempt) => !pageIds.has(attempt.id))
  return {
    ...previous,
    operations: [...page.operations, ...older],
    cursor: previous.cursor ?? page.nextCursor,
    hasMore: previous.hasMore || page.hasMore,
    warnings: [...new Set([...previous.warnings, ...(page.warnings ?? [])])],
    loading: false,
    loadingMore: false,
    error: null,
  }
}

/**
 * Build the first panel state from the in-memory warm cache.
 *
 * This is what makes opening the panel seamless: when a snapshot exists the
 * panel paints the last known history immediately and only revalidates in the
 * background. Without a snapshot it returns the original empty/loading state,
 * so the skeleton still appears on the genuine cold start.
 */
export function hydratePanelState(snapshot: HydrationSnapshot | null): PanelState {
  const base = createInitialState()
  if (snapshot === null || snapshot.repositories === null) return base
  const repositories = snapshot.repositories
  const selected = snapshot.selectedRepositoryId !== null
    && repositories.some((repository) => repository.id === snapshot.selectedRepositoryId)
    ? snapshot.selectedRepositoryId
    : (repositories[0]?.id ?? null)
  const hydrated: PanelState = {
    ...base,
    boot: 'ready',
    bootError: null,
    repositories,
    diagnostics: snapshot.diagnostics,
    selectedRepositoryId: selected,
    workspacePath: snapshot.workspacePath,
    noWorkspace: snapshot.workspacePath === null,
    // A warm repository list without a cached first page still has to load:
    // marking it loading here paints the skeleton on the very first frame
    // instead of flashing the "empty history" state for one render.
    timeline: { ...base.timeline, loading: selected !== null },
    sync: {
      refreshing: false,
      reason: null,
      lastSyncedAt: snapshot.savedAt ?? null,
      lastError: null,
    },
  }
  const data = snapshot.selectedRepositoryId === selected ? snapshot.data : null
  if (selected === null || data === null) return hydrated
  const key = timelineQueryKey(defaultTimelineQuery(selected))
  const timeline = data.timeline !== null && data.timeline.queryKey === key
    ? timelineSliceFromPage(data.timeline.page)
    : { ...base.timeline, loading: selected !== null }
  return {
    ...hydrated,
    timeline,
    status: data.status,
    audit: data.audit === null
      ? base.audit
      : {
        ...base.audit,
        operations: data.audit.operations,
        cursor: data.audit.nextCursor,
        hasMore: data.audit.hasMore,
        warnings: data.audit.warnings ?? [],
      },
    hotspots: data.hotspots === null ? base.hotspots : { ...base.hotspots, data: data.hotspots },
    pending: {
      ...base.pending,
      session: data.session,
      checks: data.checks?.value ?? null,
      checksScope: data.checks?.scope ?? 'worktree',
    },
    pullRequests: {
      ...base.pullRequests,
      data: data.pullRequests,
      compare: data.compare,
    },
  }
}

/**
 * Fingerprint of a working-tree snapshot.
 *
 * The status probe runs every few seconds; only a changed fingerprint (new
 * HEAD, branch switch, dirty-file set change) triggers the heavier history
 * reload. This is the "hot" half of the dynamic loading.
 */
function statusFingerprint(status: PanelState['status']): string {
  if (status === null) return ''
  const entries = status.entries
    .map((entry) => `${entry.status}${entry.worktreeStatus ?? ''}:${entry.path}`)
    .sort()
    .join('\u0000')
  return `${status.branch ?? ''}\u0001${status.head ?? ''}\u0001${status.clean ? '1' : '0'}\u0001${entries}`
}

/** Find one repository in the current state. */
function findRepository(state: PanelState, repositoryId: string | null): Repository | null {
  if (repositoryId === null) return null
  return state.repositories.find((entry) => entry.id === repositoryId) ?? null
}

/** Whether a checks report carries at least one blocking finding. */
function hasBlockingChecks(report: ChecksReport | null): boolean {
  return report !== null && report.findings.some((finding) => finding.severity === 'blocking')
}

/**
 * The user-editable inputs of one write-operation dialog. Kept separate from
 * `DialogState` so the Host requests can be built — and tested — without React.
 */
export interface OperationDraft {
  operation: OperationType
  /** Commit message typed by the user; never prefilled. */
  message: string
  /** Push remote typed by the user. */
  remote: string
  /** Push branch typed by the user. */
  branch: string
}

/**
 * Build the draft for one dialog open/re-preview.
 *
 * Re-previewing the SAME operation preserves every typed input (a blocked
 * commit preview must be correctable); opening a different operation starts
 * from clean defaults, with the current branch as the push target.
 */
export function createOperationDraft(
  operation: OperationType,
  repository: Repository | null,
  previous?: Pick<OperationDraft, 'operation' | 'message' | 'remote' | 'branch'> | null,
): OperationDraft {
  if (previous !== undefined && previous !== null && previous.operation === operation) {
    return {
      operation,
      message: previous.message,
      remote: previous.remote,
      branch: previous.branch,
    }
  }
  return {
    operation,
    message: '',
    remote: 'origin',
    branch: repository?.currentBranch ?? repository?.defaultBranch ?? '',
  }
}

/**
 * The exact params that identify a preview request to the Host.
 *
 * The Host binds its single-use confirmation token to a hash of these params
 * and rejects an execute call whose params differ, so preview and execute MUST
 * both build them through this one function.
 */
export function operationParams(draft: OperationDraft): Record<string, string> | undefined {
  if (draft.operation === 'commit') return { message: draft.message }
  if (draft.operation === 'push') {
    return { remote: draft.remote.trim(), branch: draft.branch.trim() }
  }
  return undefined
}

/** The exact preview body sent to `vcs/op/preview`. */
export function buildPreviewRequest(repositoryId: string, draft: OperationDraft): OperationRequest {
  const params = operationParams(draft)
  return params === undefined
    ? { repositoryId, operation: draft.operation }
    : { repositoryId, operation: draft.operation, params }
}

/** The exact execute body sent to `vcs/op/execute`, reusing the preview params. */
export function buildExecuteRequest(
  repositoryId: string,
  draft: OperationDraft,
  confirmationToken: string,
): OperationRequest {
  const params = operationParams(draft)
  return params === undefined
    ? { repositoryId, operation: draft.operation, confirmationToken }
    : { repositoryId, operation: draft.operation, params, confirmationToken }
}

/** Ask the Host to preview one write operation, with its current params. */
export async function requestPreview(
  api: VcsClient,
  repositoryId: string,
  draft: OperationDraft,
): Promise<ApiResult<OperationPreview>> {
  return api.previewOperation(buildPreviewRequest(repositoryId, draft))
}

/** Execute a previewed write operation with the token bound to those params. */
export async function requestExecute(
  api: VcsClient,
  repositoryId: string,
  draft: OperationDraft,
  confirmationToken: string,
): Promise<ApiResult<OperationAttempt>> {
  return api.executeOperation(buildExecuteRequest(repositoryId, draft, confirmationToken))
}

/** Create the panel component bound to the real Host client and translator. */
export function createTimelinePanel(deps: PanelDeps): React.ComponentType<PanelProps> {
  return function TimelinePanel(props: PanelProps): React.ReactElement {
    const [state, setState] = React.useState<PanelState>(() => hydratePanelState(
      deps.sync?.hydrate(resolveWorkspacePathFor(deps, props)) ?? null,
    ))
    const stateRef = React.useRef<PanelState>(state)
    stateRef.current = state
    const aliveRef = React.useRef<boolean>(true)
    const rootRef = React.useRef<HTMLDivElement | null>(null)
    const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const repreviewTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastFocusRefreshRef = React.useRef<number>(0)
    /** In-flight quiet revalidations; the chrome shows a progress bar while > 0. */
    const refreshCountRef = React.useRef<number>(0)
    /** Query key of the loaded timeline page, to preserve loaded history on refresh. */
    const lastTimelineKeyRef = React.useRef<string | null>(
      state.timeline.events.length > 0 && state.selectedRepositoryId !== null
        ? timelineQueryKey(defaultTimelineQuery(state.selectedRepositoryId))
        : null,
    )
    const timelineTokenRef = React.useRef<number>(0)
    const auditTokenRef = React.useRef<number>(0)
    const prListTokenRef = React.useRef<number>(0)
    const prDetailTokenRef = React.useRef<number>(0)
    const compareTokenRef = React.useRef<number>(0)
    const statusTokenRef = React.useRef<number>(0)
    const pendingDiffTokenRef = React.useRef<number>(0)
    const checksTokenRef = React.useRef<number>(0)
    const sessionTokenRef = React.useRef<number>(0)
    const hotspotTokenRef = React.useRef<number>(0)
    const detailTokenRef = React.useRef<number>(0)
    const diffTokenRef = React.useRef<number>(0)
    const dialogTokenRef = React.useRef<number>(0)
    /** Diff responses already fetched, keyed by repo|revision|path. */
    const diffCacheRef = React.useRef<Map<string, DiffResult>>(new Map())
    /** Pending hover-prefetch timers, so a fast pointer sweep does no work. */
    const prefetchTimersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    const prefetchingRef = React.useRef<Set<string>>(new Set())

    /**
     * Memoized derived views.
     *
     * The timeline view aggregates every changed file of the loaded page and
     * the graph sweeps all commits. Recomputing both on every keystroke, dialog
     * edit or directory expand made the panel feel laggy; these arrays only
     * change when the history page or the file filters actually change.
     */
    const timelineView = React.useMemo(() => buildTimelineView(state.timeline.events, {
      query: state.filters.treeQuery,
      status: state.filters.fileStatus,
      selectedPath: state.selectedFilePath,
    }), [state.timeline.events, state.filters.treeQuery, state.filters.fileStatus, state.selectedFilePath])
    const graphModel = React.useMemo(() => computeGraph(state.timeline.events), [state.timeline.events])

    React.useEffect(() => () => {
      aliveRef.current = false
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current)
      if (repreviewTimerRef.current !== null) clearTimeout(repreviewTimerRef.current)
      for (const timer of prefetchTimersRef.current.values()) clearTimeout(timer)
      prefetchTimersRef.current.clear()
    }, [])

    /** Derive the workspace root for this slot occurrence, defensively. */
    const resolveWorkspace = (): string | null => resolveWorkspacePathFor(deps, props)

    /**
     * Mark one quiet revalidation as running.
     *
     * The counter, not a boolean, is authoritative: several slices revalidate
     * in parallel, and the chrome must stay in the "updating" state until the
     * last one settles.
     */
    const beginRefresh = (reason: NonNullable<PanelState['sync']['reason']>): void => {
      refreshCountRef.current += 1
      setState((prev) => prev.sync.refreshing
        ? prev
        : { ...prev, sync: { ...prev.sync, refreshing: true, reason } })
    }

    /** Mark one revalidation as finished, keeping the last good timestamp. */
    const endRefresh = (error: ApiError | null, succeeded = true): void => {
      refreshCountRef.current = Math.max(0, refreshCountRef.current - 1)
      if (refreshCountRef.current > 0) return
      if (!aliveRef.current) return
      const at = deps.now?.() ?? Date.now()
      setState((prev) => ({
        ...prev,
        sync: {
          refreshing: false,
          reason: null,
          lastSyncedAt: succeeded ? at : prev.sync.lastSyncedAt,
          lastError: error,
        },
      }))
    }

    /**
     * Release one refresh slot whose request was superseded.
     *
     * A newer request owns the visible result, so this only decrements the
     * counter and turns the bar off when it was the last waiter; without it a
     * cancelled request would leave the progress bar spinning forever.
     */
    const cancelRefresh = (): void => {
      refreshCountRef.current = Math.max(0, refreshCountRef.current - 1)
      if (refreshCountRef.current > 0 || !aliveRef.current) return
      setState((prev) => prev.sync.refreshing
        ? { ...prev, sync: { ...prev.sync, refreshing: false, reason: null } }
        : prev)
    }

    /** Load diagnostics plus the repository list (quiet when data exists). */
    const reloadRepositories = async (): Promise<void> => {
      const workspacePath = resolveWorkspace()
      const hadData = stateRef.current.repositories.length > 0
      beginRefresh(hadData ? 'background' : 'boot')
      setState((prev) => ({
        ...prev,
        boot: prev.repositories.length === 0 ? 'loading' : 'ready',
        bootError: null,
        workspacePath,
        noWorkspace: workspacePath === null,
      }))
      const result = await deps.api.listRepositories(workspacePath)
      if (!aliveRef.current) return
      if (!result.ok) {
        endRefresh(result.error)
        setState((prev) => ({
          ...prev,
          boot: prev.repositories.length === 0 ? 'error' : 'ready',
          bootError: result.error,
        }))
        return
      }
      endRefresh(null)
      const repositories = result.value.repositories
      const previous = stateRef.current
      const stillPresent = previous.selectedRepositoryId !== null
        && repositories.some((repository) => repository.id === previous.selectedRepositoryId)
      const selected = stillPresent ? previous.selectedRepositoryId : (repositories[0]?.id ?? null)
      deps.sync?.rememberRepositories(workspacePath, repositories, result.value.diagnostics, selected)
      setState((prev) => {
        const currentStillPresent = prev.selectedRepositoryId !== null
          && repositories.some((repository) => repository.id === prev.selectedRepositoryId)
        const nextSelected = currentStillPresent ? prev.selectedRepositoryId : (repositories[0]?.id ?? null)
        const changed = nextSelected !== prev.selectedRepositoryId
        return {
          ...prev,
          boot: 'ready',
          bootError: null,
          repositories,
          diagnostics: result.value.diagnostics,
          selectedRepositoryId: nextSelected,
          workspacePath,
          noWorkspace: workspacePath === null,
        ...(changed
          ? {
            timeline: { ...createTimelineSlice(), loading: nextSelected !== null },
            changeSet: createChangeSetSlice(),
            diff: createDiffSlice(),
            audit: createAuditSlice(),
            status: null,
            statusError: null,
            statusLoading: nextSelected !== null,
            pending: createPendingSlice(),
            hotspots: createHotspotSlice(),
            pullRequests: createPullRequestSlice(),
          }
          : {}),
        }
      })
    }

    /**
     * Load one timeline page.
     *
     * `cursor === null` asks for the first page. When history is already on
     * screen (hydrated from the warm cache or from an earlier load) the request
     * is a quiet refresh: the list stays visible, new commits are merged on
     * top, and already-loaded older pages are preserved, so scroll position and
     * an open detail never jump.
     */
    const loadTimeline = async (repositoryId: string, cursor: string | null): Promise<void> => {
      const token = ++timelineTokenRef.current
      const filters = stateRef.current.filters
      const query: TimelineQuery = { repositoryId, limit: DEFAULT_PAGE_SIZE, includeFiles: true }
      const text = filters.debouncedText.trim()
      if (text !== '') query.text = text
      if (filters.eventTypes.length > 0) query.eventTypes = [...filters.eventTypes]
      const author = filters.author.trim()
      if (author !== '') query.author = author
      const branch = filters.branch.trim()
      if (branch !== '') query.branch = branch
      else if (filters.branchScope === 'all') query.branchScope = 'all'
      const since = windowSince(filters.timePreset, deps.now?.() ?? Date.now())
      if (since !== undefined) query.since = since
      if (cursor !== null) query.cursor = cursor
      const queryKey = timelineQueryKey(query)
      const isFirstPage = cursor === null
      const quiet = isFirstPage && stateRef.current.timeline.events.length > 0
      if (cursor === null) {
        if (quiet) {
          beginRefresh('background')
        } else {
          beginRefresh('boot')
          setState((prev) => ({
            ...prev,
            timeline: {
              events: [],
              cursor: null,
              hasMore: false,
              partial: false,
              warnings: [],
              loading: true,
              loadingMore: false,
              error: null,
            },
          }))
        }
      } else {
        setState((prev) => ({ ...prev, timeline: { ...prev.timeline, loadingMore: true, error: null } }))
      }
      const result = await deps.api.timeline(query)
      if (!aliveRef.current) return
      if (token !== timelineTokenRef.current) {
        if (isFirstPage) cancelRefresh()
        return
      }
      if (stateRef.current.selectedRepositoryId !== repositoryId) {
        if (isFirstPage) cancelRefresh()
        return
      }
      if (!result.ok) {
        if (isFirstPage) {
          if (quiet) endRefresh(result.error)
          else endRefresh(null, false)
        }
        setState((prev) => quiet
          ? { ...prev, timeline: { ...prev.timeline, loadingMore: false } }
          : {
            ...prev,
            timeline: { ...prev.timeline, loading: false, loadingMore: false, error: result.error },
          })
        return
      }
      const page = result.value
      if (isFirstPage) endRefresh(null)
      const preserveLoadedHistory = cursor === null
        && quiet
        && lastTimelineKeyRef.current === queryKey
      lastTimelineKeyRef.current = queryKey
      deps.sync?.rememberTimeline(repositoryId, queryKey, page)
      setState((prev) => {
        if (cursor !== null) {
          const known = new Set(prev.timeline.events.map((event) => event.id))
          const fresh = page.events.filter((event) => !known.has(event.id))
          return {
            ...prev,
            timeline: {
              ...prev.timeline,
              events: [...prev.timeline.events, ...fresh],
              cursor: page.nextCursor,
              hasMore: page.hasMore,
              partial: prev.timeline.partial || page.partial === true,
              warnings: [...prev.timeline.warnings, ...(page.warnings ?? [])],
              loading: false,
              loadingMore: false,
              error: null,
            },
          }
        }
        if (preserveLoadedHistory && prev.timeline.events.length > 0) {
          return { ...prev, timeline: mergeTimelineRefresh(prev.timeline, page) }
        }
        return {
          ...prev,
          timeline: {
            events: page.events,
            cursor: page.nextCursor,
            hasMore: page.hasMore,
            partial: page.partial === true,
            warnings: page.warnings ?? [],
            loading: false,
            loadingMore: false,
            error: null,
          },
        }
      })
    }

    /**
     * Load one audit page.
     *
     * Like the timeline, the first page is a quiet refresh when audit records
     * are already on screen: the list stays, new records are merged on top, and
     * the selected record is kept.
     */
    const loadAudit = async (repositoryId: string, cursor: string | null): Promise<void> => {
      const token = ++auditTokenRef.current
      const quiet = cursor === null && stateRef.current.audit.operations.length > 0
      if (cursor === null) {
        if (quiet) {
          beginRefresh('background')
        } else {
          beginRefresh('boot')
          setState((prev) => ({
            ...prev,
            audit: {
              ...prev.audit,
              operations: [],
              cursor: null,
              hasMore: false,
              warnings: [],
              loading: true,
              loadingMore: false,
              error: null,
              selected: null,
            },
          }))
        }
      } else {
        setState((prev) => ({ ...prev, audit: { ...prev.audit, loadingMore: true, error: null } }))
      }
      const result = await deps.api.listOperations(cursor === null ? { repositoryId } : { repositoryId, cursor })
      if (!aliveRef.current) return
      const isFirstPage = cursor === null
      if (token !== auditTokenRef.current) {
        if (isFirstPage) cancelRefresh()
        return
      }
      if (stateRef.current.selectedRepositoryId !== repositoryId) {
        if (isFirstPage) cancelRefresh()
        return
      }
      if (!result.ok) {
        if (isFirstPage) {
          if (quiet) endRefresh(result.error)
          else endRefresh(null, false)
        }
        setState((prev) => quiet
          ? prev
          : { ...prev, audit: { ...prev.audit, loading: false, loadingMore: false, error: result.error } })
        return
      }
      const page = result.value
      if (cursor === null) endRefresh(null)
      deps.sync?.rememberAudit(repositoryId, page)
      setState((prev) => {
        const known = new Set(prev.audit.operations.map((attempt) => attempt.id))
        const fresh = page.operations.filter((attempt) => !known.has(attempt.id))
        if (cursor === null && quiet && prev.audit.operations.length > 0) {
          return { ...prev, audit: mergeAuditRefresh(prev.audit, page) }
        }
        return {
          ...prev,
          audit: cursor === null
            ? {
              operations: page.operations,
              cursor: page.nextCursor,
              hasMore: page.hasMore,
              warnings: page.warnings ?? [],
              loading: false,
              loadingMore: false,
              error: null,
              selected: prev.audit.selected,
            }
            : {
              ...prev.audit,
              operations: [...prev.audit.operations, ...fresh],
              cursor: page.nextCursor,
              hasMore: page.hasMore,
              warnings: [...prev.audit.warnings, ...(page.warnings ?? [])],
              loading: false,
              loadingMore: false,
              error: null,
            },
        }
      })
    }

    /** Load the working-tree snapshot (quiet while a previous one is shown). */
    const loadStatus = async (repositoryId: string): Promise<void> => {
      const token = ++statusTokenRef.current
      const quiet = stateRef.current.status !== null
      if (quiet) {
        beginRefresh('background')
      } else {
        setState((prev) => ({ ...prev, statusLoading: true, statusError: null }))
      }
      const result = await deps.api.status(repositoryId)
      if (!aliveRef.current) return
      if (token !== statusTokenRef.current) {
        cancelRefresh()
        return
      }
      if (stateRef.current.selectedRepositoryId !== repositoryId) {
        cancelRefresh()
        return
      }
      if (!result.ok) {
        if (quiet) {
          endRefresh(result.error)
          return
        }
        endRefresh(null, false)
        setState((prev) => ({ ...prev, statusLoading: false, statusError: result.error, status: null }))
        return
      }
      endRefresh(null)
      deps.sync?.rememberStatus(repositoryId, result.value)
      setState((prev) => ({ ...prev, statusLoading: false, statusError: null, status: result.value }))
    }

    /** Load one dirty file's working-tree diff (`staged` selects the index side). */
    const loadPendingDiff = async (repositoryId: string, filePath: string, staged: boolean): Promise<void> => {
      const token = ++pendingDiffTokenRef.current
      setState((prev) => ({
        ...prev,
        pending: { ...prev.pending, path: filePath, staged, diff: null, diffLoading: true, diffError: null },
      }))
      const result = await deps.api.worktreeDiff({
        repositoryId,
        filePath,
        ...(staged ? { staged: true } : {}),
      })
      if (!aliveRef.current || token !== pendingDiffTokenRef.current) return
      if (stateRef.current.selectedRepositoryId !== repositoryId) return
      if (!result.ok) {
        setState((prev) => ({
          ...prev,
          pending: { ...prev.pending, diffLoading: false, diffError: result.error },
        }))
        return
      }
      setState((prev) => ({
        ...prev,
        pending: { ...prev.pending, diffLoading: false, diffError: null, diff: result.value },
      }))
    }

    /** Load the pre-commit checks report for one side (quiet when cached). */
    const loadChecks = async (repositoryId: string, scope: ChecksScope, refresh: boolean): Promise<void> => {
      const token = ++checksTokenRef.current
      const current = stateRef.current.pending
      const quiet = current.checks !== null && current.checksScope === scope
      if (!quiet) {
        setState((prev) => ({
          ...prev,
          pending: { ...prev.pending, checksScope: scope, checksLoading: true, checksError: null },
        }))
      } else {
        beginRefresh('background')
      }
      if (refresh) {
        // The Host has no cache for checks, but a refresh must still supersede
        // an older in-flight request (the token already does that).
      }
      const result = await deps.api.checks({
        repositoryId,
        ...(scope === 'staged' ? { staged: true } : {}),
      })
      if (!aliveRef.current) return
      if (token !== checksTokenRef.current) {
        if (quiet) cancelRefresh()
        return
      }
      if (stateRef.current.selectedRepositoryId !== repositoryId) {
        if (quiet) cancelRefresh()
        return
      }
      if (!result.ok) {
        if (quiet) {
          endRefresh(result.error)
          return
        }
        setState((prev) => ({
          ...prev,
          pending: { ...prev.pending, checksLoading: false, checksError: result.error },
        }))
        return
      }
      if (quiet) endRefresh(null)
      deps.sync?.rememberChecks(repositoryId, scope, result.value)
      setState((prev) => ({
        ...prev,
        pending: { ...prev.pending, checksLoading: false, checksError: null, checks: result.value },
      }))
    }

    /** Load the current session's touched files (quiet when already known). */
    const loadSessionChanges = async (repositoryId: string): Promise<void> => {
      const token = ++sessionTokenRef.current
      const quiet = stateRef.current.pending.session !== null
      if (!quiet) {
        setState((prev) => ({
          ...prev,
          pending: { ...prev.pending, sessionLoading: true, sessionError: null },
        }))
      } else {
        beginRefresh('background')
      }
      const sessionId = typeof props.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : undefined
      const result = await deps.api.sessionChanges({
        repositoryId,
        ...(sessionId === undefined ? {} : { sessionId }),
      })
      if (!aliveRef.current) return
      if (token !== sessionTokenRef.current) {
        if (quiet) cancelRefresh()
        return
      }
      if (stateRef.current.selectedRepositoryId !== repositoryId) {
        if (quiet) cancelRefresh()
        return
      }
      if (!result.ok) {
        if (quiet) {
          endRefresh(result.error)
          return
        }
        setState((prev) => ({
          ...prev,
          pending: { ...prev.pending, sessionLoading: false, sessionError: result.error },
        }))
        return
      }
      if (quiet) endRefresh(null)
      deps.sync?.rememberSession(repositoryId, result.value)
      setState((prev) => ({
        ...prev,
        pending: { ...prev.pending, sessionLoading: false, sessionError: null, session: result.value },
      }))
    }

    /** Load the file-hotspot ranking (quiet when a report is already shown). */
    const loadHotspots = async (repositoryId: string): Promise<void> => {
      const token = ++hotspotTokenRef.current
      const quiet = stateRef.current.hotspots.data !== null
      if (!quiet) {
        setState((prev) => ({
          ...prev,
          hotspots: { ...prev.hotspots, loading: true, error: null },
        }))
      } else {
        beginRefresh('background')
      }
      const result = await deps.api.statsHotspots({ repositoryId })
      if (!aliveRef.current) return
      if (token !== hotspotTokenRef.current) {
        if (quiet) cancelRefresh()
        return
      }
      if (stateRef.current.selectedRepositoryId !== repositoryId) {
        if (quiet) cancelRefresh()
        return
      }
      if (!result.ok) {
        if (quiet) {
          endRefresh(result.error)
          return
        }
        setState((prev) => ({ ...prev, hotspots: { ...prev.hotspots, loading: false, error: result.error } }))
        return
      }
      if (quiet) endRefresh(null)
      deps.sync?.rememberHotspots(repositoryId, result.value)
      setState((prev) => ({
        ...prev,
        hotspots: { ...prev.hotspots, loading: false, error: null, data: result.value },
      }))
    }

    /** Load the staged checks shown inside the commit dialog. */
    const loadDialogChecks = async (repositoryId: string): Promise<void> => {
      const token = ++checksTokenRef.current
      setState((prev) => prev.dialog === null
        ? prev
        : { ...prev, dialog: { ...prev.dialog, checks: null, checksLoading: true } })
      const result = await deps.api.checks({ repositoryId, staged: true })
      if (!aliveRef.current || token !== checksTokenRef.current) return
      setState((prev) => {
        if (prev.dialog === null) return prev
        if (!result.ok) return { ...prev, dialog: { ...prev.dialog, checksLoading: false, checks: null } }
        return { ...prev, dialog: { ...prev.dialog, checksLoading: false, checks: result.value } }
      })
    }

    /** Open one event detail and load its changed-file list. */
    const openEvent = async (event: VcsEvent): Promise<void> => {
      const repositoryId = stateRef.current.selectedRepositoryId
      if (repositoryId === null) return
      const revision = event.revision ?? event.commitHash ?? ''
      const token = ++detailTokenRef.current
      setState((prev) => ({
        ...prev,
        diff: createDiffSlice(),
        changeSet: {
          event,
          revision,
          data: null,
          loading: revision !== '',
          error: revision === ''
            ? { code: 'invalid-request', message: 'missing-revision' }
            : null,
        },
      }))
      if (revision === '') return
      const result = await deps.api.changeSet(repositoryId, revision)
      if (!aliveRef.current || token !== detailTokenRef.current) return
      setState((prev) => {
        if (prev.changeSet.event !== event) return prev
        if (!result.ok) return { ...prev, changeSet: { ...prev.changeSet, loading: false, error: result.error } }
        return { ...prev, changeSet: { ...prev.changeSet, loading: false, error: null, data: result.value } }
      })
    }

    /**
     * Load the diff of one file at one revision.
     *
     * The revision defaults to the open commit's revision (the detail file
     * list); the file view passes the newest commit that touched the path.
     * Responses are cached by repo|revision|path so re-opening a file that was
     * already inspected (or hover-prefetched) is instant.
     */
    const openDiff = async (filePath: string, revisionOverride?: string): Promise<void> => {
      const snapshot = stateRef.current
      const repositoryId = snapshot.selectedRepositoryId
      if (repositoryId === null) return
      const revision = revisionOverride ?? snapshot.changeSet.revision
      const cacheKey = `${repositoryId}|${revision}|${filePath}`
      const cached = diffCacheRef.current.get(cacheKey)
      if (cached !== undefined) {
        diffTokenRef.current += 1
        setState((prev) => ({
          ...prev,
          diff: { filePath, data: cached, loading: false, error: null },
        }))
        return
      }
      const token = ++diffTokenRef.current
      setState((prev) => ({
        ...prev,
        diff: { filePath, data: null, loading: true, error: null },
      }))
      const query: DiffQuery = { repositoryId, filePath }
      if (revision !== '') query.revisionB = revision
      const result = await deps.api.diff(query)
      if (!aliveRef.current || token !== diffTokenRef.current) return
      if (!result.ok) {
        setState((prev) => ({ ...prev, diff: { ...prev.diff, loading: false, error: result.error } }))
        return
      }
      // Bounded cache: a session can touch many files, but revisiting the last
      // few dozen is the common case and memory must stay small.
      if (diffCacheRef.current.size >= 40) {
        const oldest = diffCacheRef.current.keys().next()
        if (oldest.done !== true) diffCacheRef.current.delete(oldest.value)
      }
      diffCacheRef.current.set(cacheKey, result.value)
      setState((prev) => ({ ...prev, diff: { ...prev.diff, loading: false, error: null, data: result.value } }))
    }

    /** Newest loaded revision that touched one path, or null when unknown. */
    const newestRevisionFor = (filePath: string): string | null => {
      const event = stateRef.current.timeline.events.find((entry) => Array.isArray(entry.changedFiles)
        && entry.changedFiles.some((file) => file.path === filePath))
      if (event === undefined) return null
      return event.commitHash ?? event.revision ?? ''
    }

    /**
     * Warm the diff cache for a hovered file (150 ms dwell, never blocking).
     *
     * The Host runs `git diff` per request, so this trades one unavoidable read
     * for an instant click; hovering across a list never starts a storm because
     * each row cancels its timer on mouse-leave and in-flight reads are deduped.
     */
    const prefetchDiff = (filePath: string): void => {
      const repositoryId = stateRef.current.selectedRepositoryId
      if (repositoryId === null) return
      const revision = newestRevisionFor(filePath)
      if (revision === null) return
      const cacheKey = `${repositoryId}|${revision}|${filePath}`
      if (diffCacheRef.current.has(cacheKey) || prefetchingRef.current.has(cacheKey)) return
      if (prefetchTimersRef.current.has(filePath)) return
      const timer = setTimeout(() => {
        prefetchTimersRef.current.delete(filePath)
        if (!aliveRef.current || prefetchingRef.current.has(cacheKey)) return
        if (stateRef.current.selectedRepositoryId !== repositoryId) return
        prefetchingRef.current.add(cacheKey)
        const query: DiffQuery = { repositoryId, filePath }
        if (revision !== '') query.revisionB = revision
        void deps.api.diff(query).then((result) => {
          prefetchingRef.current.delete(cacheKey)
          if (!aliveRef.current || !result.ok) return
          if (diffCacheRef.current.size >= 40) {
            const oldest = diffCacheRef.current.keys().next()
            if (oldest.done !== true) diffCacheRef.current.delete(oldest.value)
          }
          diffCacheRef.current.set(cacheKey, result.value)
          // If this file is now the selected one, paint the warmed diff.
          const current = stateRef.current
          if (current.selectedFilePath === filePath && current.diff.data === null && current.diff.filePath === filePath) {
            setState((prev) => prev.diff.filePath === filePath && prev.diff.data === null
              ? { ...prev, diff: { ...prev.diff, loading: false, data: result.value, error: null } }
              : prev)
          }
        }).catch(() => {
          prefetchingRef.current.delete(cacheKey)
        })
      }, 150)
      prefetchTimersRef.current.set(filePath, timer)
    }

    const cancelPrefetchDiff = (filePath: string): void => {
      const timer = prefetchTimersRef.current.get(filePath)
      if (timer === undefined) return
      clearTimeout(timer)
      prefetchTimersRef.current.delete(filePath)
    }

    /**
     * Open the newest diff of one repository file.
     *
     * Selecting a file in the tree must show "who changed it" plus its diff,
     * so the newest commit touching the path supplies the revision while the
     * right pane's list stays visible and the detail area shows the diff.
     */
    const openLatestFileDiff = (filePath: string): void => {
      const revision = newestRevisionFor(filePath)
      if (revision === null) {
        setState((prev) => ({ ...prev, diff: createDiffSlice() }))
        return
      }
      void openDiff(filePath, revision)
    }

    /** Load the pull-request list (quiet when a list is already shown). */
    const loadPullRequests = async (repositoryId: string, refresh: boolean): Promise<void> => {
      const token = ++prListTokenRef.current
      const quiet = stateRef.current.pullRequests.data !== null
      if (!quiet) {
        setState((prev) => ({ ...prev, pullRequests: { ...prev.pullRequests, loading: true, error: null } }))
      } else {
        beginRefresh('background')
      }
      const result = await deps.api.listPullRequests(refresh ? { repositoryId, refresh: true } : { repositoryId })
      if (!aliveRef.current) return
      if (token !== prListTokenRef.current) {
        if (quiet) cancelRefresh()
        return
      }
      if (stateRef.current.selectedRepositoryId !== repositoryId) {
        if (quiet) cancelRefresh()
        return
      }
      if (!result.ok) {
        if (quiet) {
          endRefresh(result.error)
          return
        }
        setState((prev) => ({ ...prev, pullRequests: { ...prev.pullRequests, loading: false, error: result.error } }))
        return
      }
      if (quiet) endRefresh(null)
      deps.sync?.rememberPullRequests(repositoryId, result.value)
      setState((prev) => ({
        ...prev,
        pullRequests: { ...prev.pullRequests, loading: false, error: null, data: result.value },
      }))
    }

    /** Load one pull request's detail (description, changed files). */
    const loadPullRequestDetail = async (repositoryId: string, number: number): Promise<void> => {
      const token = ++prDetailTokenRef.current
      setState((prev) => ({
        ...prev,
        pullRequests: {
          ...prev.pullRequests,
          selectedNumber: number,
          detail: null,
          detailLoading: true,
          detailError: null,
        },
      }))
      const result = await deps.api.pullRequestDetail({ repositoryId, number })
      if (!aliveRef.current || token !== prDetailTokenRef.current) return
      if (stateRef.current.selectedRepositoryId !== repositoryId) return
      if (!result.ok) {
        setState((prev) => ({ ...prev, pullRequests: { ...prev.pullRequests, detailLoading: false, detailError: result.error } }))
        return
      }
      setState((prev) => ({
        ...prev,
        pullRequests: { ...prev.pullRequests, detailLoading: false, detailError: null, detail: result.value },
      }))
    }

    /** Load the local branch insight (quiet when one is already shown). */
    const loadBranchCompare = async (repositoryId: string): Promise<void> => {
      const token = ++compareTokenRef.current
      const quiet = stateRef.current.pullRequests.compare !== null
      if (!quiet) {
        setState((prev) => ({ ...prev, pullRequests: { ...prev.pullRequests, compareLoading: true, compareError: null } }))
      } else {
        beginRefresh('background')
      }
      const result = await deps.api.branchCompare({ repositoryId })
      if (!aliveRef.current) return
      if (token !== compareTokenRef.current) {
        if (quiet) cancelRefresh()
        return
      }
      if (stateRef.current.selectedRepositoryId !== repositoryId) {
        if (quiet) cancelRefresh()
        return
      }
      if (!result.ok) {
        if (quiet) {
          endRefresh(result.error)
          return
        }
        setState((prev) => ({ ...prev, pullRequests: { ...prev.pullRequests, compareLoading: false, compareError: result.error } }))
        return
      }
      if (quiet) endRefresh(null)
      deps.sync?.rememberCompare(repositoryId, result.value)
      setState((prev) => ({
        ...prev,
        pullRequests: { ...prev.pullRequests, compareLoading: false, compareError: null, compare: result.value },
      }))
    }

    /**
     * Quietly revalidate whatever the panel currently shows.
     *
     * This is the single entry point for every "refresh in place" trigger:
     * opening the panel, the 30 s timer, returning to the tab, focusing the
     * window and a changed working tree. Every loader it calls sees existing
     * data and therefore refreshes without clearing the list.
     */
    const revalidateVisible = (): void => {
      const snapshot = stateRef.current
      const repositoryId = snapshot.selectedRepositoryId
      if (repositoryId === null) return
      void loadStatus(repositoryId)
      if (snapshot.source === 'timeline') {
        void loadTimeline(repositoryId, null)
        if (snapshot.filters.auditInTimeline) void loadAudit(repositoryId, null)
      } else if (snapshot.source === 'audit') {
        void loadAudit(repositoryId, null)
      } else if (snapshot.source === 'hotspots') {
        void loadHotspots(repositoryId)
      } else if (snapshot.source === 'pr') {
        void loadPullRequests(repositoryId, false)
        void loadBranchCompare(repositoryId)
      } else if (snapshot.source === 'pending') {
        void loadChecks(repositoryId, snapshot.pending.checksScope, false)
        void loadSessionChanges(repositoryId)
      }
    }

    /**
     * Cheap working-tree probe used while the panel is visible.
     *
     * `git status` is an order of magnitude cheaper than a history page, so the
     * panel can ask every ten seconds; a changed fingerprint is what triggers
     * the heavier, still-silent history reload. This keeps the view live
     * without polling the expensive endpoint.
     */
    const pollStatusOnce = async (repositoryId: string): Promise<void> => {
      const before = stateRef.current.status
      if (before === null) return
      const result = await deps.api.status(repositoryId)
      if (!aliveRef.current || stateRef.current.selectedRepositoryId !== repositoryId) return
      if (!result.ok) return
      deps.sync?.rememberStatus(repositoryId, result.value)
      const changed = statusFingerprint(before) !== statusFingerprint(result.value)
      if (!changed) return
      setState((prev) => prev.selectedRepositoryId === repositoryId
        ? { ...prev, status: result.value, statusError: null, statusLoading: false }
        : prev)
      revalidateVisible()
    }

    /** Validate the typed path and add it as a repository (outside workspaces). */
    const submitAddRepository = async (): Promise<void> => {
      const path = stateRef.current.addRepository.path.trim()
      if (path === '') return
      setState((prev) => ({ ...prev, addRepository: { ...prev.addRepository, loading: true, error: null } }))
      const result = await deps.api.addRepository(path)
      if (!aliveRef.current) return
      if (!result.ok) {
        setState((prev) => ({
          ...prev,
          addRepository: { ...prev.addRepository, loading: false, error: result.error },
        }))
        return
      }
      const added = result.value
      setState((prev) => ({
        ...prev,
        addRepository: { open: false, path: '', loading: false, error: null },
        selectedRepositoryId: added.id,
        selectedFilePath: null,
        expandedDirs: {},
        timeline: { ...createTimelineSlice(), loading: true },
        changeSet: createChangeSetSlice(),
        diff: createDiffSlice(),
        audit: createAuditSlice(),
        pullRequests: createPullRequestSlice(),
        pending: createPendingSlice(),
        hotspots: createHotspotSlice(),
        status: null,
        statusError: null,
        statusLoading: true,
      }))
      void reloadRepositories()
    }

    /** Copy the current diff text, when the platform allows it. */
    const copyDiff = async (): Promise<void> => {
      const text = stateRef.current.diff.data?.text ?? ''
      if (text === '') return
      try {
        if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return
        await navigator.clipboard.writeText(text)
      } catch {
        return
      }
      if (!aliveRef.current) return
      setState((prev) => ({ ...prev, copied: true }))
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => {
        if (aliveRef.current) setState((prev) => ({ ...prev, copied: false }))
      }, 1500)
    }

    /**
     * Load one write-operation preview for the exact params in `draft`.
     *
     * `quiet` re-previews after an input edit: the previous preview stays on
     * screen (only `updating` is set) so typing does not flash the dialog
     * between skeleton and content. The footer keeps confirm disabled until the
     * fresh preview lands, so a stale confirmation token is never executed.
     */
    const runPreview = async (repositoryId: string, draft: OperationDraft, quiet = false): Promise<void> => {
      const token = ++dialogTokenRef.current
      setState((prev) => {
        if (prev.dialog === null) return prev
        const keepPreview = quiet && prev.dialog.preview !== null
        return {
          ...prev,
          dialog: {
            ...prev.dialog,
            operation: draft.operation,
            message: draft.message,
            remote: draft.remote,
            branch: draft.branch,
            ...(keepPreview
              ? { updating: true }
              : { phase: 'previewing' as const, preview: null, updating: false }),
            previewError: null,
            executeError: null,
          },
        }
      })
      const result = await requestPreview(deps.api, repositoryId, draft)
      if (!aliveRef.current || token !== dialogTokenRef.current) return
      setState((prev) => {
        if (prev.dialog === null) return prev
        if (!result.ok) {
          return { ...prev, dialog: { ...prev.dialog, phase: 'error', previewError: result.error, updating: false } }
        }
        return {
          ...prev,
          dialog: {
            ...prev.dialog,
            phase: result.value.allowed ? 'previewed' : 'blocked',
            preview: result.value,
            previewError: null,
            updating: false,
          },
        }
      })
    }

    /**
     * Open the confirmation dialog for one write operation.
     *
     * The preview is requested immediately with the dialog's current params.
     * Re-previewing the same operation keeps the typed message/remote/branch,
     * so a preview blocked for a missing commit message can be corrected and
     * previewed again without losing input.
     */
    const startOperation = (operation: OperationType): void => {
      const snapshot = stateRef.current
      const repositoryId = snapshot.selectedRepositoryId
      if (repositoryId === null) return
      if (repreviewTimerRef.current !== null) {
        clearTimeout(repreviewTimerRef.current)
        repreviewTimerRef.current = null
      }
      const repository = findRepository(snapshot, repositoryId)
      const draft = createOperationDraft(operation, repository, snapshot.dialog)
      const wantsChecks = operation === 'commit'
      setState((prev) => ({
        ...prev,
        menuOpen: false,
        dialog: {
          operation: draft.operation,
          phase: 'previewing',
          preview: null,
          previewError: null,
          executeError: null,
          result: null,
          message: draft.message,
          remote: draft.remote,
          branch: draft.branch,
          checks: null,
          checksLoading: wantsChecks,
          acknowledged: false,
        },
      }))
      void runPreview(repositoryId, draft)
      if (wantsChecks) void loadDialogChecks(repositoryId)
    }

    /**
     * Keep the form usable while the user types: show the new inputs at once,
     * then re-preview (debounced, read-only) with the params that will later
     * identify the execute call. Never an automatic write.
     */
    const schedulePreview = (draft: OperationDraft): void => {
      const repositoryId = stateRef.current.selectedRepositoryId
      if (repositoryId === null) return
      // Any preview still in flight was built from older inputs: retire it so
      // its response cannot re-enable the confirm button with stale params.
      dialogTokenRef.current += 1
      // Keep the rendered preview while the new one is being fetched: resetting
      // to `previewing` here made the dialog visibly flash on every keystroke.
      setState((prev) => prev.dialog === null
        ? prev
        : {
          ...prev,
          dialog: {
            ...prev.dialog,
            operation: draft.operation,
            message: draft.message,
            remote: draft.remote,
            branch: draft.branch,
            updating: true,
            previewError: null,
            executeError: null,
          },
        })
      if (repreviewTimerRef.current !== null) clearTimeout(repreviewTimerRef.current)
      repreviewTimerRef.current = setTimeout(() => {
        repreviewTimerRef.current = null
        void runPreview(repositoryId, draft, true)
      }, 450)
    }

    /** Execute the previewed operation with its single-use token. */
    const confirmOperation = async (): Promise<void> => {
      const snapshot = stateRef.current
      const dialog = snapshot.dialog
      const repositoryId = snapshot.selectedRepositoryId
      if (dialog === null || repositoryId === null) return
      // A quiet re-preview is in flight: its token is not the one we hold.
      if (dialog.updating === true) return
      if (dialog.phase !== 'previewed' || dialog.preview === null || !dialog.preview.allowed) return
      const draft: OperationDraft = {
        operation: dialog.operation,
        message: dialog.message,
        remote: dialog.remote,
        branch: dialog.branch,
      }
      if (draft.operation === 'commit' && draft.message.trim() === '') return
      // Blocking findings from the real staged diff need an explicit
      // acknowledgement; the button stays disabled until the box is ticked.
      if (draft.operation === 'commit' && hasBlockingChecks(dialog.checks) && !dialog.acknowledged) return
      if (repreviewTimerRef.current !== null) {
        clearTimeout(repreviewTimerRef.current)
        repreviewTimerRef.current = null
      }
      const token = ++dialogTokenRef.current
      setState((prev) => prev.dialog === null
        ? prev
        : { ...prev, dialog: { ...prev.dialog, phase: 'executing', updating: false, executeError: null } })
      const result = await requestExecute(deps.api, repositoryId, draft, dialog.preview.confirmationToken)
      if (!aliveRef.current || token !== dialogTokenRef.current) return
      if (!result.ok) {
        setState((prev) => prev.dialog === null
          ? prev
          : { ...prev, dialog: { ...prev.dialog, phase: 'previewed', executeError: result.error } })
        return
      }
      setState((prev) => {
        if (prev.dialog === null) return prev
        return {
          ...prev,
          dialog: { ...prev.dialog, phase: 'result', result: result.value, executeError: null },
          refreshTick: prev.refreshTick + 1,
          statusTick: prev.statusTick + 1,
        }
      })
    }

    /**
     * Fit the panel to the host's conversation area.
     *
     * A Conversation View is mounted inside the chat scroll region, so a plain
     * `height: 100%` resolves against a content-sized wrapper: with a long
     * commit list the panel would grow to that list's height and the host would
     * scroll the whole panel, taking the toolbar, tree and status bar with it.
     * The host's scroll element is bounded and holds the view area plus the
     * composer seat; the panel takes what is left above the seats. The sidebar
     * host (no such scroll element) keeps the CSS `height: 100%` path.
     */
    React.useLayoutEffect(() => {
      const element = rootRef.current
      if (element === null || typeof window === 'undefined') return undefined
      const scroller = element.closest('[data-conversation-scroll]')
      if (!(scroller instanceof HTMLElement)) return undefined
      // The Conversation View replaces the chat: the composer seat and any
      // other sibling of our area are hidden while this view is mounted, and
      // restored verbatim on unmount (switching back to 对话).
      const hidden: Array<{ node: HTMLElement; display: string }> = []
      const hideSiblings = (): void => {
        for (const child of Array.from(scroller.children)) {
          if (!(child instanceof HTMLElement)) continue
          if (child === element || child.contains(element)) continue
          if (child.dataset.dvtHidden === '1') continue
          hidden.push({ node: child, display: child.style.display })
          child.dataset.dvtHidden = '1'
          child.style.display = 'none'
        }
      }
      const update = (): void => {
        hideSiblings()
        const scrollerRect = scroller.getBoundingClientRect()
        const elementRect = element.getBoundingClientRect()
        const offset = Math.max(0, elementRect.top - scrollerRect.top)
        const available = Math.max(240, Math.floor(scroller.clientHeight - offset))
        element.style.height = `${available}px`
      }
      update()
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { update() }) : null
      observer?.observe(scroller)
      const mutations = typeof MutationObserver === 'function' ? new MutationObserver(() => { update() }) : null
      mutations?.observe(scroller, { childList: true })
      window.addEventListener('resize', update)
      return () => {
        observer?.disconnect()
        mutations?.disconnect()
        window.removeEventListener('resize', update)
        element.style.height = ''
        for (const entry of hidden) {
          entry.node.style.display = entry.display
          delete entry.node.dataset.dvtHidden
        }
      }
    }, [])

    // Bootstrap: diagnostics + repositories.
    React.useEffect(() => {
      void reloadRepositories()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Dynamic loading: tell the warm-up service the panel is open, so it stops
    // its heavier background timer and leaves live revalidation to the panel.
    React.useEffect(() => {
      const sync = deps.sync
      if (sync === undefined) return undefined
      sync.setWorkspace(resolveWorkspace())
      sync.setPanelOpen(true)
      sync.setActiveRepository(stateRef.current.selectedRepositoryId)
      sync.noteActiveView({
        workspacePath: resolveWorkspace(),
        repositoryId: stateRef.current.selectedRepositoryId,
      })
      return () => { sync.setPanelOpen(false) }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Remember the active view for the next warm run, so the cache holds the
    // history the user is most likely to open next.
    React.useEffect(() => {
      const sync = deps.sync
      if (sync === undefined) return
      sync.setWorkspace(resolveWorkspace())
      sync.setActiveRepository(state.selectedRepositoryId)
      sync.noteActiveView({ workspacePath: resolveWorkspace(), repositoryId: state.selectedRepositoryId })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.selectedRepositoryId])

    // Live refresh while visible: a cheap status probe every 10 s (a changed
    // working tree or HEAD triggers a silent history reload), plus a full quiet
    // revalidation every 30 s. Background tabs poll nothing; returning to the
    // tab or focusing the window refreshes immediately.
    React.useEffect(() => {
      const repositoryId = state.selectedRepositoryId
      if (repositoryId === null || typeof window === 'undefined' || typeof document === 'undefined') return undefined
      const isHidden = (): boolean => document.visibilityState === 'hidden'
      let statusTimer: ReturnType<typeof setInterval> | null = null
      let refreshTimer: ReturnType<typeof setInterval> | null = null
      const startTimers = (): void => {
        if (statusTimer === null) {
          statusTimer = setInterval(() => {
            if (!isHidden()) void pollStatusOnce(repositoryId)
          }, STATUS_POLL_INTERVAL_MS)
        }
        if (refreshTimer === null) {
          refreshTimer = setInterval(() => {
            if (!isHidden()) revalidateVisible()
          }, AUTO_REFRESH_INTERVAL_MS)
        }
      }
      const stopTimers = (): void => {
        if (statusTimer !== null) {
          clearInterval(statusTimer)
          statusTimer = null
        }
        if (refreshTimer !== null) {
          clearInterval(refreshTimer)
          refreshTimer = null
        }
      }
      const onVisibility = (): void => {
        if (isHidden()) {
          stopTimers()
          return
        }
        startTimers()
        void pollStatusOnce(repositoryId)
        revalidateVisible()
      }
      const onFocus = (): void => {
        if (isHidden()) return
        const now = deps.now?.() ?? Date.now()
        if (now - lastFocusRefreshRef.current < FOCUS_REFRESH_THROTTLE_MS) return
        lastFocusRefreshRef.current = now
        void pollStatusOnce(repositoryId)
        revalidateVisible()
      }
      startTimers()
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('focus', onFocus)
      return () => {
        stopTimers()
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('focus', onFocus)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.selectedRepositoryId])

    // Working-tree status for the selected repository.
    React.useEffect(() => {
      const repositoryId = state.selectedRepositoryId
      if (repositoryId === null) return
      void loadStatus(repositoryId)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.selectedRepositoryId, state.statusTick])

    // First page for the active source whenever repository/filters/source change.
    React.useEffect(() => {
      const repositoryId = state.selectedRepositoryId
      if (repositoryId === null) return
      if (state.source === 'timeline') void loadTimeline(repositoryId, null)
      else if (state.source === 'audit') void loadAudit(repositoryId, null)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      state.selectedRepositoryId,
      state.source,
      state.filters.debouncedText,
      state.filters.eventTypes.join(','),
      state.filters.author,
      state.filters.timePreset,
      state.filters.branch,
      state.filters.branchScope,
      state.refreshTick,
    ])

    // Audit nodes interleaved into the timeline need the audit page too, and
    // the hotspot calendar counts pushes from those same audited operations.
    React.useEffect(() => {
      const repositoryId = state.selectedRepositoryId
      if (repositoryId === null) return
      const needed = (state.source === 'timeline' && state.filters.auditInTimeline)
        || state.source === 'hotspots'
      if (!needed) return
      if (state.audit.loading || state.audit.operations.length > 0) return
      void loadAudit(repositoryId, null)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.selectedRepositoryId, state.source, state.filters.auditInTimeline, state.refreshTick])

    // Pending workbench: dirty-file checks, session attribution and the
    // selected file's diff are loaded only while that source is visible.
    // The timeline also needs the session file set for commit-row attribution.
    React.useEffect(() => {
      const repositoryId = state.selectedRepositoryId
      if (repositoryId === null) return
      if (state.source === 'timeline') {
        if (state.pending.session === null && !state.pending.sessionLoading) void loadSessionChanges(repositoryId)
        return
      }
      if (state.source !== 'pending') return
      void loadChecks(repositoryId, state.pending.checksScope, false)
      void loadSessionChanges(repositoryId)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      state.selectedRepositoryId,
      state.source,
      state.pending.checksScope,
      state.refreshTick,
    ])

    // Hotspot ranking is a Host-side scan: load on demand and on refresh.
    React.useEffect(() => {
      const repositoryId = state.selectedRepositoryId
      if (repositoryId === null) return
      if (state.source !== 'hotspots') return
      void loadHotspots(repositoryId)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.selectedRepositoryId, state.source, state.hotspots.refreshTick, state.refreshTick])

    // First pull-request page whenever the PR source becomes active.
    React.useEffect(() => {
      const repositoryId = state.selectedRepositoryId
      if (repositoryId === null || state.source !== 'pr') return
      void loadPullRequests(repositoryId, false)
      void loadBranchCompare(repositoryId)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.selectedRepositoryId, state.source, state.pullRequests.refreshTick])

    // Debounce the search box before it reaches the Host.
    React.useEffect(() => {
      const handle = setTimeout(() => {
        setState((prev) => prev.filters.text === prev.filters.debouncedText
          ? prev
          : { ...prev, filters: { ...prev.filters, debouncedText: prev.filters.text } })
      }, 250)
      return () => clearTimeout(handle)
    }, [state.filters.text])

    // Escape unwinds our own layers: dialog first, then the header menu, then
    // the diagnostics block. It never closes anything while a write executes.
    const overlayOpen = state.dialog !== null || state.menuOpen || state.diagnosticsOpen
    React.useEffect(() => {
      if (!overlayOpen || typeof document === 'undefined') return
      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return
        const snapshot = stateRef.current
        if (snapshot.dialog !== null) {
          if (snapshot.dialog.phase === 'executing') return
          event.stopPropagation()
          setState((prev) => ({ ...prev, dialog: null }))
          return
        }
        if (snapshot.menuOpen) {
          event.stopPropagation()
          setState((prev) => ({ ...prev, menuOpen: false }))
          return
        }
        if (snapshot.diagnosticsOpen) {
          event.stopPropagation()
          setState((prev) => ({ ...prev, diagnosticsOpen: false }))
        }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
    }, [overlayOpen])

    /** Select one repository file and reveal its newest diff in the timeline. */
    const selectFile = (path: string | null): void => {
      setState((prev) => {
        if (path === prev.selectedFilePath) return prev
        const expanded = { ...prev.expandedDirs }
        if (path !== null) {
          // Reveal every ancestor of the file so the selection is visible.
          const segments = path.split('/')
          let dir = ''
          for (const segment of segments.slice(0, -1)) {
            dir = dir === '' ? segment : `${dir}/${segment}`
            expanded[dir] = true
          }
        }
        return {
          ...prev,
          selectedFilePath: path,
          expandedDirs: expanded,
          changeSet: createChangeSetSlice(),
          diff: createDiffSlice(),
        }
      })
      // Selecting a file reveals who changed it and its newest diff.
      if (path !== null) openLatestFileDiff(path)
    }

    const handlers: PanelHandlers = {
      onRefreshRepositories: () => {
        setState((prev) => ({ ...prev, menuOpen: false, refreshTick: prev.refreshTick + 1, statusTick: prev.statusTick + 1 }))
        void reloadRepositories()
      },
      onSelectRepository: (repositoryId: string) => {
        setState((prev) => {
          const selected = repositoryId === '' ? null : repositoryId
          if (selected === prev.selectedRepositoryId) return prev
          return {
            ...prev,
            menuOpen: false,
            selectedRepositoryId: selected,
            selectedFilePath: null,
            expandedDirs: {},
            // Mark the first paint as loading synchronously, otherwise the new
            // repository would show one frame of "empty history" before the
            // effect starts the request and the skeleton appears.
            timeline: { ...createTimelineSlice(), loading: selected !== null },
            changeSet: createChangeSetSlice(),
            diff: createDiffSlice(),
            audit: createAuditSlice(),
            status: null,
            statusError: null,
            statusLoading: selected !== null,
            dialog: null,
            pullRequests: createPullRequestSlice(),
            pending: createPendingSlice(),
            hotspots: createHotspotSlice(),
          }
        })
      },
      onSetSource: (source: PanelSource) => setState((prev) => {
        if (prev.source === source) return prev
        // Same as a repository switch: the newly selected source is loading on
        // this very render, so its skeleton appears without an empty-state flash.
        const auditLoading = source === 'audit' && prev.audit.operations.length === 0
        const prLoading = source === 'pr' && prev.pullRequests.data === null
        const hotspotLoading = source === 'hotspots' && prev.hotspots.data === null
        return {
          ...prev,
          menuOpen: false,
          source,
          selectedFilePath: null,
          changeSet: createChangeSetSlice(),
          diff: createDiffSlice(),
          pending: {
            ...prev.pending,
            path: null,
            diff: null,
            diffError: null,
            diffLoading: false,
            ...(source === 'pending' && prev.status === null ? { checksLoading: true } : {}),
          },
          audit: { ...prev.audit, selected: null, ...(auditLoading ? { loading: true } : {}) },
          hotspots: { ...prev.hotspots, ...(hotspotLoading ? { loading: true } : {}) },
          pullRequests: {
            ...prev.pullRequests,
            ...(prLoading ? { loading: true } : {}),
            ...(source === 'pr'
              ? {}
              : { selectedNumber: null, detail: null, detailError: null, detailLoading: false }),
          },
        }
      }),
      onRefreshPullRequests: () => {
        setState((prev) => ({ ...prev, pullRequests: { ...prev.pullRequests, refreshTick: prev.pullRequests.refreshTick + 1 } }))
        const repositoryId = stateRef.current.selectedRepositoryId
        if (repositoryId !== null) void loadPullRequests(repositoryId, true)
      },
      onSetPullRequestFilter: (filter: PullRequestFilter) => setState((prev) => {
        if (prev.pullRequests.filter === filter) return prev
        return { ...prev, pullRequests: { ...prev.pullRequests, filter } }
      }),
      onSelectPullRequest: (number: number) => {
        const repositoryId = stateRef.current.selectedRepositoryId
        if (repositoryId === null) return
        void loadPullRequestDetail(repositoryId, number)
      },
      onOpenFileRevision: (revision: string) => {
        const path = stateRef.current.selectedFilePath
        if (path === null || path === '') return
        void openDiff(path, revision)
      },
      onToggleAddRepository: () => setState((prev) => ({
        ...prev,
        addRepository: prev.addRepository.open
          ? { ...prev.addRepository, open: false, error: null }
          : { ...prev.addRepository, open: true, error: null },
      })),
      onAddRepositoryPathChange: (path: string) => setState((prev) => ({
        ...prev,
        addRepository: { ...prev.addRepository, path },
      })),
      onAddRepositorySubmit: () => { void submitAddRepository() },
      onClosePullRequest: () => setState((prev) => ({
        ...prev,
        pullRequests: { ...prev.pullRequests, selectedNumber: null, detail: null, detailError: null, detailLoading: false },
      })),
      onSetAuditState: (auditState) => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, auditState },
      })),
      onTextChange: (text: string) => setState((prev) => ({ ...prev, filters: { ...prev.filters, text } })),
      onToggleEventType: (eventType) => setState((prev) => {
        const active = prev.filters.eventTypes.includes(eventType)
        const eventTypes = active
          ? prev.filters.eventTypes.filter((entry) => entry !== eventType)
          : [...prev.filters.eventTypes, eventType]
        return { ...prev, filters: { ...prev.filters, eventTypes } }
      }),
      onShowAllEventTypes: () => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, eventTypes: [] },
      })),
      onAuthorChange: (author: string) => setState((prev) => ({ ...prev, filters: { ...prev.filters, author } })),
      onToggleAuthor: () => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, showAuthor: !prev.filters.showAuthor },
      })),
      onClearFilters: () => setState((prev) => ({
        ...prev,
        selectedFilePath: null,
        filters: {
          text: '',
          debouncedText: '',
          eventTypes: [],
          author: '',
          showAuthor: prev.filters.showAuthor,
          treeQuery: '',
          fileStatus: 'all',
          auditState: 'all',
          timePreset: 'all',
          branch: '',
          branchScope: 'current',
          auditInTimeline: prev.filters.auditInTimeline,
        },
      })),
      onSelectFile: (path: string | null) => selectFile(path),
      onPrefetchFile: (path: string) => prefetchDiff(path),
      onCancelPrefetchFile: (path: string) => cancelPrefetchDiff(path),
      onTreeQueryChange: (treeQuery: string) => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, treeQuery },
      })),
      onSetFileStatus: (fileStatus) => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, fileStatus },
      })),
      onToggleDir: (path: string) => setState((prev) => ({
        ...prev,
        expandedDirs: { ...prev.expandedDirs, [path]: prev.expandedDirs[path] !== true },
      })),
      onExpandAllDirs: () => setState((prev) => {
        const visible = filterFileEntries(
          aggregateChangedFiles(prev.timeline.events),
          prev.filters.treeQuery,
          prev.filters.fileStatus,
        )
        const expanded: Record<string, boolean> = { ...prev.expandedDirs }
        for (const dir of directoryPaths(buildFileTree(visible))) expanded[dir] = true
        return { ...prev, expandedDirs: expanded }
      }),
      onCollapseAllDirs: () => setState((prev) => ({ ...prev, expandedDirs: {} })),
      onSetTimePreset: (timePreset) => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, timePreset },
      })),
      onLoadMoreTimeline: () => {
        const snapshot = stateRef.current
        const repositoryId = snapshot.selectedRepositoryId
        if (repositoryId === null || snapshot.timeline.loadingMore || !snapshot.timeline.hasMore) return
        void loadTimeline(repositoryId, snapshot.timeline.cursor)
      },
      onRetryTimeline: () => {
        const snapshot = stateRef.current
        if (snapshot.selectedRepositoryId !== null) void loadTimeline(snapshot.selectedRepositoryId, null)
      },
      onOpenEvent: (event: VcsEvent) => {
        // A commit row always wins over a previously opened audit node.
        setState((prev) => ({ ...prev, audit: { ...prev.audit, selected: null } }))
        void openEvent(event)
      },
      onBackFromDetail: () => setState((prev) => ({ ...prev, changeSet: createChangeSetSlice() })),
      onOpenFile: (filePath: string) => {
        void openDiff(filePath, stateRef.current.changeSet.revision)
      },
      onBackFromDiff: () => setState((prev) => ({ ...prev, diff: createDiffSlice() })),
      onCopyDiff: () => { void copyDiff() },
      onLoadMoreAudit: () => {
        const snapshot = stateRef.current
        const repositoryId = snapshot.selectedRepositoryId
        if (repositoryId === null || snapshot.audit.loadingMore || !snapshot.audit.hasMore) return
        void loadAudit(repositoryId, snapshot.audit.cursor)
      },
      onRetryAudit: () => {
        const snapshot = stateRef.current
        if (snapshot.selectedRepositoryId !== null) void loadAudit(snapshot.selectedRepositoryId, null)
      },
      onOpenOperation: (attempt: OperationAttempt) => setState((prev) => ({
        ...prev,
        audit: { ...prev.audit, selected: attempt },
      })),
      onBackFromAuditDetail: () => setState((prev) => ({
        ...prev,
        audit: { ...prev.audit, selected: null },
      })),
      onStartOperation: (operation: OperationType) => startOperation(operation),
      onDialogClose: () => {
        if (stateRef.current.dialog?.phase === 'executing') return
        if (repreviewTimerRef.current !== null) {
          clearTimeout(repreviewTimerRef.current)
          repreviewTimerRef.current = null
        }
        setState((prev) => ({ ...prev, dialog: null, copied: false }))
      },
      onDialogMessageChange: (message: string) => {
        const dialog = stateRef.current.dialog
        if (dialog === null || dialog.phase === 'executing' || dialog.phase === 'result') return
        schedulePreview({ operation: dialog.operation, message, remote: dialog.remote, branch: dialog.branch })
      },
      onDialogRemoteChange: (remote: string) => {
        const dialog = stateRef.current.dialog
        if (dialog === null || dialog.phase === 'executing' || dialog.phase === 'result') return
        schedulePreview({ operation: dialog.operation, message: dialog.message, remote, branch: dialog.branch })
      },
      onDialogBranchChange: (branch: string) => {
        const dialog = stateRef.current.dialog
        if (dialog === null || dialog.phase === 'executing' || dialog.phase === 'result') return
        schedulePreview({ operation: dialog.operation, message: dialog.message, remote: dialog.remote, branch })
      },
      onDialogConfirm: () => { void confirmOperation() },
      onDialogRepreview: () => {
        const dialog = stateRef.current.dialog
        const repositoryId = stateRef.current.selectedRepositoryId
        if (dialog === null || repositoryId === null) return
        if (dialog.phase === 'executing') return
        if (repreviewTimerRef.current !== null) {
          clearTimeout(repreviewTimerRef.current)
          repreviewTimerRef.current = null
        }
        void runPreview(repositoryId, {
          operation: dialog.operation,
          message: dialog.message,
          remote: dialog.remote,
          branch: dialog.branch,
        })
      },
      onRetryStatus: () => setState((prev) => ({ ...prev, statusTick: prev.statusTick + 1 })),
      onToggleWriteMenu: () => setState((prev) => ({ ...prev, menuOpen: !prev.menuOpen })),
      onCloseWriteMenu: () => setState((prev) => (prev.menuOpen ? { ...prev, menuOpen: false } : prev)),
      onToggleDiagnostics: () => setState((prev) => ({ ...prev, diagnosticsOpen: !prev.diagnosticsOpen })),
      onSelectPendingFile: (path: string, staged: boolean) => {
        const repositoryId = stateRef.current.selectedRepositoryId
        if (repositoryId === null) return
        void loadPendingDiff(repositoryId, path, staged)
      },
      onBackFromPendingDiff: () => setState((prev) => ({
        ...prev,
        pending: { ...prev.pending, path: null, diff: null, diffError: null, diffLoading: false },
      })),
      onSetChecksScope: (scope: ChecksScope) => setState((prev) => ({
        ...prev,
        pending: { ...prev.pending, checksScope: scope },
      })),
      onRefreshChecks: () => {
        const repositoryId = stateRef.current.selectedRepositoryId
        if (repositoryId === null) return
        void loadChecks(repositoryId, stateRef.current.pending.checksScope, true)
      },
      onRefreshSessionChanges: () => {
        const repositoryId = stateRef.current.selectedRepositoryId
        if (repositoryId === null) return
        void loadSessionChanges(repositoryId)
      },
      onRefreshHotspots: () => {
        setState((prev) => ({ ...prev, hotspots: { ...prev.hotspots, refreshTick: prev.hotspots.refreshTick + 1 } }))
        const repositoryId = stateRef.current.selectedRepositoryId
        if (repositoryId === null) return
        void loadHotspots(repositoryId)
        // The calendar's push metric reads the audited operations; a refresh
        // must re-read them, otherwise it would report stale push counts.
        void loadAudit(repositoryId, null)
      },
      onSetHotspotDimension: (dimension: HotspotDimension) => setState((prev) => ({
        ...prev,
        hotspots: { ...prev.hotspots, dimension },
      })),
      onSetHotspotCalendarMetric: (calendarMetric) => setState((prev) => ({
        ...prev,
        hotspots: { ...prev.hotspots, calendarMetric },
      })),
      onOpenHotspotFile: (path: string) => {
        setState((prev) => ({ ...prev, source: 'timeline' }))
        selectFile(path)
      },
      onSelectBranch: (branch: string) => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, branch, branchScope: 'current' },
      })),
      onClearBranchFilter: () => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, branch: '' },
      })),
      onSetBranchScope: (branchScope: 'current' | 'all') => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, branchScope, ...(branchScope === 'all' ? { branch: '' } : {}) },
      })),
      onToggleAuditInTimeline: () => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, auditInTimeline: !prev.filters.auditInTimeline },
      })),
      onToggleDialogAck: () => setState((prev) => prev.dialog === null
        ? prev
        : { ...prev, dialog: { ...prev.dialog, acknowledged: !prev.dialog.acknowledged } }),
    }

    // Cheap keyboard navigation: Alt+1/2/3 switch source, Alt+R refreshes.
    const handlersRef = React.useRef(handlers)
    handlersRef.current = handlers
    React.useEffect(() => {
      if (typeof document === 'undefined') return undefined
      const onKeyDown = (event: KeyboardEvent): void => {
        if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        const current = handlersRef.current
        if (event.key === '1' || event.key === '2' || event.key === '3' || event.key === '4' || event.key === '5') {
          event.preventDefault()
          const sources: PanelSource[] = ['timeline', 'pending', 'hotspots', 'pr', 'audit']
          current.onSetSource(sources[Number(event.key) - 1] ?? 'timeline')
          return
        }
        if (event.key.toLowerCase() === 'r') {
          event.preventDefault()
          current.onRefreshRepositories()
        }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
    }, [])

    return renderPanelView({ state, deps, handlers, rootRef, view: timelineView, graph: graphModel })
  }
}

/** Re-exported for tests that need to build a state quickly. */
export { createInitialState } from './types.ts'
