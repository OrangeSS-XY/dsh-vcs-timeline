/**
 * JSONL implementation of {@link TimelineStore}.
 *
 * Design notes
 * ------------
 * - **Append-only.** Every record is one JSON object on one line, always
 *   stamped with `schemaVersion`. Readers fold lifecycle records by id; they
 *   never rewrite history.
 * - **Per-file write queue.** Appends to a given file are chained through one
 *   promise, so concurrent callers can never interleave partial lines. A
 *   failed append rejects the caller with {@link StoreError} while the queue
 *   itself stays usable (the chain records a recovered promise).
 * - **Line index.** Each file keeps an in-process index of
 *   `{ offset, length, time }` entries, built once by streaming the file and
 *   scanning for newline bytes, then reused for every page. The index is
 *   invalidated when the file's size/mtime changes or after a write, so a page
 *   never re-parses the whole file: only the lines it actually returns are
 *   read and `JSON.parse`d.
 * - **Corruption tolerance.** Blank lines are ignored. Lines that fail
 *   `JSON.parse`, fail the record guard, or were cut off mid-write are skipped
 *   and reported as one summary warning per query. A trailing partial line
 *   (no newline yet) is likewise skipped, and the next append first writes a
 *   newline so the damaged fragment cannot swallow the new record.
 * - **Rotation.** Before an append, a file larger than `maxFileBytes`
 *   (default 32 MiB) is renamed to `<name>.1.jsonl` (single generation,
 *   best effort). Rotation failures never fail the append; the append fails
 *   only if the append itself fails. Rotated generations are archival: queries
 *   read the current generation only.
 * - **Schema versions.** A line whose `schemaVersion` is not
 *   {@link SCHEMA_VERSION} is ignored and counted in the page warning. The
 *   {@link JsonlTimelineStore.migrate} method is the documented seam for a
 *   future rewrite-based migration.
 * - **No secrets.** Operation summaries are passed through
 *   `redactText` before they touch disk.
 *
 * Warnings channel: `queryEvents`/`queryOperations` pages carry warnings.
 * `listRepositories`/`getRepository` have no warnings field in the frozen
 * contract, so skipped lines are dropped silently there.
 * @module dsh-vcs-timeline/host/storage/jsonl
 */

import type { Stats } from 'node:fs'
import { appendFile, mkdir, open, rename, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SCHEMA_VERSION,
  isOperationAttempt,
  isRepository,
} from '../../shared/contracts.ts'
import type {
  ChangeSet,
  OperationAttempt,
  OperationPage,
  OperationQuery,
  Repository,
  TimelinePage,
  TimelineQuery,
  VcsEvent,
} from '../../shared/contracts.ts'
import { clampInt, decodeCursor, encodeCursor, redactText } from '../security.ts'
import type { TimelineStore } from './interface.ts'
import { StoreError } from './interface.ts'

/** Default rotation threshold: 32 MiB per file. */
export const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024

/** Default cap on lines examined by a single query. */
export const DEFAULT_MAX_SCAN_RECORDS = 200_000

/** Stream read size while building a line index. */
const READ_CHUNK_BYTES = 64 * 1024

/** A line longer than this is treated as corruption instead of being loaded. */
const MAX_LINE_BYTES = 8 * 1024 * 1024

/** Summary length caps shared with the audit writer. */
const REQUEST_SUMMARY_MAX = 500
const OUTPUT_SUMMARY_MAX = 2000
const SAFE_ERROR_MAX = 500

/** Options accepted by {@link createJsonlStore}. */
export interface JsonlStoreOptions {
  /** Store directory; created lazily. Relative paths resolve against `process.cwd()`. */
  dir: string
  /** Rotate a file that already exceeds this many bytes (default 32 MiB). */
  maxFileBytes?: number
  /** Stop scanning after this many lines per query (default 200 000). */
  maxScanRecords?: number
}

/** Migration context handed to {@link JsonlTimelineStore.migrate}. */
export interface JsonlMigrationContext {
  /** Store directory the migration applies to. */
  dir: string
  /** Schema version found on disk. */
  fromVersion: number
  /** Schema version to migrate to. */
  toVersion: number
}

/**
 * {@link TimelineStore} plus the documented migration seam.
 *
 * The Host may ignore `migrate`; it exists so a future schema bump has one
 * obvious place to rewrite generations instead of accreting ad-hoc fixes.
 */
export interface JsonlTimelineStore extends TimelineStore {
  /**
   * Rewrite the store from `context.fromVersion` to `context.toVersion`.
   *
   * Currently a no-op because {@link SCHEMA_VERSION} is 1. When the version
   * increases, implement it as: read each generation line by line, transform
   * recognised records, write to `<name>.migrating.tmp`, then `rename` over the
   * original. Never mutate the only copy in place.
   */
  migrate(context: JsonlMigrationContext): Promise<void>
}

/** File names inside the store directory. */
const FILE_NAMES = {
  repositories: 'repositories.jsonl',
  events: 'events.jsonl',
  changesets: 'changesets.jsonl',
  operations: 'operations.jsonl',
} as const

type FileKey = keyof typeof FILE_NAMES

/** The record field each file sorts on, extracted at index-build time. */
const TIME_FIELDS: Record<FileKey, string> = {
  repositories: 'lastSeenAt',
  events: 'timestamp',
  changesets: 'createdAt',
  operations: 'startedAt',
}

/** One indexed line: byte window plus the extracted sort timestamp. */
interface LineEntry {
  offset: number
  length: number
  time: string | null
}

/** In-process line index for one file generation. */
interface FileIndex {
  size: number
  mtimeMs: number
  /** Every line in file order. */
  entries: LineEntry[]
  /** Indices into `entries`, newest first by timestamp then file order. */
  order: number[]
}

/** Parsed line classification. */
type ParsedLine =
  | { kind: 'record'; value: Record<string, unknown> }
  | { kind: 'unreadable' }
  | { kind: 'unsupported' }

/** Per-process line indexes keyed by absolute file path. */
const indexCache = new Map<string, FileIndex>()

/** Last known newline-terminated file sizes, per absolute path. */
const verifiedEnds = new Map<string, number>()

/** Statistics collected while scanning lines for one query. */
interface ScanStats {
  unreadable: number
  unsupported: number
  capped: boolean
}

/** Build a timestamp needle/pattern pair for one file. */
function timeNeedle(field: string): Buffer {
  return Buffer.from(`"${field}"`, 'latin1')
}

/** Extract the sort timestamp from one line without parsing the whole object. */
function extractTime(line: Buffer, needle: Buffer, pattern: RegExp): string | null {
  const at = line.indexOf(needle)
  if (at === -1) return null
  const end = Math.min(line.length, at + needle.length + 80)
  const match = pattern.exec(line.subarray(at, end).toString('latin1'))
  return match?.[1] ?? null
}

/** Whether `error` is a Node error with the given code. */
function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** Build a secret-free {@link StoreError}. */
function toStoreError(action: string, error: unknown): StoreError {
  if (error instanceof Error && error instanceof StoreError) return error
  const code = errorCode(error)
  const message = error instanceof Error ? error.message : String(error)
  const detail = redactText(message)
    .replace(/'[^']*'/g, "'…'")
    .replace(/\s+/g, ' ')
    .trim()
  const suffix = code === undefined ? '' : ` (${code})`
  return new StoreError(`jsonl store: ${action} failed${suffix}: ${detail.slice(0, 200)}`, 'storage-failure')
}

/** Truncate (and redact) one bounded field. */
function boundedText(raw: string, max: number): string {
  const redacted = redactText(raw)
  return redacted.length > max ? `${redacted.slice(0, max - 1)}…` : redacted
}

/** Parse one line: JSON object, schema version, then the caller's guard. */
function parseStoredLine(text: string): ParsedLine {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { kind: 'unreadable' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { kind: 'unreadable' }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== SCHEMA_VERSION) return { kind: 'unsupported' }
  return { kind: 'record', value: record }
}

/** Runtime guard for {@link VcsEvent}. */
function isVcsEvent(value: unknown): value is VcsEvent {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === SCHEMA_VERSION
    && typeof record.id === 'string'
    && typeof record.repositoryId === 'string'
    && typeof record.eventType === 'string'
    && typeof record.timestamp === 'string'
    && typeof record.summary === 'string'
}

/** Append the one summary warning allowed for skipped lines. */
function appendSkipWarning(warnings: string[], fileName: string, stats: ScanStats): void {
  const parts: string[] = []
  if (stats.unreadable > 0) parts.push(`${stats.unreadable} unreadable`)
  if (stats.unsupported > 0) parts.push(`${stats.unsupported} incompatible-schema`)
  if (parts.length > 0) warnings.push(`skipped ${parts.join(' / ')} record(s) in ${fileName}`)
  if (stats.capped) warnings.push(`stopped scanning ${fileName} after the scan cap; results may be incomplete`)
}

/** Parse an opaque cursor into a non-negative offset. */
function readCursorOffset(cursor: unknown, warnings: string[]): number {
  if (cursor === null || cursor === undefined) return 0
  const decoded = decodeCursor(cursor)
  if (decoded === null) {
    warnings.push('ignored a malformed pagination cursor')
    return 0
  }
  const raw = decoded['o']
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    warnings.push('ignored a malformed pagination cursor')
    return 0
  }
  return raw
}

/** Milliseconds for an ISO timestamp, or null when absent/invalid. */
function toMillis(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/** Lower-cased substring filter, or null when absent/blank. */
function filterText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed.toLowerCase()
}

/** Normalised event filter. */
interface EventFilter {
  repositoryId: string
  eventTypes: Set<string> | null
  author: string | null
  text: string | null
  sinceMs: number | null
  untilMs: number | null
}

/** Build the normalised filter for one timeline query. */
function buildEventFilter(query: TimelineQuery, repositoryId: string): EventFilter {
  // The wire contract says `VcsEventType[]`; validate at runtime anyway, since
  // queries cross the Host boundary.
  const requestedTypes: unknown[] = Array.isArray(query.eventTypes) ? query.eventTypes as unknown[] : []
  const requested = requestedTypes.filter((value): value is string => typeof value === 'string' && value !== '')
  return {
    repositoryId,
    eventTypes: requested.length > 0 ? new Set(requested) : null,
    author: filterText(query.author),
    text: filterText(query.text),
    sinceMs: toMillis(query.since),
    untilMs: toMillis(query.until),
  }
}

/** Whether one event passes the query filter. */
function matchesEventFilter(event: VcsEvent, filter: EventFilter): boolean {
  if (event.repositoryId !== filter.repositoryId) return false
  if (filter.eventTypes !== null && !filter.eventTypes.has(event.eventType)) return false
  if (filter.author !== null) {
    const actor = typeof event.actor === 'string' ? event.actor.toLowerCase() : ''
    if (!actor.includes(filter.author)) return false
  }
  if (filter.text !== null) {
    const summary = typeof event.summary === 'string' ? event.summary.toLowerCase() : ''
    if (!summary.includes(filter.text)) return false
  }
  if (filter.sinceMs !== null || filter.untilMs !== null) {
    const stamp = typeof event.timestamp === 'string' ? Date.parse(event.timestamp) : Number.NaN
    if (Number.isNaN(stamp)) return false
    if (filter.sinceMs !== null && stamp < filter.sinceMs) return false
    if (filter.untilMs !== null && stamp > filter.untilMs) return false
  }
  return true
}

/** Fold repository snapshots to the latest one per id, newest lastSeenAt first. */
function foldRepositories(records: Repository[]): Repository[] {
  const byId = new Map<string, { record: Repository; order: number }>()
  records.forEach((record, order) => {
    const existing = byId.get(record.id)
    if (existing === undefined) {
      byId.set(record.id, { record, order })
      return
    }
    const existingAt = toMillis(existing.record.lastSeenAt)
    const recordAt = toMillis(record.lastSeenAt)
    if (recordAt !== null && existingAt !== null && recordAt < existingAt) return
    byId.set(record.id, { record, order })
  })
  const folded = [...byId.values()]
  folded.sort((left, right) => {
    const leftAt = toMillis(left.record.lastSeenAt)
    const rightAt = toMillis(right.record.lastSeenAt)
    const leftValue = leftAt === null ? Number.NEGATIVE_INFINITY : leftAt
    const rightValue = rightAt === null ? Number.NEGATIVE_INFINITY : rightAt
    if (leftValue !== rightValue) return rightValue - leftValue
    return right.order - left.order
  })
  return folded.map(entry => entry.record)
}

/** One folded operation attempt with the file order of its terminal record. */
interface FoldedOperation {
  attempt: OperationAttempt
  order: number
}

/** Fold append-only operation records: last state wins, first startedAt kept. */
function foldOperations(records: OperationAttempt[]): FoldedOperation[] {
  const byId = new Map<string, FoldedOperation>()
  records.forEach((record, order) => {
    const existing = byId.get(record.id)
    if (existing === undefined) {
      byId.set(record.id, { attempt: record, order })
      return
    }
    byId.set(record.id, { attempt: { ...record, startedAt: existing.attempt.startedAt }, order })
  })
  const folded = [...byId.values()]
  folded.sort((left, right) => {
    const leftAt = toMillis(left.attempt.startedAt)
    const rightAt = toMillis(right.attempt.startedAt)
    const leftValue = leftAt === null ? Number.NEGATIVE_INFINITY : leftAt
    const rightValue = rightAt === null ? Number.NEGATIVE_INFINITY : rightAt
    if (leftValue !== rightValue) return rightValue - leftValue
    return right.order - left.order
  })
  return folded
}

/** Redact and bound the operation fields the store is responsible for. */
function prepareOperationRecord(record: OperationAttempt): Record<string, unknown> {
  const output: Record<string, unknown> = { ...record, schemaVersion: SCHEMA_VERSION }
  output.requestSummary = boundedText(typeof record.requestSummary === 'string' ? record.requestSummary : '', REQUEST_SUMMARY_MAX)
  if (typeof record.outputSummary === 'string') {
    output.outputSummary = boundedText(record.outputSummary, OUTPUT_SUMMARY_MAX)
  }
  if (typeof record.safeErrorMessage === 'string') {
    output.safeErrorMessage = boundedText(record.safeErrorMessage, SAFE_ERROR_MAX)
  }
  return output
}

/**
 * Create the JSONL-backed store.
 *
 * @param options - store directory plus optional guard rails.
 * @returns the store, including the {@link JsonlTimelineStore.migrate} seam.
 * @throws {StoreError} when the options are unusable.
 */
export function createJsonlStore(options: JsonlStoreOptions): JsonlTimelineStore {
  const rawDir = typeof options === 'object' && options !== null && typeof options.dir === 'string'
    ? options.dir.trim()
    : ''
  if (rawDir === '') throw new StoreError('jsonl store: options.dir is required', 'storage-failure')
  const dir = resolve(rawDir)
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  if (typeof maxFileBytes !== 'number' || !Number.isFinite(maxFileBytes) || maxFileBytes <= 0) {
    throw new StoreError('jsonl store: options.maxFileBytes must be a positive number', 'storage-failure')
  }
  const maxScanRecords = options.maxScanRecords ?? DEFAULT_MAX_SCAN_RECORDS
  if (typeof maxScanRecords !== 'number' || !Number.isInteger(maxScanRecords) || maxScanRecords < 1) {
    throw new StoreError('jsonl store: options.maxScanRecords must be a positive integer', 'storage-failure')
  }

  /** Serialized write chains, one per file. */
  const chains = new Map<string, Promise<void>>()
  let initPromise: Promise<void> | undefined

  const pathOf = (key: FileKey): string => join(dir, FILE_NAMES[key])
  const rotatedPathOf = (key: FileKey): string => join(dir, FILE_NAMES[key].replace(/\.jsonl$/, '.1.jsonl'))

  const ensureInit = (): Promise<void> => {
    if (initPromise !== undefined) return initPromise
    initPromise = mkdir(dir, { recursive: true }).then(
      () => undefined,
      (error: unknown) => {
        initPromise = undefined
        throw toStoreError('create store directory', error)
      },
    )
    return initPromise
  }

  /** Serialize one task per file; the queue survives a rejected task. */
  const enqueue = (file: string, task: () => Promise<void>): Promise<void> => {
    const previous = chains.get(file) ?? Promise.resolve()
    const next = previous.then(task, task)
    chains.set(file, next.then(() => undefined, () => undefined))
    return next
  }

  const emptyIndex = (): FileIndex => ({ size: 0, mtimeMs: 0, entries: [], order: [] })

  /** Stream the file once, recording line windows and sort timestamps. */
  const buildIndex = async (key: FileKey, file: string): Promise<FileIndex> => {
    let handle: FileHandle
    try {
      handle = await open(file, 'r')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return emptyIndex()
      throw toStoreError(`read ${FILE_NAMES[key]}`, error)
    }
    try {
      const info: Stats = await handle.stat()
      const needle = timeNeedle(TIME_FIELDS[key])
      const pattern = new RegExp(`"${TIME_FIELDS[key]}"\\s*:\\s*"([^"]*)"`)
      const entries: LineEntry[] = []
      const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES)
      let position = 0
      let lineStart = 0
      let carry: Buffer | null = null
      for (;;) {
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
        if (bytesRead === 0) break
        const view = chunk.subarray(0, bytesRead)
        let cursor = 0
        for (;;) {
          const newlineAt = view.indexOf(0x0a, cursor)
          if (newlineAt === -1) {
            if (cursor < view.length) {
              const rest = Buffer.from(view.subarray(cursor))
              carry = carry === null ? rest : Buffer.concat([carry, rest])
            }
            break
          }
          const segment = view.subarray(cursor, newlineAt)
          const lineBytes = carry === null ? segment : Buffer.concat([carry, segment])
          carry = null
          const lineEnd = position + newlineAt
          entries.push({ offset: lineStart, length: lineEnd - lineStart, time: extractTime(lineBytes, needle, pattern) })
          lineStart = lineEnd + 1
          cursor = newlineAt + 1
        }
        position += bytesRead
      }
      if (carry !== null && carry.length > 0) {
        entries.push({ offset: lineStart, length: carry.length, time: extractTime(carry, needle, pattern) })
      }
      const order = entries.map((_, index) => index)
      order.sort((left, right) => {
        const leftTime = entries[left]?.time ?? ''
        const rightTime = entries[right]?.time ?? ''
        if (leftTime !== rightTime) return leftTime < rightTime ? 1 : -1
        return right - left
      })
      return { size: info.size, mtimeMs: info.mtimeMs, entries, order }
    } catch (error) {
      throw toStoreError(`read ${FILE_NAMES[key]}`, error)
    } finally {
      await handle.close()
    }
  }

  /** Index for one file, rebuilt only when its size or mtime moved. */
  const getIndex = async (key: FileKey): Promise<FileIndex> => {
    const file = pathOf(key)
    let info: Stats
    try {
      info = await stat(file)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return emptyIndex()
      throw toStoreError(`stat ${FILE_NAMES[key]}`, error)
    }
    const cached = indexCache.get(file)
    if (cached !== undefined && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached
    const built = await buildIndex(key, file)
    indexCache.set(file, built)
    return built
  }

  /** Open a generation for reading; null when it does not exist. */
  const openForRead = async (file: string): Promise<FileHandle | null> => {
    try {
      return await open(file, 'r')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null
      throw toStoreError('read store file', error)
    }
  }

  /** Read exactly one indexed line; null when the file shrank underneath us. */
  const readLine = async (handle: FileHandle, entry: LineEntry): Promise<string | null> => {
    const buffer = Buffer.allocUnsafe(entry.length)
    let filled = 0
    while (filled < entry.length) {
      const { bytesRead } = await handle.read(buffer, filled, entry.length - filled, entry.offset + filled)
      if (bytesRead === 0) break
      filled += bytesRead
    }
    if (filled === 0) return null
    return buffer.subarray(0, filled).toString('utf8')
  }

  /** Iterate every valid record of a file in file order (bounded). */
  const readAllRecords = async <T>(key: FileKey, guard: (value: unknown) => value is T): Promise<{ records: T[]; warnings: string[] }> => {
    const file = pathOf(key)
    const index = await getIndex(key)
    const stats: ScanStats = { unreadable: 0, unsupported: 0, capped: false }
    const records: T[] = []
    const warnings: string[] = []
    if (index.entries.length > 0) {
      const handle = await openForRead(file)
      if (handle !== null) {
        try {
          let scanned = 0
          for (const entry of index.entries) {
            if (entry.length === 0) continue
            if (entry.length > MAX_LINE_BYTES) {
              stats.unreadable += 1
              continue
            }
            scanned += 1
            if (scanned > maxScanRecords) {
              stats.capped = true
              break
            }
            const text = await readLine(handle, entry)
            if (text === null) break
            const parsed = parseStoredLine(text)
            if (parsed.kind === 'unreadable') {
              stats.unreadable += 1
              continue
            }
            if (parsed.kind === 'unsupported') {
              stats.unsupported += 1
              continue
            }
            if (!guard(parsed.value)) {
              stats.unreadable += 1
              continue
            }
            records.push(parsed.value)
          }
        } finally {
          await handle.close()
        }
      }
    }
    appendSkipWarning(warnings, FILE_NAMES[key], stats)
    return { records, warnings }
  }

  /** Does the current generation already end on a newline boundary? */
  const endsWithNewline = async (file: string, size: number): Promise<boolean> => {
    if (verifiedEnds.get(file) === size) return true
    try {
      const handle = await open(file, 'r')
      try {
        const byte = Buffer.allocUnsafe(1)
        const { bytesRead } = await handle.read(byte, 0, 1, size - 1)
        return bytesRead === 1 && byte[0] === 0x0a
      } finally {
        await handle.close()
      }
    } catch {
      // Do not fail here: the append below surfaces the real error.
      return true
    }
  }

  /**
   * Rotate an oversized generation (best effort) and report the resulting size.
   * A rotation failure is swallowed so only the append itself can fail a write.
   */
  const prepareAppend = async (key: FileKey): Promise<number> => {
    const file = pathOf(key)
    let size = 0
    try {
      const info = await stat(file)
      size = info.size
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') return 0
      verifiedEnds.delete(file)
      indexCache.delete(file)
      return 0
    }
    if (size <= maxFileBytes) return size
    try {
      await rename(file, rotatedPathOf(key))
    } catch {
      return size
    }
    verifiedEnds.delete(file)
    indexCache.delete(file)
    return 0
  }

  /** Append one already-serialised record to its file, serialized per file. */
  const writeRecord = (key: FileKey, build: () => Record<string, unknown>): Promise<void> => {
    const file = pathOf(key)
    return enqueue(file, async () => {
      await ensureInit()
      let line: string
      try {
        line = `${JSON.stringify({ ...build(), schemaVersion: SCHEMA_VERSION })}\n`
      } catch (error) {
        throw toStoreError(`serialize ${FILE_NAMES[key]}`, error)
      }
      const size = await prepareAppend(key)
      const needsSeparator = size > 0 && !(await endsWithNewline(file, size))
      const lineBuffer = Buffer.from(line, 'utf8')
      const payload = needsSeparator ? Buffer.concat([Buffer.from('\n', 'utf8'), lineBuffer]) : lineBuffer
      try {
        await appendFile(file, payload, { flag: 'a' })
      } catch (error) {
        indexCache.delete(file)
        throw toStoreError(`append ${FILE_NAMES[key]}`, error)
      }
      verifiedEnds.set(file, size + payload.length)
      indexCache.delete(file)
    })
  }

  const store: JsonlTimelineStore = {
    location(): string {
      return dir
    },

    async init(): Promise<void> {
      await ensureInit()
    },

    appendRepository(record: Repository): Promise<void> {
      return writeRecord('repositories', () => ({ ...record }))
    },

    appendEvent(record: VcsEvent): Promise<void> {
      return writeRecord('events', () => ({ ...record }))
    },

    appendChangeSet(record: ChangeSet): Promise<void> {
      return writeRecord('changesets', () => ({ ...record }))
    },

    appendOperation(record: OperationAttempt): Promise<void> {
      if (typeof record !== 'object' || record === null) {
        return Promise.reject(new StoreError('jsonl store: operation record must be an object', 'invalid-request'))
      }
      return writeRecord('operations', () => prepareOperationRecord(record))
    },

    async listRepositories(): Promise<Repository[]> {
      const read = await readAllRecords('repositories', isRepository)
      return foldRepositories(read.records)
    },

    async getRepository(id: string): Promise<Repository | undefined> {
      const wanted = typeof id === 'string' ? id.trim() : ''
      if (wanted === '') return undefined
      const read = await readAllRecords('repositories', isRepository)
      return foldRepositories(read.records).find(record => record.id === wanted)
    },

    async queryEvents(query: TimelineQuery): Promise<TimelinePage> {
      const warnings: string[] = []
      const repositoryId = typeof query?.repositoryId === 'string' ? query.repositoryId.trim() : ''
      if (repositoryId === '') {
        return { events: [], nextCursor: null, hasMore: false, warnings: ['queryEvents requires a repositoryId'] }
      }
      const limit = clampInt(query.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)
      const offset = readCursorOffset(query.cursor, warnings)
      const filter = buildEventFilter(query, repositoryId)
      const index = await getIndex('events')
      const stats: ScanStats = { unreadable: 0, unsupported: 0, capped: false }
      const events: VcsEvent[] = []
      if (index.order.length > 0) {
        const handle = await openForRead(pathOf('events'))
        if (handle !== null) {
          try {
            let remainingSkip = offset
            let hasMore = false
            let scanned = 0
            for (const entryIndex of index.order) {
              const entry = index.entries[entryIndex]
              if (entry === undefined || entry.length === 0) continue
              if (entry.length > MAX_LINE_BYTES) {
                stats.unreadable += 1
                continue
              }
              scanned += 1
              if (scanned > maxScanRecords) {
                stats.capped = true
                break
              }
              const text = await readLine(handle, entry)
              if (text === null) break
              const parsed = parseStoredLine(text)
              if (parsed.kind === 'unreadable') {
                stats.unreadable += 1
                continue
              }
              if (parsed.kind === 'unsupported') {
                stats.unsupported += 1
                continue
              }
              if (!isVcsEvent(parsed.value)) {
                stats.unreadable += 1
                continue
              }
              const event = parsed.value
              if (!matchesEventFilter(event, filter)) continue
              if (remainingSkip > 0) {
                remainingSkip -= 1
                continue
              }
              if (events.length < limit) {
                events.push(event)
                continue
              }
              hasMore = true
              break
            }
            appendSkipWarning(warnings, FILE_NAMES.events, stats)
            return {
              events,
              nextCursor: hasMore ? encodeCursor({ o: offset + events.length }) : null,
              hasMore,
              warnings,
            }
          } finally {
            await handle.close()
          }
        }
      }
      appendSkipWarning(warnings, FILE_NAMES.events, stats)
      return { events, nextCursor: null, hasMore: false, warnings }
    },

    async queryOperations(query: OperationQuery): Promise<OperationPage> {
      const warnings: string[] = []
      const limit = clampInt(query?.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)
      const offset = readCursorOffset(query?.cursor, warnings)
      const repositoryId = typeof query?.repositoryId === 'string' ? query.repositoryId.trim() : ''
      const read = await readAllRecords('operations', isOperationAttempt)
      warnings.push(...read.warnings)
      const folded = foldOperations(read.records)
      const filtered = repositoryId === '' ? folded : folded.filter(entry => entry.attempt.repositoryId === repositoryId)
      const page = filtered.slice(offset, offset + limit)
      const hasMore = offset + page.length < filtered.length
      return {
        operations: page.map(entry => entry.attempt),
        nextCursor: hasMore ? encodeCursor({ o: offset + page.length }) : null,
        hasMore,
        warnings,
      }
    },

    async getOperation(id: string): Promise<OperationAttempt | undefined> {
      const wanted = typeof id === 'string' ? id.trim() : ''
      if (wanted === '') return undefined
      const read = await readAllRecords('operations', isOperationAttempt)
      return foldOperations(read.records).find(entry => entry.attempt.id === wanted)?.attempt
    },

    async close(): Promise<void> {
      const pending = [...chains.values()]
      await Promise.allSettled(pending)
      chains.clear()
      verifiedEnds.clear()
    },

    async migrate(context: JsonlMigrationContext): Promise<void> {
      if (typeof context !== 'object' || context === null) {
        throw new StoreError('jsonl store: migrate requires a migration context', 'invalid-request')
      }
      if (context.toVersion !== SCHEMA_VERSION) {
        throw new StoreError(`jsonl store: no migration path to schema version ${String(context.toVersion)}`, 'storage-failure')
      }
      await ensureInit()
      // SCHEMA_VERSION is still 1, so no rewrite is required yet. When it moves
      // to 2, implement the temp-file rewrite described on
      // JsonlTimelineStore.migrate and cover it with a test.
    },
  }

  return store
}
