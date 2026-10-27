/**
 * Append-only audit writer.
 *
 * One operation attempt produces exactly two records with the same `id` and
 * `correlationId`: a `started` record appended **before** the command runs and
 * a terminal record appended afterwards. Readers fold by id, so a crash in
 * between leaves the truthful `started` record behind.
 *
 * The `started` record is written through {@link TimelineStore.appendOperation}
 * and only then returned. If that append fails the caller gets a
 * {@link StoreError} and must refuse to run the operation — an unaudited write
 * operation is never allowed.
 *
 * Records never carry secrets: `requestSummary`, `outputSummary` and
 * `safeErrorMessage` pass through `redactText` and are length-bounded before
 * they reach the store. The store redacts again as defence in depth.
 * @module dsh-vcs-timeline/host/audit/audit-service
 */

import { randomBytes } from 'node:crypto'
import { SCHEMA_VERSION } from '../../shared/contracts.ts'
import type {
  OperationAttempt,
  OperationBeforeState,
  OperationState,
} from '../../shared/contracts.ts'
import { redactText } from '../security.ts'
import type { TimelineStore } from '../storage/interface.ts'
import { StoreError } from '../storage/interface.ts'
import type { AuditFinishInput, AuditService, AuditStartInput } from './types.ts'

/** Options for {@link createAuditService}. */
export interface AuditServiceOptions {
  /** Injectable clock, for deterministic tests. Must return a valid `Date`. */
  now?: () => Date
}

/** Maximum stored request summary length. */
const REQUEST_SUMMARY_MAX = 500

/** Maximum stored output summary length. */
const OUTPUT_SUMMARY_MAX = 2000

/** How many leading output lines are kept in `outputSummary`. */
const OUTPUT_SUMMARY_LINES = 20

/** Maximum stored error message length. */
const SAFE_ERROR_MAX = 500

/** Maximum stored error code length. */
const ERROR_CODE_MAX = 120

/** Maximum stored correlation id length. */
const CORRELATION_ID_MAX = 200

/** Maximum stored revision length. */
const REVISION_MAX = 200

/** Maximum number of changed paths kept on one record. */
const CHANGED_PATHS_MAX = 200

/** Maximum length of one changed path. */
const CHANGED_PATH_MAX = 500

/** Terminal states a finish call may report. */
const TERMINAL_STATES: readonly OperationState[] = ['succeeded', 'failed', 'partial', 'unknown']

/** Redact + truncate one free-text field. */
function boundedText(raw: string, max: number): string {
  const redacted = redactText(raw).replace(/\u0000/g, '')
  return redacted.length > max ? `${redacted.slice(0, max - 1)}…` : redacted
}

/** One-line, redacted, bounded error text. */
function boundedErrorText(raw: string): string {
  return boundedText(raw.replace(/\s+/g, ' ').trim(), SAFE_ERROR_MAX)
}

/** Redacted output summary: the leading lines only, then bounded. */
function summariseOutput(raw: string): string {
  const redacted = redactText(raw).replace(/\u0000/g, '')
  const head = redacted.split(/\r?\n/).slice(0, OUTPUT_SUMMARY_LINES).join('\n').trim()
  return boundedText(head, OUTPUT_SUMMARY_MAX)
}

/** Wrap any store failure into a {@link StoreError} with a secret-free message. */
function asStoreError(action: string, error: unknown): StoreError {
  if (error instanceof StoreError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new StoreError(`audit: ${action} could not be persisted: ${boundedText(message, 200)}`, 'storage-failure')
}

/** Concatenate two optional strings into a `fallback`-to-`primary` order. */
function pickRevision(state: OperationBeforeState | undefined): string | undefined {
  if (typeof state !== 'object' || state === null) return undefined
  for (const candidate of [state.revision, state.head]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim().slice(0, REVISION_MAX)
  }
  return undefined
}

/** Copy valid changed paths, bounded and de-duplicated. */
function capChangedPaths(paths: readonly unknown[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const candidate of paths) {
    if (typeof candidate !== 'string') continue
    const path = candidate.trim()
    if (path === '' || seen.has(path)) continue
    seen.add(path)
    result.push(path.slice(0, CHANGED_PATH_MAX))
    if (result.length >= CHANGED_PATHS_MAX) break
  }
  return result
}

/**
 * Create the audit writer.
 *
 * @param store - append-only store the records go to.
 * @param options - optional injectable clock.
 * @returns the audit service used by the operation service.
 * @throws {StoreError} when the store or the injected clock is unusable.
 */
export function createAuditService(store: TimelineStore, options: AuditServiceOptions = {}): AuditService {
  if (typeof store !== 'object' || store === null || typeof store.appendOperation !== 'function') {
    throw new StoreError('audit service requires a store with appendOperation', 'invalid-request')
  }
  const injected = typeof options === 'object' && options !== null ? options.now : undefined
  if (injected !== undefined && typeof injected !== 'function') {
    throw new StoreError('audit service clock must be a function returning a Date', 'invalid-request')
  }

  /** Current instant; rejects garbage from an injected clock. */
  const now = (): Date => {
    const value = injected === undefined ? new Date() : injected()
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new StoreError('audit service clock returned an invalid date', 'storage-failure')
    }
    return value
  }

  const nowIso = (): string => now().toISOString()

  return {
    async start(input: AuditStartInput): Promise<OperationAttempt> {
      if (typeof input !== 'object' || input === null) {
        throw new StoreError('audit start requires an input object', 'invalid-request')
      }
      const repositoryId = typeof input.repositoryId === 'string' ? input.repositoryId.trim() : ''
      if (repositoryId === '') {
        throw new StoreError('audit start requires a repositoryId', 'invalid-request')
      }
      if (input.vcsType !== 'git' && input.vcsType !== 'svn') {
        throw new StoreError('audit start requires a vcsType of git or svn', 'invalid-request')
      }
      const operation = typeof input.operation === 'string' ? input.operation.trim() : ''
      if (operation === '') {
        throw new StoreError('audit start requires an operation', 'invalid-request')
      }

      const startedAt = nowIso()
      const requestSummary = boundedText(typeof input.requestSummary === 'string' ? input.requestSummary : '', REQUEST_SUMMARY_MAX)
      const suppliedCorrelation = typeof input.correlationId === 'string' ? input.correlationId.trim() : ''
      const correlationId = suppliedCorrelation === ''
        ? `corr-${randomBytes(16).toString('hex')}`
        : suppliedCorrelation.slice(0, CORRELATION_ID_MAX)
      const beforeRevision = pickRevision(input.before)

      const attempt: OperationAttempt = {
        schemaVersion: SCHEMA_VERSION,
        id: `op-${randomBytes(8).toString('hex')}`,
        repositoryId,
        vcsType: input.vcsType,
        operation: input.operation,
        state: 'started',
        startedAt,
        actor: 'user-via-plugin',
        requestSummary,
        correlationId,
        ...(beforeRevision === undefined ? {} : { beforeRevision }),
      }

      // Persist before returning: the caller must not run an unaudited operation.
      try {
        await store.appendOperation(attempt)
      } catch (error: unknown) {
        throw asStoreError('started record', error)
      }
      return attempt
    },

    async finish(attempt: OperationAttempt, input: AuditFinishInput): Promise<OperationAttempt> {
      if (typeof attempt !== 'object' || attempt === null || typeof attempt.id !== 'string' || attempt.id.trim() === '') {
        throw new StoreError('audit finish requires the started attempt record', 'invalid-request')
      }
      if (typeof input !== 'object' || input === null) {
        throw new StoreError('audit finish requires an input object', 'invalid-request')
      }
      if (!TERMINAL_STATES.includes(input.state)) {
        throw new StoreError('audit finish requires a terminal state', 'invalid-request')
      }

      // A new record: the started record on disk is never rewritten.
      const record: OperationAttempt = {
        ...attempt,
        schemaVersion: SCHEMA_VERSION,
        state: input.state,
        startedAt: attempt.startedAt,
        finishedAt: nowIso(),
      }

      if (typeof input.exitCode === 'number' && Number.isFinite(input.exitCode)) {
        record.exitCode = Math.trunc(input.exitCode)
      } else {
        delete record.exitCode
      }

      if (typeof input.errorCode === 'string' && input.errorCode.trim() !== '') {
        record.errorCode = boundedText(input.errorCode.trim(), ERROR_CODE_MAX)
      } else {
        delete record.errorCode
      }

      if (typeof input.safeErrorMessage === 'string' && input.safeErrorMessage.trim() !== '') {
        record.safeErrorMessage = boundedErrorText(input.safeErrorMessage)
      } else {
        delete record.safeErrorMessage
      }

      if (typeof input.outputSummary === 'string' && input.outputSummary.trim() !== '') {
        record.outputSummary = summariseOutput(input.outputSummary)
      } else {
        delete record.outputSummary
      }

      const afterRevision = pickRevision(input.after)
      if (afterRevision !== undefined) {
        record.afterRevision = afterRevision
      } else {
        delete record.afterRevision
      }

      if (Array.isArray(input.changedPaths)) {
        const changedPaths = capChangedPaths(input.changedPaths)
        if (changedPaths.length > 0) record.changedPaths = changedPaths
        else delete record.changedPaths
      } else {
        delete record.changedPaths
      }

      if (input.remoteOutcome === 'confirmed-success' || input.remoteOutcome === 'confirmed-failure' || input.remoteOutcome === 'unknown') {
        record.remoteOutcome = input.remoteOutcome
      } else {
        delete record.remoteOutcome
      }

      try {
        await store.appendOperation(record)
      } catch (error: unknown) {
        throw asStoreError('terminal record', error)
      }
      return record
    },
  }
}
