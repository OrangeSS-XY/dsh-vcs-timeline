/**
 * dsh-vcs-timeline — file-centered change index.
 *
 * The dual-pane browser is derived, never stored: both the left file tree and
 * the right change timeline are pure functions of the loaded repository
 * history page. That is what keeps the two panes on one filter state — a
 * commit row can never list a file the tree hides, and a directory count can
 * never disagree with the rows below it.
 *
 * Everything here is a pure function over contract values: no React, no
 * network, no clock. `client.fileindex.test.ts` pins the rules.
 * @module dsh-vcs-timeline/client/file-index
 */

import type { ChangedFile, FileChangeStatus, VcsEvent } from '../shared/contracts.ts'
import { localDayKey } from './format.ts'

/** One repository-relative file aggregated across the loaded history window. */
export interface FileChangeEntry {
  /** Repository-relative path using `/`. */
  path: string
  /** Previous path, taken from the most recent rename/copy. */
  oldPath?: string
  /** Status in the most recent commit that touched the path. */
  status: FileChangeStatus
  /** How many loaded commits touched the path. */
  changes: number
  /** Sum of the reported additions across those commits. */
  additions: number
  /** Sum of the reported deletions across those commits. */
  deletions: number
  /** True when any change reported the file as binary. */
  binary: boolean
  /** Id of the most recent event that touched the path. */
  lastEventId: string
  /** Timestamp of that event. */
  lastTimestamp: string
  /** Summary of that event. */
  lastSummary: string
  /** Author of that event, when the history reported one. */
  lastActor?: string
}

/** A file leaf of the repository tree. */
export interface FileTreeFile {
  kind: 'file'
  name: string
  path: string
  entry: FileChangeEntry
}

/** A directory node of the repository tree. */
export interface FileTreeDir {
  kind: 'dir'
  name: string
  path: string
  /** Number of filtered files below this directory. */
  count: number
  children: FileTreeNode[]
}

/** One node of the repository tree. */
export type FileTreeNode = FileTreeDir | FileTreeFile

/** Client-side tree filters (they never leave the browser). */
export interface FileViewFilters {
  /** File-name / path search text. */
  query: string
  /** `'all'` or one exact change status. */
  status: FileChangeStatus | 'all'
  /** Currently selected file path, if any. */
  selectedPath: string | null
}

/** Everything both panes need, derived from one loaded history page. */
export interface TimelineView {
  /**
   * `true` when at least one event carried a file list. A Host that was not
   * asked (or an older Host) reports nothing, and the tree says so instead of
   * pretending the repository has no changed files.
   */
  filesReported: boolean
  /** Files aggregated from every loaded commit, newest change first. */
  files: FileChangeEntry[]
  /** Files surviving the tree filters. */
  visibleFiles: FileChangeEntry[]
  /** Tree built from the visible files only. */
  tree: FileTreeNode[]
  /** Commit rows the right pane lists under the same filters. */
  visibleEvents: VcsEvent[]
  /** Selected file entry, when it is still visible. */
  selected: FileChangeEntry | null
  /** Totals over the visible files (never invented: zero when none). */
  totals: { files: number; commits: number; additions: number; deletions: number }
}

/** The file list a commit reported, or null when the Host did not report one. */
export function eventFiles(event: VcsEvent | null | undefined): ChangedFile[] | null {
  if (event === null || event === undefined) return null
  return Array.isArray(event.changedFiles) ? event.changedFiles : null
}

/** Whether the loaded page carries file lists at all. */
export function reportsFiles(events: readonly VcsEvent[]): boolean {
  return events.some((event) => Array.isArray(event.changedFiles))
}

/** Read the numeric part of one changed file, or `undefined` when unreported. */
function reportedNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Aggregate per-commit file lists into one entry per repository path.
 *
 * Events are newest first, so the first time a path is seen wins its status,
 * rename source and "last change" metadata. Line counts are summed only from
 * the values the Host actually reported.
 * @param events - history page, newest first.
 * @returns one entry per path, ordered by most recent change.
 */
export function aggregateChangedFiles(events: readonly VcsEvent[]): FileChangeEntry[] {
  const byPath = new Map<string, FileChangeEntry>()
  for (const event of events) {
    const files = eventFiles(event)
    if (files === null) continue
    for (const file of files) {
      const path = typeof file.path === 'string' ? file.path : ''
      if (path === '') continue
      const additions = reportedNumber(file.additions)
      const deletions = reportedNumber(file.deletions)
      const known = byPath.get(path)
      if (known === undefined) {
        byPath.set(path, {
          path,
          ...(typeof file.oldPath === 'string' && file.oldPath !== '' && file.oldPath !== path
            ? { oldPath: file.oldPath }
            : {}),
          status: file.status,
          changes: 1,
          additions: additions ?? 0,
          deletions: deletions ?? 0,
          binary: file.binary === true,
          lastEventId: event.id,
          lastTimestamp: event.timestamp,
          lastSummary: event.summary,
          ...(typeof event.actor === 'string' && event.actor !== '' ? { lastActor: event.actor } : {}),
        })
        continue
      }
      known.changes += 1
      known.additions += additions ?? 0
      known.deletions += deletions ?? 0
      known.binary = known.binary || file.binary === true
    }
  }
  return [...byPath.values()]
}

/** Count files per status plus the total, for the tree header chips. */
export function statusCounts(entries: readonly FileChangeEntry[]): {
  all: number
  added: number
  modified: number
  deleted: number
  renamed: number
} {
  const counts = { all: entries.length, added: 0, modified: 0, deleted: 0, renamed: 0 }
  for (const entry of entries) {
    switch (entry.status) {
      case 'added':
        counts.added += 1
        break
      case 'modified':
        counts.modified += 1
        break
      case 'deleted':
        counts.deleted += 1
        break
      case 'renamed':
      case 'copied':
        counts.renamed += 1
        break
      default:
        break
    }
  }
  return counts
}

/**
 * Apply the tree's own search and status filters.
 *
 * The search is case-insensitive and matches the full repository path, so
 * typing `client/ui` narrows to a directory while `panel.ts` narrows to files
 * whose name matches.
 * @param entries - aggregated files.
 * @param query - raw search text.
 * @param status - `'all'` or one exact status.
 * @returns the surviving entries in their original (newest-first) order.
 */
export function filterFileEntries(
  entries: readonly FileChangeEntry[],
  query: string,
  status: FileChangeStatus | 'all',
): FileChangeEntry[] {
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
  return entries.filter((entry) => {
    if (status !== 'all' && entry.status !== status) return false
    if (needle === '') return true
    return entry.path.toLowerCase().includes(needle)
      || (entry.oldPath !== undefined && entry.oldPath.toLowerCase().includes(needle))
  })
}

/** Compare two tree nodes: directories first, then case-insensitive name. */
function compareNodes(left: FileTreeNode, right: FileTreeNode): number {
  if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true })
}

/** Insert one file under its directory chain, creating directories as needed. */
function insertFile(roots: FileTreeNode[], entry: FileChangeEntry): void {
  const segments = entry.path.split('/').filter((segment) => segment !== '')
  const name = segments[segments.length - 1] ?? entry.path
  let level = roots
  let path = ''
  for (const segment of segments.slice(0, -1)) {
    path = path === '' ? segment : `${path}/${segment}`
    const existing = level.find((node) => node.kind === 'dir' && node.path === path)
    if (existing !== undefined && existing.kind === 'dir') {
      existing.count += 1
      level = existing.children
      continue
    }
    const dir: FileTreeDir = { kind: 'dir', name: segment, path, count: 1, children: [] }
    level.push(dir)
    level = dir.children
  }
  level.push({ kind: 'file', name, path: entry.path, entry })
}

/**
 * Build the sorted repository tree from the filtered file entries.
 * @param entries - filtered files.
 * @returns root nodes, each already sorted recursively.
 */
export function buildFileTree(entries: readonly FileChangeEntry[]): FileTreeNode[] {
  const roots: FileTreeNode[] = []
  for (const entry of entries) insertFile(roots, entry)
  const sortLevel = (nodes: FileTreeNode[]): void => {
    nodes.sort(compareNodes)
    for (const node of nodes) if (node.kind === 'dir') sortLevel(node.children)
    // Directory counts are maintained on insert, before sorting; nothing to do.
  }
  sortLevel(roots)
  return roots
}

/** The most recent change of one path inside one commit, or null. */
export function eventFileStatus(event: VcsEvent, path: string): ChangedFile | null {
  const files = eventFiles(event)
  if (files === null) return null
  return files.find((file) => file.path === path) ?? null
}

/** Commit rows that touched one exact path, newest first. */
export function eventsForFile(events: readonly VcsEvent[], path: string): VcsEvent[] {
  return events.filter((event) => {
    const files = eventFiles(event)
    return files !== null && files.some((file) => file.path === path)
  })
}

/** Commit rows that touched at least one of the visible paths. */
export function eventsHavingFiles(events: readonly VcsEvent[], paths: ReadonlySet<string>): VcsEvent[] {
  if (paths.size === 0) return []
  return events.filter((event) => {
    const files = eventFiles(event)
    return files !== null && files.some((file) => paths.has(file.path))
  })
}

/** Every directory path of a tree, in document order (for tests/debugging). */
export function directoryPaths(nodes: readonly FileTreeNode[]): string[] {
  const paths: string[] = []
  const walk = (level: readonly FileTreeNode[]): void => {
    for (const node of level) {
      if (node.kind !== 'dir') continue
      paths.push(node.path)
      walk(node.children)
    }
  }
  walk(nodes)
  return paths
}

/**
 * One calendar day of the timeline, newest first.
 */
export interface DayGroup {
  /** Local calendar key, `YYYY-MM-DD`. */
  key: string
  /** Newest event's timestamp in this group. */
  timestamp: string
  /** Events of the day, newest first. */
  events: VcsEvent[]
}

/** Local calendar key of one event timestamp, or its timestamp when invalid. */
function dayKeyOf(timestamp: string): string {
  return localDayKey(timestamp) ?? timestamp
}

/**
 * Group one loaded history page into calendar days for the timeline headers.
 *
 * Events arrive newest first, so groups keep that order and every event stays
 * inside exactly one group (nothing is re-sorted or dropped).
 * @param events - history page, newest first.
 * @returns day groups, newest day first.
 */
export function groupEventsByDay(events: readonly VcsEvent[]): DayGroup[] {
  const groups: DayGroup[] = []
  let current: DayGroup | null = null
  for (const event of events) {
    const key = dayKeyOf(event.timestamp)
    if (current === null || current.key !== key) {
      current = { key, timestamp: event.timestamp, events: [] }
      groups.push(current)
    }
    current.events.push(event)
  }
  return groups
}

/**
 * Derive both panes from one loaded history page.
 *
 * The selected file filters the right pane; the tree search and status filter
 * filter both panes from the same list. When the Host did not attach file
 * lists, `filesReported` is false and every event stays visible so the panel
 * can explain the limitation instead of showing an empty tree.
 * @param events - loaded history page, newest first.
 * @param filters - tree search/status and the selected path.
 * @returns the derived tree, rows and totals.
 */
export function buildTimelineView(events: readonly VcsEvent[], filters: FileViewFilters): TimelineView {
  const filesReported = reportsFiles(events)
  const files = aggregateChangedFiles(events)
  const visibleFiles = filterFileEntries(files, filters.query, filters.status)
  const tree = buildFileTree(visibleFiles)
  const selected = filters.selectedPath === null
    ? null
    : visibleFiles.find((entry) => entry.path === filters.selectedPath) ?? null

  let visibleEvents: VcsEvent[]
  if (!filesReported) visibleEvents = [...events]
  else if (filters.selectedPath !== null) {
    visibleEvents = eventsForFile(events, filters.selectedPath)
  } else if (filters.query.trim() !== '' || filters.status !== 'all') {
    visibleEvents = eventsHavingFiles(events, new Set(visibleFiles.map((entry) => entry.path)))
  } else {
    visibleEvents = [...events]
  }

  let additions = 0
  let deletions = 0
  for (const entry of visibleFiles) {
    additions += entry.additions
    deletions += entry.deletions
  }

  return {
    filesReported,
    files,
    visibleFiles,
    tree,
    visibleEvents,
    selected,
    totals: { files: visibleFiles.length, commits: visibleEvents.length, additions, deletions },
  }
}
