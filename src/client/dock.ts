/**
 * dsh-vcs-timeline — composer dock strip and its fullscreen overlay.
 *
 * The dock is the plugin's always-visible entry point: one 26px row directly
 * above the chat composer showing the repository, its branch and the count of
 * uncommitted paths. Clicking it opens the same timeline panel in a
 * frame-wide overlay (`mode: 'overlay'`), with an optional browser-fullscreen
 * toggle — no navigation away from the conversation.
 *
 * The row keeps its own tiny repository snapshot (repository list + working
 * tree status) so opening the timeline never waits on it; the overlay panel
 * loads its own, larger data set.
 * @module dsh-vcs-timeline/client/dock
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import type { ApiError, Diagnostics, Repository } from '../shared/contracts.ts'
import type { VcsClient } from './api.ts'
import type { TranslateFn } from './i18n.ts'
import { STYLES } from './styles.ts'
import type { PanelProps } from './types.ts'
import { IconBranch, IconMaximize, IconRepo } from './ui/icons.ts'

const h = React.createElement

/** Everything the dock entry needs; injected once per plugin activation. */
export interface DockDeps {
  api: VcsClient
  t: TranslateFn
  /** The panel component, shared with the sidebar tab. */
  Panel: React.ComponentType<PanelProps>
  /** Resolve the workspace root of one slot occurrence (or null). */
  resolveWorkspacePath: (props: PanelProps) => string | null
}

/** One repository snapshot for the strip; never used as panel data. */
interface RepoSnapshot {
  repository: Repository | null
  diagnostics: Diagnostics | null
  /** Number of uncommitted paths, or null when status could not be read. */
  changes: number | null
  conflicts: number
  error: ApiError | null
}

/** How long one snapshot stays fresh across dock mounts (ms). */
const CACHE_TTL_MS = 20_000

/** Snapshots by workspace root; the dock mounts per session and may remount. */
const cache = new Map<string, { snapshot: RepoSnapshot; at: number }>()
const inflight = new Map<string, Promise<RepoSnapshot>>()

/** Read the repository + working-tree snapshot for one workspace root. */
async function readSnapshot(api: VcsClient, cwd: string): Promise<RepoSnapshot> {
  const listed = await api.listRepositories(cwd)
  if (!listed.ok) {
    return { repository: null, diagnostics: null, changes: null, conflicts: 0, error: listed.error }
  }
  const repository = listed.value.repositories[0] ?? null
  const diagnostics = listed.value.diagnostics
  if (repository === null) {
    return { repository: null, diagnostics, changes: null, conflicts: 0, error: null }
  }
  const status = await api.status(repository.id)
  if (!status.ok) {
    return { repository, diagnostics, changes: null, conflicts: 0, error: status.error }
  }
  return {
    repository,
    diagnostics,
    changes: status.value.entries.length,
    conflicts: status.value.conflicts.length,
    error: null,
  }
}

/** Cached snapshot, shared by mounts and deduped per workspace. */
function loadSnapshot(api: VcsClient, cwd: string, force = false): Promise<RepoSnapshot> {
  const cached = cache.get(cwd)
  if (!force && cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
    return Promise.resolve(cached.snapshot)
  }
  const pending = inflight.get(cwd)
  if (pending !== undefined) return pending
  const promise = readSnapshot(api, cwd)
    .then((snapshot) => {
      cache.set(cwd, { snapshot, at: Date.now() })
      return snapshot
    })
    .finally(() => { inflight.delete(cwd) })
  inflight.set(cwd, promise)
  return promise
}

/** Props the `conversation.input.dock` slot passes to one entry. */
export interface DockProps {
  sessionId?: string
  workspacePath?: string | null
}

/** Overlay frame props, kept out of the panel's data contract. */
interface OverlayProps {
  deps: DockDeps
  sessionId?: string | undefined
  workspacePath?: string | null | undefined
  restoreFocus: () => void
  onClosed: () => void
}

/** Frame-wide overlay hosting the full timeline panel. */
function TimelineOverlay(props: OverlayProps): React.ReactElement {
  const { deps, sessionId, workspacePath } = props
  const { t } = deps
  const frameRef = React.useRef<HTMLDivElement | null>(null)
  const [fullscreen, setFullscreen] = React.useState<boolean>(false)
  const [portalTarget, setPortalTarget] = React.useState<HTMLElement | null>(null)

  React.useEffect(() => {
    if (typeof document === 'undefined') return
    setPortalTarget(document.body)
  }, [])

  // Escape exits fullscreen first (the browser owns that gesture), then the
  // overlay. The panel's own Escape handling unwinds its dialogs earlier.
  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (document.fullscreenElement !== null) return
      event.stopPropagation()
      props.onClosed()
    }
    const onFullscreenChange = (): void => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [props.onClosed])

  // Leaving the overlay must not leave the app in browser fullscreen; focus
  // returns to the dock button that opened it.
  const restoreFocus = props.restoreFocus
  React.useEffect(() => () => {
    if (typeof document !== 'undefined' && document.fullscreenElement !== null) {
      void document.exitFullscreen?.().catch(() => {})
    }
    restoreFocus()
  }, [restoreFocus])

  const frame = h('div', { className: 'dvt-ovl-frame', ref: frameRef, 'data-dvt-overlay': 'vcs-timeline' },
    h(deps.Panel, {
      sessionId,
      workspacePath,
      mode: 'overlay',
      // The dock row below already emitted the stylesheet for the whole frame.
      inlineStyles: false,
      onClose: props.onClosed,
      ...(typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function'
        ? {
          fullscreen,
          onToggleFullscreen: () => {
            const element = frameRef.current
            if (element === null) return
            if (document.fullscreenElement !== null) {
              void document.exitFullscreen?.().catch(() => {})
              return
            }
            void element.requestFullscreen?.().catch(() => {})
          },
        }
        : {}),
    }),
  )

  const node = h('div', {
    className: 'dvt-ovl',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': t('dock.overlayTitle'),
  },
  h('div', {
    className: 'dvt-ovl-backdrop',
    'aria-hidden': 'true',
    onClick: props.onClosed,
  }),
  frame,
  )

  // The dock row sits inside the composer stack; a portal keeps the
  // frame-wide overlay out of that scroll container's stacking context. On a
  // server render (tests) there is no document, so the node renders inline.
  return portalTarget === null ? node : createPortal(node, portalTarget)
}

/** One dock occurrence: the strip button plus its overlay when open. */
function DockEntry(props: DockProps & { deps: DockDeps }): React.ReactElement | null {
  const { deps } = props
  const { t } = deps
  const cwd = (() => {
    try {
      return deps.resolveWorkspacePath({ sessionId: props.sessionId, workspacePath: props.workspacePath })
    } catch {
      return null
    }
  })()
  const [snapshot, setSnapshot] = React.useState<RepoSnapshot | null>(() => {
    if (cwd === null) return null
    const cached = cache.get(cwd)
    return cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS ? cached.snapshot : null
  })
  const [open, setOpen] = React.useState<boolean>(false)
  const buttonRef = React.useRef<HTMLButtonElement | null>(null)

  const refresh = React.useCallback((force: boolean): void => {
    if (cwd === null) return
    void loadSnapshot(deps.api, cwd, force).then((next) => { setSnapshot(next) })
  }, [deps.api, cwd])

  React.useEffect(() => {
    if (cwd === null) {
      setSnapshot(null)
      return undefined
    }
    let live = true
    void loadSnapshot(deps.api, cwd).then((next) => { if (live) setSnapshot(next) })
    let lastFocus = 0
    const onFocus = (): void => {
      const now = Date.now()
      if (now - lastFocus < 5_000) return
      lastFocus = now
      void loadSnapshot(deps.api, cwd, true).then((next) => { if (live) setSnapshot(next) })
    }
    window.addEventListener('focus', onFocus)
    return () => {
      live = false
      window.removeEventListener('focus', onFocus)
    }
  }, [deps.api, cwd])

  // Re-read the strip after a write operation closes the overlay.
  const closeOverlay = React.useCallback((): void => {
    setOpen(false)
    refresh(true)
  }, [refresh])
  const restoreFocus = React.useCallback((): void => {
    buttonRef.current?.focus()
  }, [])

  const repository = snapshot?.repository ?? null
  if (repository === null) return null

  const branch = repository.currentBranch ?? undefined
  const changes = snapshot?.changes ?? null
  return h(React.Fragment, null,
    // The dock lives outside the panel tree, so it owns the stylesheet for its
    // own row (and hands it to the fullscreen panel via `inlineStyles: false`).
    h('style', { key: 'dvt-dock-styles' }, STYLES),
    h('div', { className: 'dvt-dock', 'data-dvt-dock': 'vcs-timeline' },
      h('button', {
        ref: buttonRef,
        type: 'button',
        className: 'dvt-dock-btn',
        title: repository.rootPath,
        'aria-haspopup': 'dialog',
        'aria-expanded': open,
        onClick: () => setOpen(true),
      },
      h('span', { className: 'dvt-dock-icon', 'aria-hidden': 'true' }, h(IconRepo, { size: 12 })),
      h('span', { className: 'dvt-dock-name' }, repository.displayName),
      h('span', { className: 'dvt-dock-vcs' }, repository.vcsType === 'git' ? 'GIT' : 'SVN'),
      branch === undefined || branch === ''
        ? null
        : h('span', { className: 'dvt-dock-branch' },
          h(IconBranch, { size: 10 }),
          h('span', null, branch),
        ),
      changes === null
        ? null
        : changes > 0
          ? h('span', { className: 'dvt-dock-dirty' },
            h('span', { className: 'dvt-dock-dot', 'aria-hidden': 'true' }),
            t('dock.dirty', { count: changes }),
            (snapshot?.conflicts ?? 0) > 0 ? h('span', { className: 'dvt-dock-conflict' }, t('dock.conflicts', { count: snapshot?.conflicts ?? 0 })) : null,
          )
          : h('span', { className: 'dvt-dock-clean' }, t('dock.clean')),
      h('span', { className: 'dvt-dock-open' },
        h('span', null, t('dock.open')),
        h(IconMaximize, { size: 11 }),
      ),
      ),
    ),
    open
      ? h(TimelineOverlay, {
        deps,
        sessionId: props.sessionId,
        workspacePath: props.workspacePath,
        restoreFocus,
        onClosed: closeOverlay,
      })
      : null,
  )
}

/**
 * Build the `conversation.input.dock` entry component.
 * @param deps - Host client, translator, panel and workspace resolver.
 * @returns the dock entry component.
 */
export function createDockEntry(deps: DockDeps): React.ComponentType<DockProps> {
  return function VcsTimelineDock(props: DockProps): React.ReactElement | null {
    return h(DockEntry, { ...props, deps })
  }
}
