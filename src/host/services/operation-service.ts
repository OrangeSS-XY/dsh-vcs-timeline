/**
 * Write-path services: preview a mutating VCS operation, execute it under a
 * single-use confirmation token, and record the attempt in the append-only
 * audit before anything runs.
 *
 * Safety properties implemented here:
 *  - only fetch / pull / update / commit / push exist; anything else is
 *    refused by the adapters;
 *  - a preview token is single-use, TTL-bounded, and bound to the exact
 *    repository, operation, parameters, and argv;
 *  - the argv is planned again at execute time and must match the previewed
 *    argv, so a repository state change between the two steps aborts instead
 *    of running something the user did not see;
 *  - one in-flight write per repository;
 *  - an audit record is persisted before the process starts, and a terminal
 *    record afterwards, including for failures and unknown remote outcomes.
 * @module dsh-vcs-timeline/host/services/operation-service
 */

import { randomBytes } from 'node:crypto'
import type {
  OperationAttempt,
  OperationPage,
  OperationPreview,
  OperationQuery,
  OperationRequest,
  OperationState,
  OperationType,
  VcsEvent,
} from '../../shared/contracts.ts'
import { SCHEMA_VERSION } from '../../shared/contracts.ts'
import { isWriteOperation } from '../../shared/contracts.ts'
import type { OperationBeforeState, OperationParams } from '../adapters/types.ts'
import type { Runner } from '../adapters/types.ts'
import type { AuditService } from '../audit/types.ts'
import { displayArgv, safeErrorMessage } from '../security.ts'
import type { TimelineStore } from '../storage/interface.ts'
import { fail, ServiceError, type RepositoryResolver } from './timeline-service.ts'

/** How long a preview token stays valid. */
export const PREVIEW_TTL_MS = 120_000
/** Maximum number of outstanding preview tokens. */
const MAX_PENDING_PREVIEWS = 32
/** Timeout for network operations. */
export const NETWORK_OPERATION_TIMEOUT_MS = 180_000
/** Timeout for local operations. */
export const LOCAL_OPERATION_TIMEOUT_MS = 60_000
/** Output cap for one operation command. */
const OPERATION_OUTPUT_CAP = 2 * 1024 * 1024

/** One previewed, not-yet-executed operation. */
interface PendingOperation {
  repositoryId: string
  operation: OperationType
  paramsHash: string
  argv: string[]
  summary: string
  network: boolean
  before: OperationBeforeState
  expiresAt: number
}

/** Dependencies of the write service. */
export interface OperationServiceDeps {
  resolver: RepositoryResolver
  runner: Runner
  store: TimelineStore
  audit: AuditService
  now?: () => Date
  log?: (message: string) => void
}

/** Write service surface. */
export interface OperationService {
  preview(request: OperationRequest): Promise<OperationPreview>
  execute(request: OperationRequest): Promise<OperationAttempt>
  listOperations(query: OperationQuery): Promise<OperationPage>
  getOperation(id: string): Promise<OperationAttempt>
}

/** Stable hash of operation parameters (sorted keys, JSON). */
function paramsHash(params: OperationParams | undefined): string {
  if (params === undefined) return ''
  const keys = Object.keys(params).sort()
  return JSON.stringify(keys.map(key => [key, params[key]]))
}

/** Normalize caller parameters to the adapter's allowed scalar values. */
export function normalizeParams(raw: unknown): OperationParams {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const params: OperationParams = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') params[key] = value.slice(0, 4000)
    else if (typeof value === 'number' && Number.isFinite(value)) params[key] = value
    else if (typeof value === 'boolean') params[key] = value
    else if (Array.isArray(value)) params[key] = value.filter((entry): entry is string => typeof entry === 'string').slice(0, 500).join(',')
  }
  return params
}

/** A short, secret-free summary of command output for the audit. */
function outputSummary(stdout: string, stderr: string): string {
  const text = `${stdout}\n${stderr}`.trim()
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '').slice(0, 12).join('\n')
  return lines.slice(0, 2000)
}

/** Whether a command line mentions a missing executable. */
function looksMissingTool(message: string): boolean {
  return /ENOENT|not found|not recognized|无法将|cannot find/i.test(message)
}

/** Map one operation name to its event type. */
function eventTypeOf(operation: OperationType): VcsEvent['eventType'] {
  switch (operation) {
    case 'fetch': return 'fetch'
    case 'pull': return 'pull'
    case 'update': return 'update'
    case 'commit': return 'commit'
    case 'push': return 'push'
    default: return 'unknown'
  }
}

/** Map an operation state to an event outcome. */
function eventOutcome(state: OperationState): VcsEvent['outcome'] {
  switch (state) {
    case 'succeeded': return 'success'
    case 'failed': return 'failure'
    case 'partial': return 'partial'
    default: return 'unknown'
  }
}

/**
 * Create the write service.
 * @param deps - resolver, runner, store, audit, clock, logger.
 * @returns the service.
 */
export function createOperationService(deps: OperationServiceDeps): OperationService {
  const now = deps.now ?? (() => new Date())
  const pending = new Map<string, PendingOperation>()
  const inFlight = new Set<string>()

  const pruneExpired = (): void => {
    const current = now().getTime()
    for (const [token, value] of pending) {
      if (value.expiresAt <= current) pending.delete(token)
    }
    while (pending.size > MAX_PENDING_PREVIEWS) {
      const oldest = pending.keys().next()
      if (oldest.done === true) break
      pending.delete(oldest.value)
    }
  }

  const appendEvent = async (attempt: OperationAttempt): Promise<void> => {
    const event: VcsEvent = {
      schemaVersion: SCHEMA_VERSION,
      id: `evt-${randomBytes(8).toString('hex')}`,
      repositoryId: attempt.repositoryId,
      vcsType: attempt.vcsType,
      eventType: eventTypeOf(attempt.operation),
      source: 'plugin-audit',
      timestamp: attempt.finishedAt ?? attempt.startedAt,
      actor: 'user-via-plugin',
      summary: `${attempt.operation} ${attempt.state}`,
      ...(attempt.beforeRevision === undefined ? {} : { beforeRevision: attempt.beforeRevision }),
      ...(attempt.afterRevision === undefined ? {} : { afterRevision: attempt.afterRevision }),
      operationAttemptId: attempt.id,
      outcome: eventOutcome(attempt.state),
      metadata: { exitCode: attempt.exitCode ?? null },
    }
    try {
      await deps.store.appendEvent(event)
    } catch (error: unknown) {
      deps.log?.(`dsh-vcs-timeline: audit event append failed: ${safeErrorMessage(error)}`)
    }
  }

  return {
    async preview(request) {
      if (typeof request !== 'object' || request === null) fail('invalid-request', 'request is required')
      if (!isWriteOperation(request.operation)) {
        fail('invalid-request', `operation ${String(request.operation)} is not a supported write operation`)
      }
      const operation = request.operation
      const resolved = await deps.resolver.resolve(request.repositoryId)
      if (!resolved.ok) throw new ServiceError(resolved.error)
      const { repository, root, adapter } = resolved.value
      const params = normalizeParams(request.params)
      const beforeResult = await adapter.beforeState(root, operation)
      if (!beforeResult.ok) throw new ServiceError(beforeResult.error)
      const before = beforeResult.value
      const planResult = await adapter.planOperation(root, operation, params, before)
      if (!planResult.ok) throw new ServiceError(planResult.error)
      const plan = planResult.value
      pruneExpired()

      if (!plan.allowed) {
        return {
          repositoryId: repository.id,
          operation,
          allowed: false,
          ...(plan.blockedReason === undefined ? {} : { blockedReason: plan.blockedReason }),
          summary: plan.summary,
          argv: displayArgv(plan.argv),
          before,
          warnings: plan.warnings,
          confirmationToken: '',
          expiresAt: now().toISOString(),
        }
      }

      const token = randomBytes(24).toString('hex')
      const expiresAtMs = now().getTime() + PREVIEW_TTL_MS
      pending.set(token, {
        repositoryId: repository.id,
        operation,
        paramsHash: paramsHash(params),
        argv: plan.argv,
        summary: plan.summary,
        network: plan.network,
        before,
        expiresAt: expiresAtMs,
      })
      return {
        repositoryId: repository.id,
        operation,
        allowed: true,
        summary: plan.summary,
        argv: displayArgv(plan.argv),
        before,
        warnings: plan.warnings,
        confirmationToken: token,
        expiresAt: new Date(expiresAtMs).toISOString(),
      }
    },

    async execute(request) {
      if (typeof request !== 'object' || request === null) fail('invalid-request', 'request is required')
      const token = typeof request.confirmationToken === 'string' ? request.confirmationToken : ''
      if (token === '') fail('confirmation-required', 'a preview and its confirmation token are required')
      pruneExpired()
      const preview = pending.get(token)
      if (preview === undefined) {
        fail('confirmation-invalid', 'the confirmation token is unknown, used, or expired; preview again')
      }
      pending.delete(token)
      if (preview.expiresAt <= now().getTime()) {
        fail('confirmation-invalid', 'the confirmation token expired; preview again')
      }
      if (!isWriteOperation(request.operation) || preview.operation !== request.operation) {
        fail('confirmation-invalid', 'the confirmation token belongs to a different operation')
      }
      if (preview.repositoryId !== request.repositoryId) {
        fail('confirmation-invalid', 'the confirmation token belongs to a different repository')
      }
      if (preview.paramsHash !== paramsHash(normalizeParams(request.params))) {
        fail('confirmation-invalid', 'the operation parameters changed after preview; preview again')
      }
      if (inFlight.has(preview.repositoryId)) {
        fail('operation-blocked', 'another operation is already running on this repository')
      }

      const resolved = await deps.resolver.resolve(request.repositoryId)
      if (!resolved.ok) throw new ServiceError(resolved.error)
      const { repository, root, adapter } = resolved.value

      // Re-plan against current state: running an argv the user never saw is
      // exactly the failure mode this check prevents.
      const beforeResult = await adapter.beforeState(root, preview.operation)
      if (!beforeResult.ok) throw new ServiceError(beforeResult.error)
      const before = beforeResult.value
      const planResult = await adapter.planOperation(root, preview.operation, normalizeParams(request.params), before)
      if (!planResult.ok) throw new ServiceError(planResult.error)
      if (!planResult.value.allowed) {
        fail('operation-blocked', planResult.value.blockedReason ?? 'operation is not allowed in the current state')
      }
      if (JSON.stringify(planResult.value.argv) !== JSON.stringify(preview.argv)) {
        fail('confirmation-invalid', 'repository state changed after preview; preview again')
      }

      inFlight.add(repository.id)
      let attempt: OperationAttempt
      try {
        attempt = await deps.audit.start({
          repositoryId: repository.id,
          vcsType: repository.vcsType,
          operation: preview.operation,
          requestSummary: preview.summary,
          before,
        })
      } catch (error: unknown) {
        inFlight.delete(repository.id)
        throw new ServiceError({
          code: 'storage-failure',
          message: 'the operation was not started because its audit record could not be written',
          detail: safeErrorMessage(error),
        })
      }

      const timeoutMs = preview.network ? NETWORK_OPERATION_TIMEOUT_MS : LOCAL_OPERATION_TIMEOUT_MS
      const result = await deps.runner.run(planResult.value.argv, root, { timeoutMs, maxBytes: OPERATION_OUTPUT_CAP })
      let after: OperationBeforeState = before
      try {
        const afterResult = await adapter.beforeState(root, preview.operation)
        if (afterResult.ok) after = afterResult.value
      } catch {
        // A best-effort after-state must never mask the command outcome.
      }

      let state: OperationState
      let remoteOutcome: OperationAttempt['remoteOutcome']
      let errorCode: string | undefined
      if (result.spawnFailed === true) {
        state = 'failed'
        errorCode = looksMissingTool(result.failureMessage ?? '') ? 'vcs-not-installed' : 'operation-failed'
      } else if (result.exitCode === 0) {
        state = 'succeeded'
        if (preview.network) remoteOutcome = 'confirmed-success'
      } else if (result.timedOut === true || result.exitCode === null) {
        // The remote side may or may not have applied the change; never claim
        // a definite result.
        state = preview.network ? 'unknown' : 'failed'
        errorCode = 'timeout'
        if (preview.network) remoteOutcome = 'unknown'
      } else {
        state = 'failed'
        errorCode = 'operation-failed'
        if (preview.network) remoteOutcome = 'confirmed-failure'
      }

      const summaryText = outputSummary(result.stdout, result.stderr)
      const failedText = result.exitCode === 0
        ? undefined
        : safeErrorMessage(result.failureMessage ?? result.stderr ?? 'the command failed', 500)

      try {
        const finished = await deps.audit.finish(attempt, {
          state: state as 'succeeded' | 'failed' | 'partial' | 'unknown',
          exitCode: result.exitCode,
          ...(errorCode === undefined ? {} : { errorCode }),
          ...(failedText === undefined ? {} : { safeErrorMessage: failedText }),
          ...(summaryText === '' ? {} : { outputSummary: summaryText }),
          after,
          ...(before.stagedFiles === undefined ? {} : { changedPaths: before.stagedFiles }),
          ...(remoteOutcome === undefined ? {} : { remoteOutcome }),
        })
        attempt = finished
      } catch (error: unknown) {
        deps.log?.(`dsh-vcs-timeline: audit finish failed: ${safeErrorMessage(error)}`)
      } finally {
        inFlight.delete(repository.id)
      }
      await appendEvent(attempt)
      return attempt
    },

    async listOperations(query) {
      return deps.store.queryOperations(query ?? {})
    },

    async getOperation(id) {
      if (typeof id !== 'string' || id === '') fail('invalid-request', 'operationId is required')
      const attempt = await deps.store.getOperation(id)
      if (attempt === undefined) fail('invalid-request', 'unknown operation id')
      return attempt
    },
  }
}
