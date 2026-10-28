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

/**
 * Localize one Host `blockedReason` sentence.
 *
 * The Host sends the precise reason as English prose (it is also the wording a
 * log reader sees), so the Client maps the known reasons to dictionary copy and
 * falls back to the raw sentence for a reason it does not recognize. It never
 * hides the reason.
 */
export function blockedReasonLabel(reason: string | undefined, t: TranslateFn): string {
  if (reason === undefined || reason.trim() === '') return t('op.blocked.generic')
  const text = reason.toLowerCase()
  if (text.includes('commit message is required')) return t('blocked.commitMessage')
  if (text.includes('message is longer than 4000')) return t('blocked.messageTooLong')
  if (text.includes('nothing is staged; there is nothing to unstage')) return t('blocked.nothingToUnstage')
  if (text.includes('nothing is staged')) return t('blocked.nothingStaged')
  if (text.includes('nothing to stage')) return t('blocked.nothingToStage')
  if (text.includes('working tree has uncommitted changes')) return t('blocked.dirtyWorktree')
  if (text.includes('no configured remote')) return t('blocked.noRemote')
  if (text.includes('has no upstream')) return t('blocked.noUpstream')
  if (text.includes('detached')) return t('blocked.detached')
  if (text.includes('only the current branch')) return t('blocked.currentBranchOnly')
  if (text.includes('unknown remote')) return t('blocked.unknownRemote')
  if (text.includes('must stay inside the repository')) return t('blocked.pathOutside')
  if (text.includes('not implemented')) return t('blocked.notImplemented')
  return reason
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

/**
 * Compact local timestamp for dense list rows: `M/D HH:mm` inside the current
 * year, `YYYY/M/D` otherwise. Returns an empty string for missing/invalid input.
 */
export function formatCompactTime(iso: string | undefined | null, locale?: string, now: Date = new Date()): string {
  if (typeof iso !== 'string' || iso.trim() === '') return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  try {
    const sameYear = date.getFullYear() === now.getFullYear()
    return new Intl.DateTimeFormat(intlLocale(locale), sameYear
      ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: 'numeric', day: 'numeric' }).format(date)
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ')
  }
}

/** Real change statistics carried in an event's metadata, when the Host knew them. */
export interface EventStats {
  /** Number of changed files; absent when the backend did not report it. */
  files?: number
  /** Added lines; absent for SVN or when stats were unavailable. */
  additions?: number
  /** Removed lines; absent for SVN or when stats were unavailable. */
  deletions?: number
  /** Binary files among the changed files, when reported. */
  binaryFiles?: number
}

/** Read the numeric stats a Host event carries; never invents a value. */
export function eventStats(event: {
  metadata?: Record<string, string | number | boolean | null>
  parentHashes?: string[]
} | null | undefined): EventStats {
  const metadata = event?.metadata
  if (metadata === undefined || metadata === null) return {}
  const number = (key: string): number | undefined => {
    const value = metadata[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
  }
  const files = number('filesChanged') ?? number('pathCount')
  const additions = number('additions')
  const deletions = number('deletions')
  const binaryFiles = number('binaryFiles')
  const merged = Array.isArray(event?.parentHashes) && (event?.parentHashes?.length ?? 0) > 1
  // `git log --numstat` prints nothing for merge commits, so all-zero stats
  // there mean "not reported", not "an empty change". Never render 0/0.
  if (merged && (files ?? 0) === 0 && (additions ?? 0) === 0 && (deletions ?? 0) === 0) return {}
  return {
    ...(files === undefined ? {} : { files }),
    ...(additions === undefined ? {} : { additions }),
    ...(deletions === undefined ? {} : { deletions }),
    ...(binaryFiles === undefined || binaryFiles === 0 ? {} : { binaryFiles }),
  }
}

/** Whether a commit event has more than one parent (a merge in Git terms). */
export function isMergeCommit(event: { parentHashes?: string[] } | null | undefined): boolean {
  return Array.isArray(event?.parentHashes) && (event?.parentHashes?.length ?? 0) > 1
}

/** Split a repository-relative path into a dimmed directory and a name. */
export function splitRepoPath(path: string | undefined | null): { dir: string; name: string } {
  if (typeof path !== 'string' || path === '') return { dir: '', name: '' }
  const index = path.lastIndexOf('/')
  if (index < 0) return { dir: '', name: path }
  return { dir: path.slice(0, index + 1), name: path.slice(index + 1) }
}

/** One rendered row of a unified diff, with optional old/new line numbers. */
export interface DiffRow {
  kind: DiffLineKind
  text: string
  oldLine: number | null
  newLine: number | null
}

/** Parse unified-diff text into rows carrying gutter line numbers. */
export function diffRows(text: string | undefined | null): DiffRow[] {
  const lines = diffLines(text)
  const rows: DiffRow[] = []
  let oldLine: number | null = null
  let newLine: number | null = null
  for (const line of lines) {
    const kind = diffLineKind(line)
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk !== null) {
      oldLine = Number.parseInt(hunk[1] ?? '0', 10)
      newLine = Number.parseInt(hunk[2] ?? '0', 10)
      rows.push({ kind, text: line, oldLine: null, newLine: null })
      continue
    }
    if (kind === 'meta') {
      rows.push({ kind, text: line, oldLine: null, newLine: null })
      continue
    }
    if (kind === 'added') {
      rows.push({ kind, text: line, oldLine: null, newLine })
      if (newLine !== null) newLine += 1
      continue
    }
    if (kind === 'removed') {
      rows.push({ kind, text: line, oldLine, newLine: null })
      if (oldLine !== null) oldLine += 1
      continue
    }
    rows.push({ kind, text: line, oldLine, newLine })
    if (oldLine !== null) oldLine += 1
    if (newLine !== null) newLine += 1
  }
  return rows
}

/** The two stats of a changed file, or nulls when the backend did not report them. */
export function fileStats(file: { additions?: number; deletions?: number }): { additions: number | null; deletions: number | null } {
  const additions = typeof file.additions === 'number' && file.additions >= 0 ? file.additions : null
  const deletions = typeof file.deletions === 'number' && file.deletions >= 0 ? file.deletions : null
  return { additions, deletions }
}

/** Whether a commit's stats carry anything worth showing. */
export function hasStats(stats: EventStats): boolean {
  return stats.files !== undefined || stats.additions !== undefined || stats.deletions !== undefined
}

/** History window presets in display order. */
export const TIME_PRESETS = ['all', '24h', '7d', '30d'] as const

/**
 * Inclusive ISO lower bound of one history window preset.
 * @param preset - `all` (no bound), `24h`, `7d` or `30d`.
 * @param now - clock used to compute the bound.
 * @returns an ISO timestamp, or undefined for "all time".
 */
export function windowSince(preset: 'all' | '24h' | '7d' | '30d', now: number = Date.now()): string | undefined {
  if (preset === 'all') return undefined
  const hours = preset === '24h' ? 24 : preset === '7d' ? 24 * 7 : 24 * 30
  return new Date(now - hours * 60 * 60 * 1000).toISOString()
}

/**
 * Display label of one history window preset.
 * @param preset - the preset.
 * @param t - dictionary lookup.
 * @returns the localized label.
 */
export function timePresetLabel(preset: 'all' | '24h' | '7d' | '30d', t: TranslateFn): string {
  return t(`time.${preset}`)
}

/** Width of one tree indentation step, in px (pure layout arithmetic for tests). */
export function treeIndent(depth: number): number {
  return Number.isFinite(depth) && depth > 0 ? depth * 12 : 0
}

/** Coarse relative age of a timestamp, for the timeline's "when". */
export type RelativeTimeUnit = 'justNow' | 'minutes' | 'hours' | 'days'

/** Relative age of one timestamp: unit plus count (count is 0 for `justNow`). */
export interface RelativeTime {
  unit: RelativeTimeUnit
  count: number
}

/**
 * Coarse relative age used by timeline rows: "just now", "N minutes ago",
 * "N hours ago", "N days ago"; anything older returns null so the row shows a
 * compact date instead of an ever-growing count.
 * @param iso - ISO timestamp.
 * @param now - clock used for the comparison.
 * @returns the relative age, or null when older than seven days/invalid.
 */
export function relativeTime(iso: string | undefined | null, now: number = Date.now()): RelativeTime | null {
  if (typeof iso !== 'string' || iso.trim() === '') return null
  const at = new Date(iso).getTime()
  if (!Number.isFinite(at) || !Number.isFinite(now)) return null
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  if (seconds < 60) return { unit: 'justNow', count: 0 }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return { unit: 'minutes', count: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { unit: 'hours', count: hours }
  const days = Math.floor(hours / 24)
  if (days < 7) return { unit: 'days', count: days }
  return null
}

/** Local calendar key of one ISO timestamp: `YYYY-MM-DD`, or null when invalid. */
export function localDayKey(iso: string | undefined | null): string | null {
  if (typeof iso !== 'string' || iso.trim() === '') return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Header label of one timeline day: localized today/yesterday or a date. */
export interface DayLabel {
  kind: 'today' | 'yesterday' | 'date'
  /** Formatted date for `kind === 'date'`; empty otherwise. */
  text: string
}

/**
 * Day header label of one timestamp.
 * @param iso - ISO timestamp.
 * @param locale - display locale.
 * @param now - clock used to decide today/yesterday.
 * @returns the header label, falling back to a plain date.
 */
export function dayLabel(iso: string | undefined | null, locale?: string, now: Date = new Date()): DayLabel {
  const key = localDayKey(iso)
  if (key === null) return { kind: 'date', text: '' }
  const today = localDayKey(now.toISOString())
  const yesterday = localDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
  if (key === today) return { kind: 'today', text: '' }
  if (key === yesterday) return { kind: 'yesterday', text: '' }
  const date = new Date(iso as string)
  const sameYear = date.getFullYear() === now.getFullYear()
  try {
    return {
      kind: 'date',
      text: new Intl.DateTimeFormat(intlLocale(locale), {
        ...(sameYear ? {} : { year: 'numeric' }),
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
      }).format(date),
    }
  } catch {
    return { kind: 'date', text: key }
  }
}

/** Stable decorative avatar label: the first character(s) of an author name. */
export function authorInitials(actor: string | undefined | null): string {
  if (typeof actor !== 'string') return '?'
  const trimmed = actor.trim()
  if (trimmed === '') return '?'
  const parts = trimmed.split(/\s+/).filter((part) => part !== '')
  if (parts.length === 0) return '?'
  const first = parts[0] ?? trimmed
  const second = parts.length > 1 ? parts[parts.length - 1] ?? '' : ''
  const initials = second === '' ? first.slice(0, 1) : `${first.slice(0, 1)}${second.slice(0, 1)}`
  return initials.toUpperCase()
}

/**
 * Deterministic hue for the decorative author avatar, derived from the name so
 * one person keeps one color across rows and sessions.
 * @param actor - author name.
 * @returns a hue in degrees (0–359).
 */
export function authorHue(actor: string | undefined | null): number {
  const text = typeof actor === 'string' && actor !== '' ? actor : '?'
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0
  }
  return Math.abs(hash) % 360
}

