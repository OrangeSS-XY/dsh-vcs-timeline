/**
 * dsh-vcs-timeline — pure client formatting helpers.
 *
 * Everything here is a pure function over contract values so the panel views
 * stay declarative and the rules are unit-testable without a DOM. No helper
 * reads state, timers, or the network.
 * @module dsh-vcs-timeline/client/format
 */

import type {
  ApiError,
  EventSource,
  FileChangeStatus,
  OperationState,
  OperationType,
  VcsEventType,
} from '../shared/contracts.ts'
import type { TranslateFn } from './i18n.ts'

/** Classified kind of one line of unified diff text. */
export type DiffLineKind = 'added' | 'removed' | 'hunk' | 'meta' | 'context'

/** Locale tag used for absolute time formatting. */
function intlLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN'
}

/** Format an ISO timestamp as local time via `Intl.DateTimeFormat`. */
export function formatTime(iso: string | undefined | null, locale?: string): string {
  if (typeof iso !== 'string' || iso.trim() === '') return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

/** Shorten a hash/revision for display; falsy input becomes an empty string. */
export function shortHash(value: string | undefined | null, length = 7): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed === '' || !Number.isFinite(length) || length <= 0) return ''
  return trimmed.length <= length ? trimmed : trimmed.slice(0, length)
}

/** Format a byte count with binary units; invalid input becomes an empty string. */
export function formatBytes(bytes: number | undefined | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const unit = units[index] ?? 'TB'
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${unit}`
}

/** Collapse whitespace and clip text to one line with an ellipsis. */
export function truncate(text: string | undefined | null, max = 120): string {
  if (typeof text !== 'string') return ''
  const single = text.replace(/\s+/g, ' ').trim()
  if (max <= 0 || single.length <= max) return single
  return `${single.slice(0, Math.max(1, max - 1)).trimEnd()}…`
}

/** Single-letter status marker used by the changed-file list. */
export function statusLetter(status: FileChangeStatus): string {
  switch (status) {
    case 'added':
      return 'A'
    case 'modified':
      return 'M'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'copied':
      return 'C'
    case 'type-changed':
      return 'T'
    default:
      return '?'
  }
}

/** Localized changed-file status label. */
export function statusLabel(status: FileChangeStatus, t: TranslateFn): string {
  return t(`file.status.${status}`)
}

/** Localized event-type label. */
export function eventTypeLabel(eventType: VcsEventType, t: TranslateFn): string {
  return t(`event.${eventType}`)
}

/** Glyph for a timeline event type (decorative; the row also has text). */
export function typeGlyph(eventType: VcsEventType): string {
  switch (eventType) {
    case 'commit':
      return '●'
    case 'push':
      return '↑'
    case 'fetch':
      return '↓'
    case 'pull':
      return '⇣'
    case 'update':
      return '↻'
    case 'merge':
      return '⋈'
    case 'rebase':
      return '⤶'
    case 'branch':
      return '⑂'
    case 'tag':
      return '⚑'
    case 'switch':
      return '⇄'
    default:
      return '•'
  }
}

/** Localized source badge label; repository facts and audit facts stay distinct. */
export function sourceLabel(source: EventSource, t: TranslateFn): string {
  return t(`source.${source}.badge`)
}

/** Classify one unified-diff line for coloring. */
export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (
    line.startsWith('diff ')
    || line.startsWith('index ')
    || line.startsWith('new file')
    || line.startsWith('deleted file')
    || line.startsWith('old mode')
    || line.startsWith('new mode')
    || line.startsWith('similarity index')
    || line.startsWith('rename from')
    || line.startsWith('rename to')
    || line.startsWith('Binary files')
    || line.startsWith('\\ No newline')
  ) {
    return 'meta'
  }
  if (line.startsWith('+')) return 'added'
  if (line.startsWith('-')) return 'removed'
  return 'context'
}

/** Split diff text into display lines without inventing or dropping content. */
export function diffLines(text: string | undefined | null): string[] {
  if (typeof text !== 'string' || text === '') return []
  const normalized = text.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Localized operation label (audit rows and dialogs). */
export function operationLabel(operation: OperationType, t: TranslateFn): string {
  return t(`op.label.${operation}`)
}

/** Localized operation lifecycle label. */
export function operationStateLabel(state: OperationState, t: TranslateFn): string {
  return t(`op.state.${state}`)
}

/** Localized remote outcome label. */
export function remoteOutcomeLabel(
  outcome: 'confirmed-success' | 'confirmed-failure' | 'unknown' | undefined,
  t: TranslateFn,
): string {
  if (outcome === undefined) return ''
  return t(`audit.remote.${outcome}`)
}

/** Dictionary key of a stable API error code, for localized rendering. */
export function apiErrorKey(error: ApiError | null | undefined): string {
  if (error === null || error === undefined || typeof error.code !== 'string') return 'error.generic'
  return `error.${error.code}`
}

/** Localized sentence explaining cause, impact, and next action for one error. */
export function errorMessage(error: ApiError | null | undefined, t: TranslateFn): string {
  if (error === null || error === undefined) return t('error.generic')
  const key = apiErrorKey(error)
  const message = t(key)
  return message === key ? t('error.generic') : message
}

/** Compose the display label of one repository picker option. */
export function repositoryOptionLabel(repository: {
  vcsType: 'git' | 'svn'
  displayName: string
  currentBranch?: string
  currentRevision?: string
  defaultBranch?: string
}): string {
  const vcs = repository.vcsType === 'git' ? 'Git' : 'SVN'
  const hint = repository.currentBranch ?? repository.defaultBranch ?? shortHash(repository.currentRevision, 8)
  const base = `${vcs} · ${repository.displayName}`
  return hint === undefined || hint === '' ? base : `${base} — ${hint}`
}

/** Count of staged entries, used by the commit dialog. */
export function stagedCount(entries: readonly { staged?: boolean }[] | undefined): number {
  if (!Array.isArray(entries)) return 0
  return entries.filter((entry) => entry.staged === true).length
}

/** Join changed paths into one bounded summary line. */
export function pathsSummary(paths: readonly string[] | undefined, max = 3): string {
  if (!Array.isArray(paths) || paths.length === 0) return ''
  const head = paths.slice(0, max).join(', ')
  return paths.length > max ? `${head} …` : head
}

/** Class name suffix accepted by the stylesheet for one diff line kind. */
export function diffLineClassName(kind: DiffLineKind): string {
  return `dvt-diff-line dvt-diff-${kind}`
}
