/**
 * dsh-vcs-timeline — browser half.
 *
 * Registers the right-sidebar tab type "代码时间线" plus its keyed-slot body
 * and title, and wires the live Host client, translator, and workspace
 * resolver into {@link createTimelinePanel}. The registration shape is the
 * proven one from stage P0-A; only the panel body is new.
 * @module dsh-vcs-timeline/client
 */

import * as React from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createVcsApi } from './api.ts'
import { createTimelinePanel } from './panel.ts'
import { en, interpolate, normalizeLocale, zh } from './i18n.ts'
import type { Locale } from './i18n.ts'
import type { PanelProps } from './types.ts'

/** Locale namespace owned by this plugin. */
const NS = 'vcs-timeline'
/** Tab type id, also the keyed-slot key and the navigation kind. */
const TAB_ID = 'vcs-timeline'
/** Conversation View id (`conversation.view` slot cell). */
const VIEW_ID = 'vcs-timeline'

/** Structural face of the sidebar tab registry observed on 0.2.1-rc.3. */
interface SidebarRightTabsService {
  register(definition: {
    id: string
    kind: string
    title: () => string
    guide?: Array<{ order: number; title: () => string; description: () => string; icon?: unknown }>
  }): () => void
}

/** Structural face of the sidebar navigation service observed on 0.2.1-rc.3. */
interface SidebarRightService {
  openTab?(kind: string): void
}

/** Services read structurally: the installed client typings do not declare them. */
interface PluginServices {
  slots: {
    inject(key: string, callback: () => () => void): () => void
    register(definition: Record<string, unknown>, component: unknown): () => void
  }
  locale: {
    register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void
    bind(ns: string): (key: string, params?: Record<string, string | number>) => string
  }
  sidebarRightTabs: SidebarRightTabsService
  sidebarRight: SidebarRightService
}

/** Read a service without a compile-time declaration. */
function service<T>(ctx: ClientContext, name: string): T | undefined {
  try {
    return (ctx as unknown as { get?: (key: string, strict?: boolean) => unknown }).get?.(name, false) as T | undefined
  } catch {
    return undefined
  }
}

/** Session id of the sidebar occurrence that hosts this tab body. */
function sessionIdFor(props: PanelProps): string | undefined {
  if (typeof props.sessionId === 'string' && props.sessionId !== '') return props.sessionId
  try {
    if (typeof document === 'undefined') return undefined
    const element = document.querySelector('[data-sidebar-right-session]')
    const id = element instanceof HTMLElement ? element.dataset.sidebarRightSession : undefined
    return id === '' ? undefined : id
  } catch {
    return undefined
  }
}

/**
 * Resolve the session's workspace root from the injected sessions service.
 *
 * The client typings do not declare `sessions`, so every observed shape is
 * tried defensively and any mismatch degrades to `null` (the Host then lists
 * repositories from all registered workspaces).
 */
function resolveCwd(ctx: ClientContext, sessionId: string | undefined): string | null {
  if (sessionId === undefined || sessionId === '') return null
  try {
    const sessions = service<Record<string, unknown>>(ctx, 'sessions')
    if (sessions === undefined || sessions === null) return null
    const list = sessions.list as Record<string, unknown> | undefined
    const candidates: unknown[] = []
    if (typeof list?.getSnapshot === 'function') candidates.push((list.getSnapshot as () => unknown)())
    if (typeof sessions.getSnapshot === 'function') candidates.push((sessions.getSnapshot as () => unknown)())
    if (typeof sessions.list === 'function') candidates.push((sessions.list as () => unknown)())
    if (list !== undefined) candidates.push(list)
    candidates.push(sessions)
    for (const candidate of candidates) {
      if (typeof candidate !== 'object' || candidate === null) continue
      const byId = (candidate as { byId?: unknown }).byId
      if (typeof byId !== 'object' || byId === null) continue
      const entry = (byId as Record<string, unknown>)[sessionId]
      if (typeof entry !== 'object' || entry === null) continue
      const cwd = (entry as { cwd?: unknown }).cwd
      if (typeof cwd === 'string' && cwd !== '') return cwd
    }
    return null
  } catch {
    return null
  }
}

/** BCP-47 tag of the running page, used only for `Intl` date formatting. */
function detectLocale(): Locale {
  try {
    if (typeof document !== 'undefined') {
      const lang = document.documentElement.lang
      if (typeof lang === 'string' && lang !== '') return normalizeLocale(lang)
    }
    if (typeof navigator !== 'undefined') return normalizeLocale(navigator.language)
  } catch {
    // fall through
  }
  return 'zh'
}

/** Client plugin body. */
export function apply(ctx: ClientContext): void {
  const services = {
    slots: service<PluginServices['slots']>(ctx, 'slots'),
    locale: service<PluginServices['locale']>(ctx, 'locale'),
  }
  if (services.slots === undefined) return

  if (services.locale !== undefined) {
    ctx.effect(() => services.locale!.register(NS, { zh, en }), 'dsh-vcs-timeline: dictionaries')
  }

  const bound = services.locale?.bind(NS)
  const translate = (key: string, params?: Record<string, string | number>): string => {
    const translated = bound?.(key, params) ?? zh[key] ?? key
    // The bound translator already interpolates. This second pass is a safety
    // net for host versions whose bound function ignores the params argument:
    // a placeholder such as `{count}` must never leak into the UI.
    return params === undefined ? translated : interpolate(translated, params)
  }

  // One client + panel factory per plugin activation; both are side-effect free
  // until the panel mounts.
  const api = createVcsApi((url, init) => fetch(url, init))
  const Panel = createTimelinePanel({
    api,
    t: translate,
    locale: detectLocale(),
    resolveWorkspacePath: (props: PanelProps) => resolveCwd(ctx, sessionIdFor(props)),
  })
  const panelComponent = (attributes?: unknown): React.ReactElement =>
    React.createElement(Panel, (attributes ?? {}) as unknown as PanelProps)

  ctx.effect(() => {
    const tabs = service<SidebarRightTabsService>(ctx, 'sidebarRightTabs')
    if (tabs === undefined || typeof tabs.register !== 'function') return () => {}
    const disposeTab = tabs.register({
      id: TAB_ID,
      kind: TAB_ID,
      title: () => translate('tab.title'),
      guide: [{ order: 30, title: () => translate('tab.title'), description: () => translate('guide.description') }],
    })
    return () => disposeTab()
  }, 'dsh-vcs-timeline: tab type')

  ctx.effect(() => {
    const slots = services.slots!
    const body = slots.inject('sidebar.right.pane.tab', () => slots.register(
      { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS },
      panelComponent,
    ))
    const title = slots.inject('sidebar.right.pane.tab.title', () => slots.register(
      { name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: NS },
      () => React.createElement('span', null, translate('tab.title')),
    ))
    return () => { body(); title() }
  }, 'dsh-vcs-timeline: tab body')

  // Primary entry point: a Conversation View tab beside 对话 / 轨迹 / 上下文 /
  // 编队. Selecting it replaces the chat area with the file-centered timeline,
  // exactly like the shipped context view — no floating strip, no overlay.
  // The slot is declared by the shipped conversation UI; absence degrades to
  // "no tab" while the right-sidebar tab keeps working.
  ctx.effect(() => {
    const slots = services.slots!
    let dispose: (() => void) | undefined
    try {
      dispose = slots.inject('conversation.view', () => {
        try {
          return slots.register(
            {
              name: 'conversation.view',
              id: VIEW_ID,
              order: 40,
              locale: NS,
              label: () => translate('view.tab'),
            },
            panelComponent,
          )
        } catch {
          return () => {}
        }
      })
    } catch {
      dispose = undefined
    }
    return () => { dispose?.() }
  }, 'dsh-vcs-timeline: conversation view')
}
