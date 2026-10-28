/**
 * SVN backend for dsh-vcs-timeline.
 *
 * The adapter speaks only through the injected {@link Runner} (argv arrays,
 * never a shell), reads only inside the resolved working copy root, and
 * reports every failure as a stable {@link ApiError} instead of throwing.
 *
 * Environment note: a machine without the `svn` client is a first-class
 * outcome here. `resolveExecutable('svn')` is checked before every command and
 * a missing client short-circuits to `vcs-not-installed`; a spawn failure is
 * mapped the same way. No method throws on a missing client.
 *
 * Error mapping (stable, documented):
 *  - missing client / ENOENT on spawn  -> `vcs-not-installed`
 *  - `E155007` / "is not a working copy" -> `not-a-repository`
 *  - auth (`E170001`, `E215004`, "authorization failed") -> `network-unknown`
 *  - connect/SSL (`E175002`, `E670008`, "could not connect", ...) -> `network-unknown`
 *  - conflict run failures (`E155015`, "remains in conflict") -> `conflict`
 *  - deadline kill -> `timeout`
 *  - anything else nonzero -> `operation-failed` with redacted stderr text
 * @module dsh-vcs-timeline/host/adapters/svn/adapter
 */

import { stat, realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type {
  ApiError,
  ChangeSet,
  ChangedFile,
  DiffResult,
  FileChangeStatus,
  OperationBeforeState,
  OperationType,
  Repository,
  VcsEvent,
  WorkingTreeEntry,
  WorkingTreeStatus,
  WorktreeDiffResult,
} from '../../../shared/contracts.ts'
import {
  DEFAULT_DIFF_MAX_BYTES,
  HARD_DIFF_MAX_BYTES,
  MAX_EVENT_FILES,
  MAX_PAGE_SIZE,
  SCHEMA_VERSION,
} from '../../../shared/contracts.ts'
import type {
  AdapterDiffQuery,
  AdapterResult,
  AdapterWorktreeDiffQuery,
  HistoryPage,
  HistoryQuery,
  OperationParams,
  OperationPlan,
  RunOptions,
  RunResult,
  Runner,
  VcsAdapter,
} from '../types.ts'
import {
  clampInt,
  decodeCursor,
  encodeCursor,
  joinRepoPath,
  normalizeRepoRelativePath,
  redactText,
  redactUrl,
  repositoryId,
  safeErrorMessage,
  truncateUtf8,
} from '../../security.ts'
import {
  DEFAULT_HISTORY_LIMIT,
  MAX_CHANGESET_FILES,
  MAX_COMMIT_MESSAGE_LENGTH,
  buildCommitArgs,
  buildDiffArgs,
  buildDiffSummarizeArgs,
  buildInfoArgs,
  buildLogArgs,
  buildStatusArgs,
  buildUpdateArgs,
  buildWorktreeDiffArgs,
  parseDiffSummarize,
  parseInfoXml,
  parseLogXml,
  parseRevision,
  parseRevisionNumber,
  parseStatusXml,
  repoPathToRelative,
  svnPrefixFromInfo,
  targetPathToRelative,
} from './commands.ts'
import type { SvnInfo, SvnLogEntry, SvnLogPath, SvnSummarizeEntry } from './commands.ts'
import { XmlParseError } from './xml.ts'

/** Statuses that make a working copy dirty. Unversioned/ignored/external do not. */
const CLEAN_WORTHY_STATUSES: ReadonlySet<string> = new Set([
  'added', 'conflicted', 'deleted', 'incomplete', 'merged', 'missing', 'modified', 'obstructed', 'replaced',
])

/** Captured-output cap for `svn info`, in bytes. */
const INFO_OUTPUT_CAP_BYTES = 256 * 1024

/** Captured-output cap for `svn log`, in bytes. */
const LOG_OUTPUT_CAP_BYTES = 4 * 1024 * 1024

/** Captured-output cap for `svn status`, in bytes. */
const STATUS_OUTPUT_CAP_BYTES = 4 * 1024 * 1024

/** Captured-output cap for `svn diff`; must exceed the hard diff ceiling. */
const DIFF_OUTPUT_CAP_BYTES = HARD_DIFF_MAX_BYTES + (64 * 1024)

/** Deadline for a local-only command. */
const LOCAL_TIMEOUT_MS = 20_000

/** Deadline for a command that may contact the repository server. */
const NETWORK_TIMEOUT_MS = 60_000

/** Deadline for a diff command. */
const DIFF_TIMEOUT_MS = 30_000

/** Cap on working-tree entries returned, to bound a pathological status. */
const MAX_STATUS_ENTRIES = 2000

/** Fallback timestamp for a malformed log entry (svn always emits a date). */
const EPOCH_ISO = '1970-01-01T00:00:00.000Z'

/** SVN adapter VCS type. */
const VCS_TYPE = 'svn' as const

/** Error patterns: path is not a working copy. */
const NOT_A_WORKING_COPY_PATTERN = /E155007|E155010|E155004.*not a working copy|is not a working copy/i

/** Error patterns: authentication failed. */
const AUTH_PATTERN = /E170001|E215004|E170013|authorization failed|authentication failed|not authorized|403 forbidden/i

/** Error patterns: transport failed. */
const CONNECT_PATTERN = /E175002|E670008|E730054|E731001|E731002|could not connect|unable to connect|connection refused|connection timed out|network is unreachable|no route to host|ssl handshake|e230001/i

/** Error patterns: unresolved conflict blocked the command. */
const CONFLICT_PATTERN = /E155015|E195020|E205000.*conflict|remains in conflict|in conflict/i

/** Error patterns: spawn could not find the client. */
const MISSING_CLIENT_PATTERN = /ENOENT|not found|not recognized|无法将|cannot find|could not find/i

/** A resolved svn client, or a stable error. */
type ClientLookup = { ok: true; value: string } | { ok: false; error: ApiError }

/** Options for one adapter run. */
interface SvnRunOptions {
  timeoutMs?: number
  maxBytes?: number
}

/** Summary of one parsed working copy status. */
interface StatusSummary {
  entries: WorkingTreeEntry[]
  conflicts: string[]
  /** True when a versioned path has a local modification. */
  changed: boolean
  unversioned: number
  external: number
  truncated: boolean
  warnings: string[]
}

/** One merged changeset path. */
interface MergedPath {
  path: string
  status: FileChangeStatus
  oldPath?: string
}

/** Build a successful adapter result. */
function ok<T>(value: T): AdapterResult<T> {
  return { ok: true, value }
}

/** Build a failed adapter result. */
function err<T>(error: ApiError): AdapterResult<T> {
  return { ok: false, error }
}

/** Build an `invalid-request` error. */
function invalidRequest(message: string, detail?: string): ApiError {
  return { code: 'invalid-request', message, ...(detail === undefined ? {} : { detail }), retryable: false }
}

/** Build an `internal` error without leaking a stack. */
function internalError(error: unknown): ApiError {
  return {
    code: 'internal',
    message: 'the SVN adapter failed unexpectedly',
    detail: safeErrorMessage(error),
    retryable: false,
  }
}

/** First non-empty line of a message, trimmed. */
function firstLine(message: string): string {
  const normalized = message.replace(/\r\n?/g, '\n')
  const line = normalized.split('\n')[0]
  return line === undefined ? '' : line.trim()
}

/** Resolve and validate a requested repository root. */
function resolveRoot(rootPath: unknown): string | null {
  if (typeof rootPath !== 'string' || rootPath.trim() === '') return null
  return resolve(rootPath.trim())
}

/** Resolve a requested repository id. */
function requireRepositoryId(repositoryIdValue: unknown): string | null {
  if (typeof repositoryIdValue !== 'string' || repositoryIdValue.trim() === '') return null
  return repositoryIdValue.trim()
}

/** Whether `path` exists and is a directory. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

/** Canonicalize a directory path; null when it does not resolve to one. */
async function canonicalizeDirectory(path: string): Promise<string | null> {
  try {
    const resolved = await realpath(path)
    const info = await stat(resolved)
    return info.isDirectory() ? resolved : null
  } catch {
    return null
  }
}

/** Walk up (bounded) looking for a `.svn` metadata directory. */
async function findMetadataAncestor(start: string): Promise<string | null> {
  let current = start
  try {
    const info = await stat(current)
    if (!info.isDirectory()) current = dirname(current)
  } catch {
    return null
  }
  for (let depth = 0; depth < 40; depth += 1) {
    if (await isDirectory(join(current, '.svn'))) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

/** Resolve the working copy root reported by `svn info`; null when unusable. */
function resolveInfoRoot(info: SvnInfo): string | null {
  if (info.wcRootPath !== undefined && info.wcRootPath.trim() !== '') return resolve(info.wcRootPath.trim())
  if (info.entryPath !== undefined && info.entryPath.trim() !== '') {
    const entryPath = info.entryPath.trim()
    if (/^[a-zA-Z]:[\\/]/.test(entryPath) || entryPath.startsWith('/') || entryPath.startsWith('\\\\')) {
      return resolve(entryPath)
    }
  }
  return null
}

/** Classify one failed `svn` run into a stable error. */
function classifyFailure(result: RunResult, fallback: string, signal?: AbortSignal): ApiError {
  const stderr = redactText(result.stderr ?? '')
  const spawnMessage = redactText(result.failureMessage ?? '')
  const combined = `${stderr}\n${spawnMessage}`.trim()
  const detail = safeErrorMessage(combined === '' ? fallback : combined, 500)

  if (result.spawnFailed === true) {
    if (MISSING_CLIENT_PATTERN.test(combined)) {
      return {
        code: 'vcs-not-installed',
        message: 'the svn client could not be started; install Subversion and make sure svn is on PATH',
        detail,
        retryable: false,
      }
    }
    return { code: 'operation-failed', message: 'the svn client could not be started', detail, retryable: false }
  }
  if (signal?.aborted === true) {
    return { code: 'operation-failed', message: 'the svn command was cancelled', detail, retryable: true }
  }
  if (result.timedOut === true) {
    return { code: 'timeout', message: 'the svn command exceeded its deadline', detail, retryable: true }
  }
  if (NOT_A_WORKING_COPY_PATTERN.test(combined)) {
    return { code: 'not-a-repository', message: 'the path is not an SVN working copy', detail, retryable: false }
  }
  if (AUTH_PATTERN.test(combined)) {
    return {
      code: 'network-unknown',
      message: 'svn authentication failed; the remote state is unknown',
      detail,
      retryable: false,
    }
  }
  if (CONNECT_PATTERN.test(combined)) {
    return {
      code: 'network-unknown',
      message: 'svn could not reach the repository; the remote state is unknown',
      detail,
      retryable: true,
    }
  }
  if (CONFLICT_PATTERN.test(combined)) {
    return { code: 'conflict', message: 'the operation stopped because the working copy has conflicts', detail, retryable: false }
  }
  return { code: 'operation-failed', message: fallback, detail, retryable: false }
}

/** Parse command output, mapping malformed or oversized output to a safe error. */
function parseOrError<T>(stdout: string, capBytes: number, parser: (text: string) => T): AdapterResult<T> {
  try {
    return ok(parser(stdout))
  } catch (error: unknown) {
    const bytes = Buffer.byteLength(stdout, 'utf8')
    const likelyCapped = capBytes > 0 && bytes >= Math.floor(capBytes * 0.95)
    if (likelyCapped) {
      return err({
        code: 'output-too-large',
        message: 'svn output exceeded the capture limit and could not be parsed',
        retryable: false,
      })
    }
    const message = error instanceof XmlParseError
      ? `could not parse svn XML output (${error.message})`
      : `could not parse svn output (${safeErrorMessage(error, 200)})`
    return err({ code: 'operation-failed', message, retryable: false })
  }
}

/** Map one summarize action letter to a changeset status. */
function summarizeActionToStatus(action: string): FileChangeStatus {
  switch (action) {
    case 'A': return 'added'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'modified'
    case 'C': return 'copied'
    default: return 'unknown'
  }
}

/** Classify one `svn log -v` path, resolving copies into copies/renames. */
function classifyLogPath(
  path: SvnLogPath,
  wcPrefix: string,
  deletedPaths: ReadonlySet<string>,
): { status: FileChangeStatus; oldPath?: string } | null {
  switch (path.action) {
    case 'A': {
      if (path.copyFromPath !== undefined) {
        const oldPath = repoPathToRelative(path.copyFromPath, wcPrefix)
        if (oldPath !== null) {
          return { status: deletedPaths.has(oldPath) ? 'renamed' : 'copied', oldPath }
        }
      }
      return { status: 'added' }
    }
    case 'D':
      return { status: 'deleted' }
    case 'R':
      // SVN "replaced": the node was deleted and re-added in one revision.
      return { status: 'modified' }
    case 'M':
      return { status: 'modified' }
    default:
      return null
  }
}

/** Normalize a `diff --summarize` path into the working copy relative form. */
function summarizePathToRelative(raw: string, wcRoot: string, wcPrefix: string): string | null {
  if (typeof raw !== 'string') return null
  const slashed = raw.trim().replace(/\\/g, '/')
  if (slashed === '') return null
  const root = wcRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  const comparable = process.platform === 'win32' ? slashed.toLowerCase() : slashed
  const comparableRoot = process.platform === 'win32' ? root.toLowerCase() : root
  const underRoot = root !== '' && (comparable === comparableRoot || comparable.startsWith(`${comparableRoot}/`))
  if (!underRoot && (slashed.startsWith('/') || slashed.startsWith('^/'))) {
    return repoPathToRelative(slashed, wcPrefix)
  }
  // A working copy rooted at a repository subdirectory can make svn print
  // repository-relative paths without the leading slash ("trunk/a.txt").
  // Resolve those against the working copy prefix too, so a revision's log
  // paths and its summarize paths land on the same key.
  const prefix = wcPrefix.replace(/^\/+/, '').replace(/\/+$/, '')
  if (prefix !== '') {
    const comparablePrefix = process.platform === 'win32' ? prefix.toLowerCase() : prefix
    const comparableSlashed = process.platform === 'win32' ? slashed.toLowerCase() : slashed
    if (comparableSlashed === comparablePrefix || comparableSlashed.startsWith(`${comparablePrefix}/`)) {
      const byRepo = repoPathToRelative(`/${slashed}`, wcPrefix)
      if (byRepo !== null) return byRepo
    }
  }
  return targetPathToRelative(slashed, wcRoot)
}

/** Build one timeline event from a parsed log entry. */
function buildCommitEvent(repositoryIdValue: string, entry: SvnLogEntry): VcsEvent {
  const revisionNumber = Number(entry.revision)
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `${repositoryIdValue}:${entry.revision}`,
    repositoryId: repositoryIdValue,
    vcsType: VCS_TYPE,
    eventType: 'commit',
    source: 'repository',
    timestamp: entry.date ?? EPOCH_ISO,
    ...(entry.author === undefined ? {} : { actor: entry.author }),
    summary: firstLine(entry.message),
    revision: entry.revision,
    changeSetId: `${repositoryIdValue}:${entry.revision}`,
    metadata: {
      parentCount: revisionNumber <= 1 ? 0 : 1,
      pathCount: entry.paths.length,
      // SVN log entries carry the changed-path count; line counts would need a
      // full diff per revision, so none are invented here.
      filesChanged: entry.paths.length,
    },
  }
}

/**
 * Attach one log entry's changed paths to its timeline event.
 *
 * `svn log -v` already reports every changed path of the revision, so the
 * per-commit file list needs no extra history command. Paths are mapped into
 * the working copy-relative form; copies become renames when their source was
 * deleted in the same revision, matching the changeset classification. The
 * list is capped at {@link MAX_EVENT_FILES}; the rest only sets
 * `changedFilesTruncated`.
 */
function attachChangedFiles(event: VcsEvent, entry: SvnLogEntry, wcPrefix: string): VcsEvent {
  const deletedPaths = new Set<string>()
  for (const path of entry.paths) {
    if (path.action !== 'D') continue
    const relative = repoPathToRelative(path.path, wcPrefix)
    if (relative !== null) deletedPaths.add(relative)
  }
  const files: ChangedFile[] = []
  const seen = new Set<string>()
  let truncated = false
  for (const path of entry.paths) {
    const relative = repoPathToRelative(path.path, wcPrefix)
    if (relative === null || seen.has(relative)) continue
    if (files.length >= MAX_EVENT_FILES) {
      truncated = true
      break
    }
    seen.add(relative)
    const classified = classifyLogPath(path, wcPrefix, deletedPaths)
    files.push(classified === null
      ? { path: relative, status: 'unknown' }
      : {
          path: relative,
          status: classified.status,
          ...(classified.oldPath === undefined ? {} : { oldPath: classified.oldPath }),
        })
  }
  return {
    ...event,
    changedFiles: files,
    ...(truncated ? { changedFilesTruncated: true } : {}),
  }
}

/**
 * Create the SVN adapter.
 * @param runner - the Host subprocess seam (argv arrays only, managed caps).
 * @returns the {@link VcsAdapter} implementation.
 */
export function createSvnAdapter(runner: Runner): VcsAdapter {
  /** Resolve the svn executable, or the stable not-installed error. */
  const resolveClient = async (): Promise<ClientLookup> => {
    try {
      const executable = await runner.resolveExecutable('svn')
      if (executable === null || executable.trim() === '') {
        return {
          ok: false,
          error: {
            code: 'vcs-not-installed',
            message: 'the svn client is not installed or not on PATH; SVN repositories are unavailable',
            retryable: false,
          },
        }
      }
      return { ok: true, value: executable }
    } catch (error: unknown) {
      return { ok: false, error: internalError(error) }
    }
  }

  /** Run one svn command through the managed runner. */
  const runSvn = async (
    argv: readonly string[],
    cwd: string,
    signal: AbortSignal | undefined,
    options: SvnRunOptions = {},
  ): Promise<RunResult> => {
    const runOptions: RunOptions = {
      timeoutMs: options.timeoutMs ?? LOCAL_TIMEOUT_MS,
      maxBytes: options.maxBytes ?? INFO_OUTPUT_CAP_BYTES,
    }
    if (signal !== undefined) runOptions.signal = signal
    return runner.run(argv, cwd, runOptions)
  }

  /** Read and parse `svn info --xml`. */
  const readInfo = async (executable: string, root: string, signal: AbortSignal | undefined): Promise<AdapterResult<SvnInfo>> => {
    const run = await runSvn(buildInfoArgs(executable, root), root, signal, {
      timeoutMs: LOCAL_TIMEOUT_MS,
      maxBytes: INFO_OUTPUT_CAP_BYTES,
    })
    if (run.exitCode !== 0) return err(classifyFailure(run, 'svn info failed', signal))
    return parseOrError(run.stdout, INFO_OUTPUT_CAP_BYTES, parseInfoXml)
  }

  /** Read the working copy prefix for log path mapping (best effort). */
  const readWcPrefix = async (executable: string, root: string, signal: AbortSignal | undefined): Promise<string> => {
    try {
      const info = await readInfo(executable, root, signal)
      return info.ok ? svnPrefixFromInfo(info.value) : ''
    } catch {
      return ''
    }
  }

  /** Read and summarize `svn status --xml`. */
  const readStatus = async (executable: string, root: string, signal: AbortSignal | undefined): Promise<AdapterResult<StatusSummary>> => {
    const run = await runSvn(buildStatusArgs(executable, root), root, signal, {
      timeoutMs: LOCAL_TIMEOUT_MS,
      maxBytes: STATUS_OUTPUT_CAP_BYTES,
    })
    if (run.exitCode !== 0) return err(classifyFailure(run, 'svn status failed', signal))
    const parsed = parseOrError(run.stdout, STATUS_OUTPUT_CAP_BYTES, parseStatusXml)
    if (!parsed.ok) return parsed

    const entries: WorkingTreeEntry[] = []
    const conflicts: string[] = []
    const seen = new Set<string>()
    let changed = false
    let unversioned = 0
    let external = 0
    for (const item of parsed.value) {
      const relative = targetPathToRelative(item.path, root)
      if (relative === null || seen.has(relative)) continue
      seen.add(relative)
      const propChanged = item.props === 'modified' || item.props === 'conflicted'
      let status = item.item
      if ((status === 'normal' || status === 'none') && propChanged) status = 'modified'
      const conflicted = status === 'conflicted' || item.treeConflicted === true || item.props === 'conflicted'
      if (conflicted) conflicts.push(relative)
      if (status === 'unversioned') unversioned += 1
      else if (status === 'external') external += 1
      if (CLEAN_WORTHY_STATUSES.has(status)) changed = true
      entries.push({ path: relative, status })
    }

    const warnings: string[] = []
    if (unversioned > 0) warnings.push(`${unversioned} unversioned path(s) are not counted as local modifications`)
    if (external > 0) warnings.push(`${external} unversioned external path(s) are not counted as local modifications`)
    let truncated = false
    let limitedEntries = entries
    if (limitedEntries.length > MAX_STATUS_ENTRIES) {
      limitedEntries = limitedEntries.slice(0, MAX_STATUS_ENTRIES)
      truncated = true
      warnings.push(`working copy status was truncated to ${MAX_STATUS_ENTRIES} entries`)
    }
    return ok({ entries: limitedEntries, conflicts, changed, unversioned, external, truncated, warnings })
  }

  return {
    vcsType: VCS_TYPE,

    async detect(path: string): Promise<AdapterResult<{ rootPath: string } | null>> {
      try {
        const client = await resolveClient()
        if (!client.ok) return client
        if (typeof path !== 'string' || path.trim() === '') return ok(null)
        const start = resolve(path.trim())

        const ancestor = await findMetadataAncestor(start)
        if (ancestor !== null) {
          const canonicalAncestor = (await canonicalizeDirectory(ancestor)) ?? ancestor
          const info = await readInfo(client.value, canonicalAncestor, undefined)
          if (info.ok) {
            const detected = resolveInfoRoot(info.value)
            if (detected !== null) {
              const canonicalRoot = await canonicalizeDirectory(detected)
              if (canonicalRoot !== null) return ok({ rootPath: canonicalRoot })
            }
          }
          return ok({ rootPath: canonicalAncestor })
        }

        const info = await readInfo(client.value, start, undefined)
        if (info.ok) {
          const detected = resolveInfoRoot(info.value)
          if (detected !== null) {
            const canonicalRoot = await canonicalizeDirectory(detected)
            if (canonicalRoot !== null) return ok({ rootPath: canonicalRoot })
          }
        }
        return ok(null)
      } catch {
        // Detection must never throw: a missing client, race, or malformed
        // info simply means "no SVN repository here".
        return ok(null)
      }
    },

    async info(rootPath: string, signal?: AbortSignal): Promise<AdapterResult<Repository>> {
      try {
        const client = await resolveClient()
        if (!client.ok) return client
        const root = resolveRoot(rootPath)
        if (root === null) return err(invalidRequest('repository root is required'))
        const infoResult = await readInfo(client.value, root, signal)
        if (!infoResult.ok) return infoResult
        const facts = infoResult.value
        const timestamp = new Date().toISOString()
        const name = basename(root)
        const repository: Repository = {
          schemaVersion: SCHEMA_VERSION,
          id: repositoryId(VCS_TYPE, root),
          vcsType: VCS_TYPE,
          rootPath: root,
          displayName: name === '' ? root : name,
          ...(facts.url === undefined ? {} : { remoteUrls: [redactUrl(facts.url)] }),
          ...(facts.revision === undefined ? {} : { currentRevision: facts.revision }),
          detectedAt: timestamp,
          lastSeenAt: timestamp,
        }
        return ok(repository)
      } catch (error: unknown) {
        return err(internalError(error))
      }
    },

    async history(
      rootPath: string,
      repositoryIdValue: string,
      query: HistoryQuery,
      signal?: AbortSignal,
    ): Promise<AdapterResult<HistoryPage>> {
      try {
        const requestedId = requireRepositoryId(repositoryIdValue)
        if (requestedId === null) return err(invalidRequest('repositoryId is required'))
        if (typeof query !== 'object' || query === null) return err(invalidRequest('history query is required'))
        const client = await resolveClient()
        if (!client.ok) return client
        const root = resolveRoot(rootPath)
        if (root === null) return err(invalidRequest('repository root is required'))

        const limit = clampInt(query.limit, 1, MAX_PAGE_SIZE, DEFAULT_HISTORY_LIMIT)
        if (Array.isArray(query.eventTypes) && query.eventTypes.length > 0 && !query.eventTypes.includes('commit')) {
          return ok({ events: [], nextCursor: null, hasMore: false })
        }

        let afterRevision: number | null = null
        if (typeof query.cursor === 'string' && query.cursor !== '') {
          const decoded = decodeCursor(query.cursor)
          const raw = decoded === null ? null : decoded['r']
          const parsed = typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0
            ? raw
            : typeof raw === 'string' ? parseRevisionNumber(raw) : null
          if (parsed === null) return err(invalidRequest('invalid history cursor'))
          afterRevision = parsed
        }
        if (afterRevision !== null && afterRevision <= 1) {
          return ok({ events: [], nextCursor: null, hasMore: false })
        }

        const revisionRange = afterRevision === null ? 'HEAD:1' : `${afterRevision - 1}:1`
        const includeFiles = query.includeFiles === true
        const argv = buildLogArgs(client.value, root, { revisionRange, limit, verbose: true })
        // The log already runs with `-v`, so a requested file list costs no
        // extra history read: only the local `svn info` needed for path mapping
        // runs alongside it, and its failure merely falls back to repository
        // paths (the same documented fallback the changeset path uses).
        const [run, infoResult] = await Promise.all([
          runSvn(argv, root, signal, { timeoutMs: NETWORK_TIMEOUT_MS, maxBytes: LOG_OUTPUT_CAP_BYTES }),
          includeFiles ? readInfo(client.value, root, signal) : Promise.resolve(null),
        ])
        if (run.exitCode !== 0) return err(classifyFailure(run, 'svn log failed', signal))
        const parsed = parseOrError(run.stdout, LOG_OUTPUT_CAP_BYTES, parseLogXml)
        if (!parsed.ok) return parsed
        const wcPrefix = infoResult !== null && infoResult.ok ? svnPrefixFromInfo(infoResult.value) : ''

        const rawEntries = parsed.value
        const hasMore = rawEntries.length >= limit
        const lastEntry = rawEntries[rawEntries.length - 1]
        const authorFilter = typeof query.author === 'string' && query.author.trim() !== ''
          ? query.author.trim().toLowerCase()
          : undefined
        const textFilter = typeof query.text === 'string' && query.text.trim() !== ''
          ? query.text.trim().toLowerCase()
          : undefined
        const since = typeof query.since === 'string' ? Date.parse(query.since) : Number.NaN
        const until = typeof query.until === 'string' ? Date.parse(query.until) : Number.NaN

        const events: VcsEvent[] = []
        for (const entry of rawEntries) {
          if (authorFilter !== undefined && !(entry.author ?? '').toLowerCase().includes(authorFilter)) continue
          if (textFilter !== undefined && !entry.message.toLowerCase().includes(textFilter)) continue
          const timestampMs = Date.parse(entry.date ?? EPOCH_ISO)
          if (Number.isFinite(since) && Number.isFinite(timestampMs) && timestampMs < since) continue
          if (Number.isFinite(until) && Number.isFinite(timestampMs) && timestampMs > until) continue
          const event = buildCommitEvent(requestedId, entry)
          events.push(includeFiles ? attachChangedFiles(event, entry, wcPrefix) : event)
        }

        const nextCursor = hasMore && lastEntry !== undefined
          ? encodeCursor({ r: Number(lastEntry.revision) })
          : null
        // SVN has no branch refs: a requested branch/all-branches filter is
        // reported instead of silently applied to the wrong history.
        const branchFilterRequested = (typeof query.branch === 'string' && query.branch !== '')
          || query.branchScope === 'all'
        const warnings = branchFilterRequested
          ? ['branch filtering is not available for SVN; showing the working copy history']
          : []
        return ok({
          events,
          nextCursor,
          hasMore,
          ...(warnings.length === 0 ? {} : { warnings }),
        })
      } catch (error: unknown) {
        return err(internalError(error))
      }
    },

    async changeSet(
      rootPath: string,
      repositoryIdValue: string,
      revision: string,
      signal?: AbortSignal,
    ): Promise<AdapterResult<ChangeSet>> {
      try {
        const requestedId = requireRepositoryId(repositoryIdValue)
        if (requestedId === null) return err(invalidRequest('repositoryId is required'))
        const canonicalRevision = parseRevision(revision)
        if (canonicalRevision === null) {
          return err(invalidRequest('revision must be a numeric SVN revision', 'expected 1-12 decimal digits'))
        }
        const client = await resolveClient()
        if (!client.ok) return client
        const root = resolveRoot(rootPath)
        if (root === null) return err(invalidRequest('repository root is required'))

        const logRun = await runSvn(
          buildLogArgs(client.value, root, { revisionRange: canonicalRevision, verbose: true }),
          root,
          signal,
          { timeoutMs: NETWORK_TIMEOUT_MS, maxBytes: LOG_OUTPUT_CAP_BYTES },
        )
        if (logRun.exitCode !== 0) return err(classifyFailure(logRun, 'svn log failed', signal))
        const parsedLog = parseOrError(logRun.stdout, LOG_OUTPUT_CAP_BYTES, parseLogXml)
        if (!parsedLog.ok) return parsedLog
        const entry = parsedLog.value.find(candidate => candidate.revision === canonicalRevision)
        if (entry === undefined) {
          return err({
            code: 'operation-failed',
            message: `revision r${canonicalRevision} is not present in the working copy history`,
            retryable: false,
          })
        }

        const wcPrefix = await readWcPrefix(client.value, root, signal)
        const summarizeRun = await runSvn(
          buildDiffSummarizeArgs(client.value, root, canonicalRevision),
          root,
          signal,
          { timeoutMs: LOCAL_TIMEOUT_MS, maxBytes: LOG_OUTPUT_CAP_BYTES },
        )
        const summarizeEntries: SvnSummarizeEntry[] = summarizeRun.exitCode === 0
          ? parseDiffSummarize(summarizeRun.stdout)
          : []
        const summarizeByPath = new Map<string, SvnSummarizeEntry>()
        for (const item of summarizeEntries) {
          const relative = summarizePathToRelative(item.path, root, wcPrefix)
          if (relative !== null) summarizeByPath.set(relative, item)
        }

        const deletedPaths = new Set<string>()
        for (const path of entry.paths) {
          if (path.action !== 'D') continue
          const relative = repoPathToRelative(path.path, wcPrefix)
          if (relative !== null) deletedPaths.add(relative)
        }

        const seen = new Set<string>()
        const merged: MergedPath[] = []
        for (const path of entry.paths) {
          const relative = repoPathToRelative(path.path, wcPrefix)
          if (relative === null || seen.has(relative)) continue
          seen.add(relative)
          const classified = classifyLogPath(path, wcPrefix, deletedPaths)
          const summarize = summarizeByPath.get(relative)
          if (classified === null) {
            merged.push({ path: relative, status: summarize === undefined ? 'unknown' : summarizeActionToStatus(summarize.action) })
            continue
          }
          merged.push({ path: relative, ...classified })
        }
        for (const [relative, item] of summarizeByPath) {
          if (seen.has(relative)) continue
          seen.add(relative)
          merged.push({ path: relative, status: summarizeActionToStatus(item.action) })
        }

        const files: ChangedFile[] = []
        let truncated = false
        for (const item of merged) {
          if (files.length >= MAX_CHANGESET_FILES) {
            truncated = true
            break
          }
          files.push({
            path: item.path,
            status: item.status,
            ...(item.oldPath === undefined ? {} : { oldPath: item.oldPath }),
          })
        }

        const revisionNumber = Number(canonicalRevision)
        const changeSet: ChangeSet = {
          schemaVersion: SCHEMA_VERSION,
          id: `${requestedId}:${canonicalRevision}`,
          repositoryId: requestedId,
          vcsType: VCS_TYPE,
          revision: canonicalRevision,
          ...(revisionNumber > 0 ? { parentRevision: String(revisionNumber - 1) } : {}),
          createdAt: entry.date ?? EPOCH_ISO,
          files,
          ...(truncated
            ? {
                truncated: true,
                truncationReason: `changeset has more than ${MAX_CHANGESET_FILES} changed paths; the file list was truncated`,
              }
            : {}),
        }
        return ok(changeSet)
      } catch (error: unknown) {
        return err(internalError(error))
      }
    },

    async diff(
      rootPath: string,
      repositoryIdValue: string,
      query: AdapterDiffQuery,
      signal?: AbortSignal,
    ): Promise<AdapterResult<DiffResult>> {
      try {
        const requestedId = requireRepositoryId(repositoryIdValue)
        if (requestedId === null) return err(invalidRequest('repositoryId is required'))
        if (typeof query !== 'object' || query === null) return err(invalidRequest('diff query is required'))
        const client = await resolveClient()
        if (!client.ok) return client
        const root = resolveRoot(rootPath)
        if (root === null) return err(invalidRequest('repository root is required'))

        const revisionA = query.revisionA === undefined ? null : parseRevision(query.revisionA)
        const revisionB = query.revisionB === undefined ? null : parseRevision(query.revisionB)
        if (query.revisionA !== undefined && revisionA === null) {
          return err(invalidRequest('revisionA must be a numeric SVN revision'))
        }
        if (query.revisionB !== undefined && revisionB === null) {
          return err(invalidRequest('revisionB must be a numeric SVN revision'))
        }
        if (revisionA === null && revisionB === null) {
          return err(invalidRequest('an SVN diff needs revisionB (single revision) or both revisionA and revisionB (range)'))
        }

        let filePath: string | undefined
        let target = root
        if (query.filePath !== undefined) {
          const normalized = normalizeRepoRelativePath(query.filePath)
          if (normalized === null) {
            return err({ code: 'path-not-allowed', message: 'filePath must be a repository-relative path inside the working copy', retryable: false })
          }
          const joined = joinRepoPath(root, normalized)
          if (joined === null) {
            return err({ code: 'path-not-allowed', message: 'filePath escapes the working copy root', retryable: false })
          }
          filePath = normalized
          target = joined
        }

        const argv = revisionA !== null && revisionB !== null
          ? buildDiffArgs(client.value, target, { range: { from: Number(revisionA), to: Number(revisionB) } })
          : buildDiffArgs(client.value, target, { revision: (revisionB ?? revisionA) as string })
        const maxBytes = clampInt(query.maxBytes, 1, HARD_DIFF_MAX_BYTES, DEFAULT_DIFF_MAX_BYTES)
        const run = await runSvn(argv, root, signal, { timeoutMs: DIFF_TIMEOUT_MS, maxBytes: DIFF_OUTPUT_CAP_BYTES })
        const combined = `${run.stdout}\n${run.stderr}`
        const binaryMarker = /Cannot display: file marked as a binary type/i.test(combined)
        if (run.exitCode !== 0) {
          if (binaryMarker) {
            return ok({
              repositoryId: requestedId,
              revisionA,
              revisionB,
              ...(filePath === undefined ? {} : { filePath }),
              text: '',
              truncated: false,
              binary: true,
              bytes: 0,
            })
          }
          return err(classifyFailure(run, 'svn diff failed', signal))
        }
        if (binaryMarker || run.stdout.includes('\0')) {
          return ok({
            repositoryId: requestedId,
            revisionA,
            revisionB,
            ...(filePath === undefined ? {} : { filePath }),
            text: '',
            truncated: false,
            binary: true,
            bytes: 0,
          })
        }
        const capped = truncateUtf8(run.stdout, maxBytes)
        const bytes = Buffer.byteLength(capped.text, 'utf8')
        return ok({
          repositoryId: requestedId,
          revisionA,
          revisionB,
          ...(filePath === undefined ? {} : { filePath }),
          text: capped.text,
          truncated: capped.truncated,
          ...(capped.truncated ? { truncationReason: `diff exceeds the ${maxBytes} byte limit` } : {}),
          binary: false,
          bytes,
        })
      } catch (error: unknown) {
        return err(internalError(error))
      }
    },

    async worktreeDiff(
      rootPath: string,
      repositoryIdValue: string,
      query: AdapterWorktreeDiffQuery,
      signal?: AbortSignal,
    ): Promise<AdapterResult<WorktreeDiffResult>> {
      try {
        if (query.staged === true) {
          // SVN has no index; a "staged" view would be an invented concept.
          return err(invalidRequest('SVN has no staging area; check the working copy instead'))
        }
        const requestedId = requireRepositoryId(repositoryIdValue)
        if (requestedId === null) return err(invalidRequest('repositoryId is required'))
        const client = await resolveClient()
        if (!client.ok) return client
        const root = resolveRoot(rootPath)
        if (root === null) return err(invalidRequest('repository root is required'))

        let filePath: string | undefined
        let target = root
        if (query.filePath !== undefined && query.filePath !== '') {
          const normalized = normalizeRepoRelativePath(query.filePath)
          if (normalized === null) {
            return err({ code: 'path-not-allowed', message: 'filePath must be a repository-relative path inside the working copy', retryable: false })
          }
          const joined = joinRepoPath(root, normalized)
          if (joined === null) {
            return err({ code: 'path-not-allowed', message: 'filePath escapes the working copy root', retryable: false })
          }
          filePath = normalized
          target = joined
        }

        const maxBytes = clampInt(query.maxBytes, 1, HARD_DIFF_MAX_BYTES, DEFAULT_DIFF_MAX_BYTES)
        const run = await runSvn(buildWorktreeDiffArgs(client.value, target), root, signal, {
          timeoutMs: DIFF_TIMEOUT_MS,
          maxBytes: DIFF_OUTPUT_CAP_BYTES,
        })
        const combined = `${run.stdout}\n${run.stderr}`
        const binaryMarker = /Cannot display: file marked as a binary type/i.test(combined)
        // A whole-working-copy diff may mix binary and text: keep the text and
        // only answer "binary" when one specific file was requested.
        const wholeSide = filePath === undefined
        if (run.exitCode !== 0) {
          if (binaryMarker && !wholeSide) {
            return ok({
              repositoryId: requestedId,
              filePath: filePath ?? null,
              staged: false,
              kind: 'tracked',
              text: '',
              truncated: false,
              binary: true,
              bytes: 0,
            })
          }
          return err(classifyFailure(run, 'svn diff failed', signal))
        }
        if ((binaryMarker && !wholeSide) || run.stdout.includes('\0')) {
          return ok({
            repositoryId: requestedId,
            filePath: filePath ?? null,
            staged: false,
            kind: 'tracked',
            text: '',
            truncated: false,
            binary: true,
            bytes: 0,
          })
        }
        const capped = truncateUtf8(run.stdout, maxBytes)
        return ok({
          repositoryId: requestedId,
          filePath: filePath ?? null,
          staged: false,
          kind: 'tracked',
          text: capped.text,
          truncated: capped.truncated,
          ...(capped.truncated ? { truncationReason: `diff exceeds the ${maxBytes} byte limit` } : {}),
          binary: false,
          bytes: Buffer.byteLength(capped.text, 'utf8'),
        })
      } catch (error: unknown) {
        return err(internalError(error))
      }
    },

    async status(
      rootPath: string,
      repositoryIdValue: string,
      signal?: AbortSignal,
    ): Promise<AdapterResult<WorkingTreeStatus>> {
      try {
        const requestedId = requireRepositoryId(repositoryIdValue)
        if (requestedId === null) return err(invalidRequest('repositoryId is required'))
        const client = await resolveClient()
        if (!client.ok) return client
        const root = resolveRoot(rootPath)
        if (root === null) return err(invalidRequest('repository root is required'))
        const statusResult = await readStatus(client.value, root, signal)
        if (!statusResult.ok) return statusResult
        const summary = statusResult.value

        const warnings = [...summary.warnings]
        let head: string | undefined
        const infoResult = await readInfo(client.value, root, signal)
        if (infoResult.ok) {
          head = infoResult.value.revision
        } else {
          warnings.push('the working copy base revision could not be read')
        }
        const workingTree: WorkingTreeStatus = {
          repositoryId: requestedId,
          vcsType: VCS_TYPE,
          clean: summary.changed === false,
          ...(head === undefined ? {} : { head }),
          entries: summary.entries,
          conflicts: summary.conflicts,
          ...(summary.truncated ? { truncated: true } : {}),
          ...(warnings.length > 0 ? { warnings } : {}),
        }
        return ok(workingTree)
      } catch (error: unknown) {
        return err(internalError(error))
      }
    },

    async beforeState(
      rootPath: string,
      _operation: OperationType,
      signal?: AbortSignal,
    ): Promise<AdapterResult<OperationBeforeState>> {
      try {
        const client = await resolveClient()
        if (!client.ok) return client
        const root = resolveRoot(rootPath)
        if (root === null) return err(invalidRequest('repository root is required'))
        const infoResult = await readInfo(client.value, root, signal)
        if (!infoResult.ok) return infoResult
        const statusResult = await readStatus(client.value, root, signal)
        if (!statusResult.ok) return statusResult
        const facts = infoResult.value
        const baseRevision = facts.revision
        // There is no staging area in SVN, so `stagedFiles` stays undefined.
        const before: OperationBeforeState = {
          ...(baseRevision === undefined ? {} : { revision: baseRevision }),
          ...(baseRevision === undefined ? {} : { head: baseRevision }),
          clean: statusResult.value.changed === false,
          ...(facts.url === undefined ? {} : { remoteUrls: [redactUrl(facts.url)] }),
        }
        return ok(before)
      } catch (error: unknown) {
        return err(internalError(error))
      }
    },

    async planOperation(
      rootPath: string,
      operation: OperationType,
      params: OperationParams,
      before: OperationBeforeState,
    ): Promise<AdapterResult<OperationPlan>> {
      try {
        const root = resolveRoot(rootPath)
        if (root === null) return err(invalidRequest('repository root is required'))
        const safeParams: OperationParams = typeof params === 'object' && params !== null ? params : {}
        const state = typeof before === 'object' && before !== null ? before : {}

        switch (operation) {
          case 'update': {
            const client = await resolveClient()
            if (!client.ok) return client
            const warnings: string[] = []
            if (state.clean === false) {
              warnings.push('the working copy has local modifications; svn update may produce conflicts, which are reported after it runs')
            }
            const summary = state.revision === undefined
              ? `update the SVN working copy at ${root}`
              : `update the SVN working copy at ${root} (base r${state.revision})`
            return ok({
              allowed: true,
              argv: buildUpdateArgs(client.value, root),
              cwd: root,
              summary,
              warnings,
              network: true,
            })
          }
          case 'commit': {
            const message = readCommitMessage(safeParams)
            if (!message.ok) return err(message.error)
            const paths = readCommitPaths(safeParams['paths'], root)
            if (!paths.ok) return err(paths.error)
            const client = await resolveClient()
            if (!client.ok) return client

            const targets = paths.value.length > 0 ? paths.value : [root]
            const warnings: string[] = []
            const statusResult = await readStatus(client.value, root, undefined)
            if (statusResult.ok) {
              if (statusResult.value.changed === false) {
                warnings.push('no local modifications were detected; svn commit has nothing to send')
              }
              if (statusResult.value.conflicts.length > 0) {
                warnings.push(`the working copy has ${statusResult.value.conflicts.length} conflicted path(s); commit may fail until they are resolved`)
              }
            } else {
              warnings.push('the working copy status could not be read; the commit will still be attempted')
            }
            if (paths.value.length === 0) {
              warnings.push('no explicit paths were given; every modified versioned path under the working copy root will be committed')
            }
            const preview = firstLine(message.value).slice(0, 80)
            const scope = paths.value.length > 0 ? `${paths.value.length} explicit path(s)` : 'all modified paths'
            const summary = preview === ''
              ? `commit ${scope} in ${root}`
              : `commit ${scope} in ${root}: ${preview}`
            return ok({
              allowed: true,
              argv: buildCommitArgs(client.value, message.value, targets),
              cwd: root,
              summary,
              warnings,
              network: true,
            })
          }
          case 'fetch':
          case 'pull':
          case 'push':
          case 'merge':
          case 'rebase':
            return ok({
              allowed: false,
              blockedReason: `${operation} is not applicable to an SVN working copy; use update to receive changes and commit to publish them`,
              argv: [],
              cwd: root,
              summary: `${operation} is not applicable to SVN`,
              warnings: [],
              network: false,
            })
          case 'switch':
            return ok({
              allowed: false,
              blockedReason: 'switch is not implemented in dsh-vcs-timeline v1',
              argv: [],
              cwd: root,
              summary: 'switch is not implemented in dsh-vcs-timeline v1',
              warnings: [],
              network: false,
            })
          case 'status':
          case 'diff':
            return ok({
              allowed: false,
              blockedReason: `${operation} is a read-only operation and is not planned as a write`,
              argv: [],
              cwd: root,
              summary: `${operation} is a read-only operation`,
              warnings: [],
              network: false,
            })
          default:
            return ok({
              allowed: false,
              blockedReason: 'operation is not implemented for SVN',
              argv: [],
              cwd: root,
              summary: 'operation is not implemented for SVN',
              warnings: [],
              network: false,
            })
        }
      } catch (error: unknown) {
        return err(internalError(error))
      }
    },
  }
}

/** Validate the commit message parameter. */
function readCommitMessage(params: OperationParams): { ok: true; value: string } | { ok: false; error: ApiError } {
  const raw = params['message']
  if (typeof raw !== 'string') {
    return { ok: false, error: invalidRequest('a commit message is required', 'params.message must be a non-empty string') }
  }
  if (raw.trim() === '') {
    return { ok: false, error: invalidRequest('a commit message is required', 'params.message must not be blank') }
  }
  if (raw.length > MAX_COMMIT_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: invalidRequest(`the commit message exceeds ${MAX_COMMIT_MESSAGE_LENGTH} characters`),
    }
  }
  return { ok: true, value: raw }
}

/**
 * Validate optional explicit commit paths and resolve them to absolute paths.
 * Absent means "commit everything under the root"; a provided but empty list
 * is refused rather than silently widened.
 */
function readCommitPaths(
  raw: unknown,
  root: string,
): { ok: true; value: string[] } | { ok: false; error: ApiError } {
  if (raw === undefined) return { ok: true, value: [] }
  let candidates: string[] = []
  if (Array.isArray(raw)) {
    candidates = raw.filter((entry): entry is string => typeof entry === 'string').map(entry => entry.trim()).filter(entry => entry !== '')
    if (candidates.length === 0) {
      return { ok: false, error: invalidRequest('the explicit commit path list is empty', 'pass no paths to commit every modified path') }
    }
  } else if (typeof raw === 'string') {
    if (raw.trim() === '') {
      return { ok: false, error: invalidRequest('the explicit commit path list is empty', 'pass no paths to commit every modified path') }
    }
    candidates = raw.split(',').map(entry => entry.trim()).filter(entry => entry !== '')
  } else {
    return { ok: false, error: invalidRequest('params.paths must be a comma-separated string or an array of strings') }
  }

  const targets: string[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const relative = normalizeRepoRelativePath(candidate)
    if (relative === null) {
      return {
        ok: false,
        error: {
          code: 'path-not-allowed',
          message: 'commit paths must be repository-relative and must stay inside the working copy',
          detail: safeErrorMessage(candidate, 200),
          retryable: false,
        },
      }
    }
    const joined = joinRepoPath(root, relative)
    if (joined === null) {
      return {
        ok: false,
        error: {
          code: 'path-not-allowed',
          message: 'commit paths must stay inside the working copy root',
          detail: safeErrorMessage(candidate, 200),
          retryable: false,
        },
      }
    }
    if (seen.has(joined)) continue
    seen.add(joined)
    targets.push(joined)
  }
  if (targets.length === 0) {
    return { ok: false, error: invalidRequest('the explicit commit path list is empty', 'pass no paths to commit every modified path') }
  }
  return { ok: true, value: targets }
}
