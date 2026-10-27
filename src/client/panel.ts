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
  DiffQuery,
  OperationAttempt,
  OperationPreview,
  OperationRequest,
  OperationType,
  Repository,
  TimelineQuery,
  VcsEvent,
} from '../shared/contracts.ts'
import { renderPanelView } from './components.ts'
import {
  aggregateChangedFiles,
  buildFileTree,
  directoryPaths,
  filterFileEntries,
} from './file-index.ts'
import { windowSince } from './format.ts'
import type { ApiResult, VcsClient } from './api.ts'
import {
  createAuditSlice,
  createChangeSetSlice,
  createDiffSlice,
  createInitialState,
  createTimelineSlice,
} from './types.ts'
import type {
  DialogState,
  PanelDeps,
  PanelHandlers,
  PanelProps,
  PanelSource,
  PanelState,
} from './types.ts'

/** Find one repository in the current state. */
function findRepository(state: PanelState, repositoryId: string | null): Repository | null {
  if (repositoryId === null) return null
  return state.repositories.find((entry) => entry.id === repositoryId) ?? null
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
    const [state, setState] = React.useState<PanelState>(createInitialState)
    const stateRef = React.useRef<PanelState>(state)
    stateRef.current = state
    const aliveRef = React.useRef<boolean>(true)
    const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const repreviewTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
    const timelineTokenRef = React.useRef<number>(0)
    const auditTokenRef = React.useRef<number>(0)
    const statusTokenRef = React.useRef<number>(0)
    const detailTokenRef = React.useRef<number>(0)
    const diffTokenRef = React.useRef<number>(0)
    const dialogTokenRef = React.useRef<number>(0)

    React.useEffect(() => () => {
      aliveRef.current = false
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current)
      if (repreviewTimerRef.current !== null) clearTimeout(repreviewTimerRef.current)
    }, [])

    /** Derive the workspace root for this slot occurrence, defensively. */
    const resolveWorkspace = (): string | null => {
      try {
        const injected = deps.resolveWorkspacePath?.(props)
        if (typeof injected === 'string' && injected !== '') return injected
      } catch {
        // fall through to the prop
      }
      return typeof props.workspacePath === 'string' && props.workspacePath !== '' ? props.workspacePath : null
    }

    /** Load diagnostics plus the repository list. */
    const reloadRepositories = async (): Promise<void> => {
      const workspacePath = resolveWorkspace()
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
        setState((prev) => ({
          ...prev,
          boot: prev.repositories.length === 0 ? 'error' : 'ready',
          bootError: result.error,
        }))
        return
      }
      const repositories = result.value.repositories
      setState((prev) => {
        const stillPresent = prev.selectedRepositoryId !== null
          && repositories.some((repository) => repository.id === prev.selectedRepositoryId)
        const selected = stillPresent ? prev.selectedRepositoryId : (repositories[0]?.id ?? null)
        const changed = selected !== prev.selectedRepositoryId
        return {
          ...prev,
          boot: 'ready',
          bootError: null,
          repositories,
          diagnostics: result.value.diagnostics,
          selectedRepositoryId: selected,
          workspacePath,
          noWorkspace: workspacePath === null,
          ...(changed
            ? {
              timeline: createTimelineSlice(),
              changeSet: createChangeSetSlice(),
              diff: createDiffSlice(),
              audit: createAuditSlice(),
              status: null,
              statusError: null,
            }
            : {}),
        }
      })
    }

    /** Load one timeline page; `cursor === null` replaces the list. */
    const loadTimeline = async (repositoryId: string, cursor: string | null): Promise<void> => {
      const token = ++timelineTokenRef.current
      const filters = stateRef.current.filters
      if (cursor === null) {
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
      } else {
        setState((prev) => ({ ...prev, timeline: { ...prev.timeline, loadingMore: true, error: null } }))
      }
      const query: TimelineQuery = { repositoryId, limit: DEFAULT_PAGE_SIZE, includeFiles: true }
      const text = filters.debouncedText.trim()
      if (text !== '') query.text = text
      if (filters.eventTypes.length > 0) query.eventTypes = [...filters.eventTypes]
      const author = filters.author.trim()
      if (author !== '') query.author = author
      const since = windowSince(filters.timePreset, deps.now?.() ?? Date.now())
      if (since !== undefined) query.since = since
      if (cursor !== null) query.cursor = cursor
      const result = await deps.api.timeline(query)
      if (!aliveRef.current || token !== timelineTokenRef.current) return
      if (stateRef.current.selectedRepositoryId !== repositoryId) return
      if (!result.ok) {
        setState((prev) => ({
          ...prev,
          timeline: { ...prev.timeline, loading: false, loadingMore: false, error: result.error },
        }))
        return
      }
      const page = result.value
      setState((prev) => {
        const known = new Set(prev.timeline.events.map((event) => event.id))
        const fresh = page.events.filter((event) => !known.has(event.id))
        return {
          ...prev,
          timeline: cursor === null
            ? {
              events: page.events,
              cursor: page.nextCursor,
              hasMore: page.hasMore,
              partial: page.partial === true,
              warnings: page.warnings ?? [],
              loading: false,
              loadingMore: false,
              error: null,
            }
            : {
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
      })
    }

    /** Load one audit page; `cursor === null` replaces the list. */
    const loadAudit = async (repositoryId: string, cursor: string | null): Promise<void> => {
      const token = ++auditTokenRef.current
      if (cursor === null) {
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
      } else {
        setState((prev) => ({ ...prev, audit: { ...prev.audit, loadingMore: true, error: null } }))
      }
      const result = await deps.api.listOperations(cursor === null ? { repositoryId } : { repositoryId, cursor })
      if (!aliveRef.current || token !== auditTokenRef.current) return
      if (stateRef.current.selectedRepositoryId !== repositoryId) return
      if (!result.ok) {
        setState((prev) => ({
          ...prev,
          audit: { ...prev.audit, loading: false, loadingMore: false, error: result.error },
        }))
        return
      }
      const page = result.value
      setState((prev) => {
        const known = new Set(prev.audit.operations.map((attempt) => attempt.id))
        const fresh = page.operations.filter((attempt) => !known.has(attempt.id))
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

    /** Load the working-tree snapshot of the selected repository. */
    const loadStatus = async (repositoryId: string): Promise<void> => {
      const token = ++statusTokenRef.current
      setState((prev) => ({ ...prev, statusLoading: true, statusError: null }))
      const result = await deps.api.status(repositoryId)
      if (!aliveRef.current || token !== statusTokenRef.current) return
      if (stateRef.current.selectedRepositoryId !== repositoryId) return
      if (!result.ok) {
        setState((prev) => ({ ...prev, statusLoading: false, statusError: result.error, status: null }))
        return
      }
      setState((prev) => ({ ...prev, statusLoading: false, statusError: null, status: result.value }))
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

    /** Load the diff of one changed file of the open revision. */
    const openDiff = async (filePath: string): Promise<void> => {
      const snapshot = stateRef.current
      const repositoryId = snapshot.selectedRepositoryId
      if (repositoryId === null) return
      const revision = snapshot.changeSet.revision
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
      setState((prev) => ({ ...prev, diff: { ...prev.diff, loading: false, error: null, data: result.value } }))
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

    /** Load one write-operation preview for the exact params in `draft`. */
    const runPreview = async (repositoryId: string, draft: OperationDraft): Promise<void> => {
      const token = ++dialogTokenRef.current
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
            phase: 'previewing',
            preview: null,
            previewError: null,
            executeError: null,
          },
        })
      const result = await requestPreview(deps.api, repositoryId, draft)
      if (!aliveRef.current || token !== dialogTokenRef.current) return
      setState((prev) => {
        if (prev.dialog === null) return prev
        if (!result.ok) return { ...prev, dialog: { ...prev.dialog, phase: 'error', previewError: result.error } }
        return {
          ...prev,
          dialog: {
            ...prev.dialog,
            phase: result.value.allowed ? 'previewed' : 'blocked',
            preview: result.value,
            previewError: null,
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
        },
      }))
      void runPreview(repositoryId, draft)
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
            phase: 'previewing',
            preview: null,
            previewError: null,
            executeError: null,
          },
        })
      if (repreviewTimerRef.current !== null) clearTimeout(repreviewTimerRef.current)
      repreviewTimerRef.current = setTimeout(() => {
        repreviewTimerRef.current = null
        void runPreview(repositoryId, draft)
      }, 450)
    }

    /** Execute the previewed operation with its single-use token. */
    const confirmOperation = async (): Promise<void> => {
      const snapshot = stateRef.current
      const dialog = snapshot.dialog
      const repositoryId = snapshot.selectedRepositoryId
      if (dialog === null || repositoryId === null) return
      if (dialog.phase !== 'previewed' || dialog.preview === null || !dialog.preview.allowed) return
      const draft: OperationDraft = {
        operation: dialog.operation,
        message: dialog.message,
        remote: dialog.remote,
        branch: dialog.branch,
      }
      if (draft.operation === 'commit' && draft.message.trim() === '') return
      if (repreviewTimerRef.current !== null) {
        clearTimeout(repreviewTimerRef.current)
        repreviewTimerRef.current = null
      }
      const token = ++dialogTokenRef.current
      setState((prev) => prev.dialog === null
        ? prev
        : { ...prev, dialog: { ...prev.dialog, phase: 'executing', executeError: null } })
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

    // Bootstrap: diagnostics + repositories.
    React.useEffect(() => {
      void reloadRepositories()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

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
      else void loadAudit(repositoryId, null)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      state.selectedRepositoryId,
      state.source,
      state.filters.debouncedText,
      state.filters.eventTypes.join(','),
      state.filters.author,
      state.filters.timePreset,
      state.refreshTick,
    ])

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
            timeline: createTimelineSlice(),
            changeSet: createChangeSetSlice(),
            diff: createDiffSlice(),
            audit: createAuditSlice(),
            status: null,
            statusError: null,
            statusLoading: false,
            dialog: null,
          }
        })
      },
      onSetSource: (source: PanelSource) => setState((prev) => {
        if (prev.source === source) return prev
        return {
          ...prev,
          menuOpen: false,
          source,
          changeSet: createChangeSetSlice(),
          diff: createDiffSlice(),
          audit: { ...prev.audit, selected: null },
        }
      }),
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
          timePreset: 'all',
        },
      })),
      onSelectFile: (path: string | null) => setState((prev) => {
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
      }),
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
      onOpenEvent: (event: VcsEvent) => { void openEvent(event) },
      onBackFromDetail: () => setState((prev) => ({ ...prev, changeSet: createChangeSetSlice() })),
      onOpenFile: (filePath: string) => { void openDiff(filePath) },
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
    }

    return renderPanelView({
      state,
      deps,
      handlers,
      mode: props.mode === 'overlay' ? 'overlay' : 'sidebar',
      withStyles: props.inlineStyles !== false,
      ...(props.fullscreen === undefined ? {} : { fullscreen: props.fullscreen }),
      ...(props.onClose === undefined ? {} : { onClose: props.onClose }),
      ...(props.onToggleFullscreen === undefined ? {} : { onToggleFullscreen: props.onToggleFullscreen }),
    })
  }
}

/** Re-exported for tests that need to build a state quickly. */
export { createInitialState } from './types.ts'
