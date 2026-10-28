/**
 * File hotspot statistics — pure argv builders, stream parsers and the window
 * aggregation that ranks files by churn.
 *
 * Two `git log` invocations describe exactly the same commit window: the
 * numstat stream carries the per-file line counts, the metadata stream carries
 * each commit's author, author date and parents. Nothing here performs I/O; the
 * service module runs the commands and owns the report cache.
 *
 * The window is walked newest first (the order `--date-order` prints), which is
 * what makes "last change" and "last author" exact without a second read.
 * @module dsh-vcs-timeline/host/stats/hotspots
 */

import type { FileHotspot, HotspotDay } from '../../shared/contracts.ts'
import type { NumstatEntry } from '../adapters/git/commands.ts'
import { gitBase } from '../adapters/git/commands.ts'
import { parseIsoTimestamp } from '../security.ts'

/** Most distinct authors one file row carries; the count stays exact. */
export const MAX_HOTSPOT_AUTHORS = 20

/** Largest commit window one hotspot scan may cover. */
export const MAX_HOTSPOT_COMMITS = 2_000

/** Wall-clock deadline for one history read of the scan. */
export const HOTSPOT_TIMEOUT_MS = 20_000

/** Collected-output caps for the two history reads, per stream. */
export const HOTSPOT_NUMSTAT_CAP = 8 * 1024 * 1024
export const HOTSPOT_META_CAP = 2 * 1024 * 1024

/** Field separator inside one commit record. */
const NUL = '\u0000'

/** `--format` of the metadata stream: hash, author, author date, parents. */
const META_FORMAT = '%H%x00%an%x00%aI%x00%P'

/** The window size handed to git; the caller passes its probe size. */
function windowSize(windowCommits: number): number {
  return Math.max(1, Math.trunc(windowCommits))
}

/**
 * One `git log` argv carrying the numstat record of every commit in the window.
 *
 * `-z` keeps paths raw (no quoting), `core.quotepath=false` and the UTF-8 log
 * encoding keep them readable, and `--date-order` fixes the order both streams
 * share.
 * @param windowCommits - `--max-count` of the read (the caller's probe size).
 * @returns the argv.
 */
export function hotspotNumstatArgs(windowCommits: number): string[] {
  return [
    ...gitBase(),
    'log',
    '--no-color',
    '-z',
    '--numstat',
    '--date-order',
    `--max-count=${windowSize(windowCommits)}`,
    '--format=%x01%H',
  ]
}

/**
 * One `git log` argv carrying the metadata record of every commit in the window.
 *
 * The window flags are identical to {@link hotspotNumstatArgs}, so both streams
 * describe the same commits; only the `--format` of the record differs.
 * @param windowCommits - `--max-count` of the read (the caller's probe size).
 * @returns the argv.
 */
export function hotspotMetaArgs(windowCommits: number): string[] {
  return [
    ...gitBase(),
    'log',
    '--no-color',
    '-z',
    '--date-order',
    `--max-count=${windowSize(windowCommits)}`,
    `--format=${META_FORMAT}`,
  ]
}

/** One commit record of the metadata stream. */
export interface HotspotCommitMeta {
  hash: string
  /** Author name as git printed it; empty when the stream carried none. */
  author: string
  /** Author date as ISO 8601; absent when git printed no parseable value. */
  authorDate?: string
  /**
   * Parent hashes of the commit; a root commit has none and a merge has two or
   * more. Parsed with the rest of the record so the stream framing is complete
   * and merge commits stay visible.
   */
  parents: string[]
}

/**
 * Parse `git log -z --format=%H%x00%an%x00%aI%x00%P` output.
 *
 * Each commit is four NUL-separated fields; `-z` terminates the record with NUL
 * as well, so the stream ends with an empty token. A leading newline git may
 * add between records is stripped, an empty parent field is a root commit, and
 * a malformed trailing group is dropped instead of throwing: the stream is
 * untrusted output, never an exception.
 * @param text - raw stdout of the metadata command.
 * @returns the parsed commits, newest first.
 */
export function parseHotspotMetaZ(text: string): HotspotCommitMeta[] {
  if (text === '') return []
  const tokens = text.split(NUL).map(token => token.replace(/^\r?\n+/, ''))
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop()
  const commits: HotspotCommitMeta[] = []
  for (let index = 0; index + 3 < tokens.length; index += 4) {
    const hash = (tokens[index] ?? '').trim()
    if (hash === '') continue
    const author = tokens[index + 1] ?? ''
    const authorDate = parseIsoTimestamp(tokens[index + 2] ?? '')
    const parents = (tokens[index + 3] ?? '').split(' ').filter(value => value !== '')
    commits.push({
      hash,
      author,
      ...(authorDate === null ? {} : { authorDate }),
      parents,
    })
  }
  return commits
}

/** One file's running totals while the window is walked newest first. */
interface FileAccumulator {
  path: string
  commits: number
  additions: number
  deletions: number
  /** True when at least one record reported numeric line counts. */
  lineStats: boolean
  authors: string[]
  authorSeen: Set<string>
  lastChangedAt?: string
  lastAuthor?: string
}

/** Input of one window aggregation. */
export interface AggregateHotspotsInput {
  /** Commits of the window, newest first (the metadata stream order). */
  commits: readonly HotspotCommitMeta[]
  /** Per-commit numstat records, keyed by full commit hash. */
  numstat: ReadonlyMap<string, NumstatEntry[]>
  /** Commits the window allows; the caller requested one more to detect truncation. */
  windowCommits: number
  /** Maximum rows returned, already clamped by the caller. */
  limit: number
}

/** One aggregated ranking plus the honesty facts taken from the window. */
export interface AggregateHotspotsResult {
  /** Ranked, limited rows. */
  files: FileHotspot[]
  /** Commit activity per UTC day, newest first (chart data). */
  daily: HotspotDay[]
  /** Commits actually covered by the ranking. */
  scannedCommits: number
  /** True when history extends beyond the window. */
  truncated: boolean
  /** Author date of the oldest covered commit, when git printed one. */
  since?: string
}

/**
 * Rank files by churn over one bounded commit window.
 *
 * A file that a commit reports more than once (a malformed stream) still counts
 * that commit twice; git never does that. A file whose every record is binary
 * keeps `churn: null` and no additions/deletions instead of inventing zeros.
 * @param input - window commits, numstat records, window size and row limit.
 * @returns the ranked rows plus the scanned/truncated/since facts.
 */
export function aggregateHotspots(input: AggregateHotspotsInput): AggregateHotspotsResult {
  const windowCommits = windowSize(input.windowCommits)
  const truncated = input.commits.length > windowCommits
  // The extra probe commit was requested only to detect truncation, so the
  // ranking covers exactly the window and never one commit more.
  const scanned = input.commits.slice(0, windowCommits)
  const byPath = new Map<string, FileAccumulator>()
  /** Per-UTC-day activity; a day is a real chart bucket, not an interpolation. */
  const byDay = new Map<string, { commits: number; files: Set<string>; additions: number; deletions: number; lineStats: boolean }>()

  for (const commit of scanned) {
    const entries = input.numstat.get(commit.hash)
    if (commit.authorDate !== undefined) {
      const date = commit.authorDate.slice(0, 10)
      let day = byDay.get(date)
      if (day === undefined) {
        day = { commits: 0, files: new Set<string>(), additions: 0, deletions: 0, lineStats: false }
        byDay.set(date, day)
      }
      day.commits += 1
      for (const entry of entries ?? []) {
        if (entry.path !== '') day.files.add(entry.path)
        if (entry.binary !== true) {
          day.additions += entry.additions ?? 0
          day.deletions += entry.deletions ?? 0
          day.lineStats = true
        }
      }
    }
    if (entries === undefined) continue
    for (const entry of entries) {
      const path = entry.path
      if (path === '') continue
      let accumulator = byPath.get(path)
      if (accumulator === undefined) {
        // The window is newest first, so the first commit that reports a path
        // is that file's last change; older commits never overwrite it.
        accumulator = {
          path,
          commits: 0,
          additions: 0,
          deletions: 0,
          lineStats: false,
          authors: [],
          authorSeen: new Set<string>(),
          ...(commit.authorDate === undefined ? {} : { lastChangedAt: commit.authorDate }),
          ...(commit.author === '' ? {} : { lastAuthor: commit.author }),
        }
        byPath.set(path, accumulator)
      }
      accumulator.commits += 1
      if (entry.binary !== true) {
        accumulator.additions += entry.additions ?? 0
        accumulator.deletions += entry.deletions ?? 0
        accumulator.lineStats = true
      }
      if (commit.author !== '' && !accumulator.authorSeen.has(commit.author)) {
        accumulator.authorSeen.add(commit.author)
        if (accumulator.authors.length < MAX_HOTSPOT_AUTHORS) accumulator.authors.push(commit.author)
      }
    }
  }

  const files: FileHotspot[] = []
  for (const accumulator of byPath.values()) {
    files.push({
      path: accumulator.path,
      commits: accumulator.commits,
      ...(accumulator.lineStats ? { additions: accumulator.additions, deletions: accumulator.deletions } : {}),
      churn: accumulator.lineStats ? accumulator.additions + accumulator.deletions : null,
      authors: accumulator.authors,
      authorCount: accumulator.authorSeen.size,
      ...(accumulator.lastChangedAt === undefined ? {} : { lastChangedAt: accumulator.lastChangedAt }),
      ...(accumulator.lastAuthor === undefined ? {} : { lastAuthor: accumulator.lastAuthor }),
    })
  }
  files.sort(compareHotspots)

  const daily: HotspotDay[] = [...byDay.entries()]
    .map(([date, day]) => ({
      date,
      commits: day.commits,
      files: day.files.size,
      ...(day.lineStats ? { additions: day.additions, deletions: day.deletions } : {}),
    }))
    .sort((a, b) => b.date.localeCompare(a.date))

  const oldest = scanned.length === 0 ? undefined : scanned[scanned.length - 1]?.authorDate
  return {
    files: files.slice(0, windowSize(input.limit)),
    daily,
    scannedCommits: scanned.length,
    truncated,
    ...(oldest === undefined ? {} : { since: oldest }),
  }
}

/**
 * Rank order: churn descending with unknown churn last, then commit count
 * descending, then path ascending so the order is always total and stable.
 * @param a - one row.
 * @param b - the other row.
 * @returns the comparator result.
 */
function compareHotspots(a: FileHotspot, b: FileHotspot): number {
  if (a.churn !== b.churn) {
    if (a.churn === null) return 1
    if (b.churn === null) return -1
    return b.churn - a.churn
  }
  if (a.commits !== b.commits) return b.commits - a.commits
  return a.path.localeCompare(b.path)
}
