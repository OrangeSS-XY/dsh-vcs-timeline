/**
 * `/vcs/*` route family: one POST JSON envelope per call.
 *
 * Transport hardening: loopback-only (the desktop UI), POST + JSON
 * content-type only, a same-origin check when the browser sends `Origin`, and
 * a bounded request body. Every handler maps domain errors to a stable code
 * and never returns a stack trace.
 * @module dsh-vcs-timeline/host/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ApiEnvelope,
  ApiError,
  Diagnostics,
  OperationQuery,
  OperationRequest,
  TimelineQuery,
  VcsEventType,
} from '../shared/contracts.ts'
import { MAX_PAGE_SIZE } from '../shared/contracts.ts'
import { clampInt, safeErrorMessage } from './security.ts'
import { StoreError } from './storage/interface.ts'
import { ServiceError, type TimelineService } from './services/timeline-service.ts'
import type { OperationService } from './services/operation-service.ts'
import type { PullRequestService } from './pr/service.ts'
import type { BranchService } from './branch/service.ts'

/** Largest accepted request body. */
const BODY_MAX_BYTES = 256 * 1024

/** Dependencies of the route family. */
export interface VcsRoutesDeps {
  timeline: TimelineService
  operations: OperationService
  pullRequests: PullRequestService
  branch: BranchService
  diagnostics: () => Promise<Diagnostics>
  log?: (message: string) => void
}

/** Write one JSON payload. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/** Success envelope. */
function ok<T>(value: T): ApiEnvelope<T> {
  return { ok: true, value }
}

/** Error envelope. */
function fail(error: ApiError): ApiEnvelope<never> {
  return { ok: false, error }
}

/** Bounded JSON object body reader. */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > BODY_MAX_BYTES) {
      req.destroy()
      return null
    }
    chunks.push(buffer)
  }
  if (size === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

/** Whether a socket address is loopback. */
function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Same-origin check for browser requests that carry an Origin header. */
function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Read a required string field. */
function requiredString(payload: Record<string, unknown>, key: string, max = 512): string {
  const value = payload[key]
  if (typeof value !== 'string' || value === '') {
    throw new ServiceError({ code: 'invalid-request', message: `${key} is required` })
  }
  return value.slice(0, max)
}

/** Read an optional string field. */
function optionalString(payload: Record<string, unknown>, key: string, max = 4096): string | undefined {
  const value = payload[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new ServiceError({ code: 'invalid-request', message: `${key} must be a string` })
  }
  return value.slice(0, max)
}

/** Read an optional page size. */
function optionalLimit(payload: Record<string, unknown>): number | undefined {
  const value = payload.limit
  if (value === undefined || value === null) return undefined
  return clampInt(value, 1, MAX_PAGE_SIZE, 30)
}

/** Read an optional boolean field. */
function optionalBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') {
    throw new ServiceError({ code: 'invalid-request', message: `${key} must be a boolean` })
  }
  return value
}

/** Read a required positive integer (pull-request number). */
function requiredPositiveInt(payload: Record<string, unknown>, key: string): number {
  const value = payload[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 1_000_000_000) {
    throw new ServiceError({ code: 'invalid-request', message: `${key} must be a positive integer` })
  }
  return value
}

/** Build a timeline query from a request payload. */
function timelineQuery(payload: Record<string, unknown>): TimelineQuery {
  const eventTypes = payload.eventTypes
  const cursor = payload.cursor
  const author = optionalString(payload, 'author', 200)
  const text = optionalString(payload, 'text', 200)
  const since = optionalString(payload, 'since', 64)
  const until = optionalString(payload, 'until', 64)
  const limit = optionalLimit(payload)
  const includeFiles = optionalBoolean(payload, 'includeFiles')
  return {
    repositoryId: requiredString(payload, 'repositoryId', 1024),
    ...(Array.isArray(eventTypes)
      ? { eventTypes: eventTypes.filter((entry): entry is VcsEventType => typeof entry === 'string') }
      : {}),
    ...(author === undefined ? {} : { author }),
    ...(text === undefined ? {} : { text }),
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
    ...(typeof cursor === 'string' && cursor !== '' ? { cursor } : {}),
    ...(limit === undefined ? {} : { limit }),
    ...(includeFiles === undefined ? {} : { includeFiles }),
  }
}

/** Build an operation request from a request payload. */
function operationRequest(payload: Record<string, unknown>): OperationRequest {
  const operation = requiredString(payload, 'operation', 32)
  const params = payload.params
  const token = optionalString(payload, 'confirmationToken', 256)
  return {
    repositoryId: requiredString(payload, 'repositoryId', 1024),
    operation: operation as OperationRequest['operation'],
    ...(params === undefined ? {} : { params: params as Record<string, string | number | boolean> }),
    ...(token === undefined ? {} : { confirmationToken: token }),
  }
}

/** Build an audit query from a request payload. */
function operationQuery(payload: Record<string, unknown>): OperationQuery {
  const repositoryId = optionalString(payload, 'repositoryId', 1024)
  const cursor = optionalString(payload, 'cursor', 256)
  return {
    ...(repositoryId === undefined ? {} : { repositoryId }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(optionalLimit(payload) === undefined ? {} : { limit: optionalLimit(payload)! }),
  }
}

/**
 * Register the `/vcs` routes.
 * @param ctx - Host context carrying `webServer`.
 * @param deps - read/write services and diagnostics.
 * @returns the route disposer.
 */
export function registerVcsRoutes(ctx: Context, deps: VcsRoutesDeps): () => void {
  const log = deps.log ?? ((message: string) => ctx.logger.warn(message))

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isLoopbackAddress(req.socket.remoteAddress) && !isLoopbackAddress(req.socket.localAddress)) {
      writeJson(res, 403, fail({ code: 'path-not-allowed', message: 'this route family is loopback-only' }))
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    if (!isSameOrigin(req)) {
      writeJson(res, 403, fail({ code: 'path-not-allowed', message: 'cross-origin request rejected' }))
      return
    }
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
    if (!contentType.startsWith('application/json')) {
      res.writeHead(415)
      res.end()
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    const payload = await readJsonBody(req)
    if (payload === null) {
      writeJson(res, 200, fail({ code: 'invalid-request', message: 'malformed request body' }))
      return
    }

    try {
      switch (pathname) {
        case '/vcs/diagnostics':
          writeJson(res, 200, ok(await deps.diagnostics()))
          return
        case '/vcs/repos/list': {
          const workspacePath = optionalString(payload, 'workspacePath', 4096) ?? null
          const value = await deps.timeline.listRepositories(workspacePath)
          writeJson(res, 200, ok(value))
          return
        }
        case '/vcs/repos/add':
          writeJson(res, 200, ok(await deps.timeline.addRepository(requiredString(payload, 'path', 4096))))
          return
        case '/vcs/repos/remove':
          writeJson(res, 200, ok(await deps.timeline.removeRepository(requiredString(payload, 'repositoryId', 1024))))
          return
        case '/vcs/repository':
          writeJson(res, 200, ok(await deps.timeline.repository(requiredString(payload, 'repositoryId', 1024))))
          return
        case '/vcs/timeline':
          writeJson(res, 200, ok(await deps.timeline.timeline(timelineQuery(payload))))
          return
        case '/vcs/changeset': {
          const revision = requiredString(payload, 'revision', 128)
          writeJson(res, 200, ok(await deps.timeline.changeSet(requiredString(payload, 'repositoryId', 1024), revision)))
          return
        }
        case '/vcs/diff': {
          const repositoryId = requiredString(payload, 'repositoryId', 1024)
          const revisionA = optionalString(payload, 'revisionA', 128)
          const revisionB = optionalString(payload, 'revisionB', 128)
          const filePath = optionalString(payload, 'filePath', 4096)
          const contextLines = payload.contextLines
          const maxBytes = payload.maxBytes
          writeJson(res, 200, ok(await deps.timeline.diff({
            repositoryId,
            ...(revisionA === undefined ? {} : { revisionA }),
            ...(revisionB === undefined ? {} : { revisionB }),
            ...(filePath === undefined ? {} : { filePath }),
            ...(typeof contextLines === 'number' ? { contextLines } : {}),
            ...(typeof maxBytes === 'number' ? { maxBytes } : {}),
          })))
          return
        }
        case '/vcs/status':
          writeJson(res, 200, ok(await deps.timeline.status(requiredString(payload, 'repositoryId', 1024))))
          return
        case '/vcs/op/preview':
          writeJson(res, 200, ok(await deps.operations.preview(operationRequest(payload))))
          return
        case '/vcs/op/execute':
          writeJson(res, 200, ok(await deps.operations.execute(operationRequest(payload))))
          return
        case '/vcs/op/list':
          writeJson(res, 200, ok(await deps.operations.listOperations(operationQuery(payload))))
          return
        case '/vcs/op/get':
          writeJson(res, 200, ok(await deps.operations.getOperation(requiredString(payload, 'operationId', 128))))
          return
        case '/vcs/pr/list': {
          const refresh = optionalBoolean(payload, 'refresh')
          writeJson(res, 200, ok(await deps.pullRequests.list({
            repositoryId: requiredString(payload, 'repositoryId', 1024),
            ...(refresh === undefined ? {} : { refresh }),
          })))
          return
        }
        case '/vcs/pr/detail':
          writeJson(res, 200, ok(await deps.pullRequests.detail({
            repositoryId: requiredString(payload, 'repositoryId', 1024),
            number: requiredPositiveInt(payload, 'number'),
          })))
          return
        case '/vcs/branch/compare': {
          const baseBranch = optionalString(payload, 'baseBranch', 200)
          writeJson(res, 200, ok(await deps.branch.compare({
            repositoryId: requiredString(payload, 'repositoryId', 1024),
            ...(baseBranch === undefined || baseBranch.trim() === '' ? {} : { baseBranch: baseBranch.trim() }),
          })))
          return
        }
        default:
          res.writeHead(404)
          res.end()
      }
    } catch (error: unknown) {
      if (error instanceof ServiceError) {
        writeJson(res, 200, fail(error.toApiError()))
        return
      }
      if (error instanceof StoreError) {
        writeJson(res, 200, fail({ code: 'storage-failure', message: 'the plugin data store failed', detail: safeErrorMessage(error, 300) }))
        return
      }
      log(`dsh-vcs-timeline: ${pathname} failed: ${safeErrorMessage(error)}`)
      writeJson(res, 200, fail({ code: 'internal', message: 'unexpected host error' }))
    }
  }

  return ctx.webServer.register({ kind: 'prefix', path: '/vcs', handler: handle })
}
