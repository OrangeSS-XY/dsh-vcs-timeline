/**
 * Session attribution service.
 *
 * Answers "which files did the current session's tool calls touch?" by reading
 * the live session log through `ctx.sessions` and pairing every file-writing
 * `tool/call` with its `tool/result`. Two rules keep it honest:
 *
 *  - only a successful result counts (a failed edit changed nothing), and
 *  - every row is `confidence: 'inferred'`: the evidence is the tool arguments,
 *    not a commit, so the UI must label it as an inference.
 *
 * A session that is not live in this Host process is reported as unavailable;
 * the Host never guesses from an archived log format.
 * @module dsh-vcs-timeline/host/session/changes
 */

import { isAbsolute, relative, resolve } from 'node:path'
import type { SessionChangedFile, SessionChanges, SessionChangesQuery } from '../../shared/contracts.ts'
import { MAX_SESSION_FILES } from '../../shared/contracts.ts'
import { isInside } from '../security.ts'
import { ServiceError, type RepositoryResolver } from '../services/timeline-service.ts'

/** Tool names observed to write repository files. Anything else is ignored. */
export const MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set([
  'write',
  'edit',
  'multiedit',
  'apply_patch',
  'write_file',
  'create_file',
  'str_replace',
  'patch',
])

/** Argument keys that carry a file path in file-writing tool calls. */
export const FILE_PATH_ARG_KEYS: readonly string[] = ['file_path', 'filePath', 'path', 'target_file', 'filename']

/** Minimal shape of one session event the service reads. */
export interface SessionEventLike {
  type?: unknown
  seq?: unknown
  time?: unknown
  data?: {
    name?: unknown
    arguments?: unknown
    callId?: unknown
    message?: {
      toolCallId?: unknown
      isError?: unknown
    }
  }
}

/** Minimal live-session shape (the real `Session` satisfies it). */
export interface LiveSessionLike {
  snapshotEvents(): readonly SessionEventLike[]
  header?: {
    cwd?: unknown
  }
}

/** Minimal live-session store shape (the real `SessionStore` satisfies it). */
export interface LiveSessionStoreLike {
  get(id: string): LiveSessionLike | undefined
}

/** Dependencies of the session attribution service. */
export interface SessionChangesServiceDeps {
  resolver: RepositoryResolver
  /** Resolved lazily: the session store is a Host service, not a plugin record. */
  sessions: () => LiveSessionStoreLike | undefined
  now?: () => Date
}

/** Read surface used by `POST /vcs/session/changes`. */
export interface SessionChangesService {
  changes(query: SessionChangesQuery): Promise<SessionChanges>
}

/** Read the first string file path out of one tool-call argument object. */
function readFilePathArgument(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  for (const key of FILE_PATH_ARG_KEYS) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return null
}

/** Whether one tool call succeeded: it needs a paired, non-error result. */
function callSucceeded(event: SessionEventLike, results: ReadonlyMap<string, boolean>): boolean {
  const callId = event.data?.callId
  if (typeof callId !== 'string') return false
  const failed = results.get(callId)
  return failed === false
}

/**
 * Create the session attribution service.
 * @param deps - gated resolver, session-store accessor, optional clock.
 * @returns the service.
 */
export function createSessionChangesService(deps: SessionChangesServiceDeps): SessionChangesService {
  const now = deps.now ?? (() => new Date())

  return {
    async changes(query) {
      const resolved = await deps.resolver.resolve(query.repositoryId)
      if (!resolved.ok) throw new ServiceError(resolved.error)
      const { repository, root } = resolved.value
      const sessionId = typeof query.sessionId === 'string' && query.sessionId !== '' ? query.sessionId : null
      const generatedAt = now().toISOString()
      const base = {
        repositoryId: repository.id,
        sessionId,
        generatedAt,
      }
      if (sessionId === null) {
        return {
          ...base,
          available: false,
          files: [],
          warnings: ['no session id was provided; session attribution needs the current session'],
        }
      }
      const store = deps.sessions()
      const session = store === undefined ? undefined : store.get(sessionId)
      if (session === undefined) {
        return {
          ...base,
          available: false,
          files: [],
          warnings: ['the session is not live in this Host process; archived sessions are not read'],
        }
      }
      const cwd = typeof session.header?.cwd === 'string' && session.header.cwd !== '' ? session.header.cwd : null
      const events = session.snapshotEvents()
      // Pair results first: an edit that failed must not be attributed.
      const results = new Map<string, boolean>()
      for (const event of events) {
        if (event.type !== 'tool/result') continue
        const callId = event.data?.message?.toolCallId
        if (typeof callId !== 'string') continue
        results.set(callId, event.data?.message?.isError === true)
      }
      const byPath = new Map<string, SessionChangedFile>()
      let truncated = false
      for (const event of events) {
        if (event.type !== 'tool/call') continue
        const tool = typeof event.data?.name === 'string' ? event.data.name : ''
        if (!MUTATING_TOOL_NAMES.has(tool.toLowerCase())) continue
        if (!callSucceeded(event, results)) continue
        const rawPath = readFilePathArgument(event.data?.arguments)
        if (rawPath === null) continue
        const absolute = isAbsolute(rawPath)
          ? resolve(rawPath)
          : cwd === null ? null : resolve(cwd, rawPath)
        if (absolute === null || !isInside(root, absolute)) continue
        const repoPath = relative(root, absolute).replace(/\\/g, '/')
        if (repoPath === '' || repoPath.startsWith('../')) continue
        const at = typeof event.time === 'number' && Number.isFinite(event.time)
          ? new Date(event.time).toISOString()
          : undefined
        const previous = byPath.get(repoPath)
        if (previous === undefined) {
          if (byPath.size >= MAX_SESSION_FILES) {
            truncated = true
            continue
          }
          byPath.set(repoPath, {
            path: repoPath,
            tool,
            touches: 1,
            ...(at === undefined ? {} : { lastToolAt: at }),
            confidence: 'inferred',
          })
          continue
        }
        byPath.set(repoPath, {
          ...previous,
          tool,
          touches: previous.touches + 1,
          ...(at === undefined ? {} : { lastToolAt: at }),
        })
      }
      const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
      const warnings: string[] = []
      if (files.length === 0) warnings.push('no successful file-writing tool calls were found in this session')
      if (truncated) warnings.push(`only the first ${MAX_SESSION_FILES} touched paths are reported`)
      return {
        ...base,
        available: true,
        files,
        ...(truncated ? { truncated: true } : {}),
        ...(warnings.length === 0 ? {} : { warnings }),
      }
    },
  }
}
