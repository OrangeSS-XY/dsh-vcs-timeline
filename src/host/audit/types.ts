/**
 * Audit seam: the only writer of {@link OperationAttempt} lifecycle records.
 *
 * Audits are append-only. `start` persists a `started` record before any
 * command runs; `finish` persists the terminal state as a new record with the
 * same id. Readers fold by id, so a crash between the two leaves the truthful
 * `started` record in place.
 * @module dsh-vcs-timeline/host/audit/types
 */

import type {
  OperationAttempt,
  OperationBeforeState,
  OperationState,
  OperationType,
  VcsType,
} from '../../shared/contracts.ts'

/** Input for the pre-execution audit record. */
export interface AuditStartInput {
  repositoryId: string
  vcsType: VcsType
  operation: OperationType
  /** Secret-free description of the request. */
  requestSummary: string
  before?: OperationBeforeState
  /** Caller-supplied correlation id; generated when omitted. */
  correlationId?: string
}

/** Terminal outcome of one attempt. */
export interface AuditFinishInput {
  state: Exclude<OperationState, 'started' | 'running'>
  exitCode?: number | null
  errorCode?: string
  safeErrorMessage?: string
  outputSummary?: string
  after?: OperationBeforeState
  changedPaths?: string[]
  remoteOutcome?: 'confirmed-success' | 'confirmed-failure' | 'unknown'
}

/** Audit writer used by the operation service. */
export interface AuditService {
  /** Persist a `started` record and return it. */
  start(input: AuditStartInput): Promise<OperationAttempt>
  /** Persist the terminal record for `attempt`. */
  finish(attempt: OperationAttempt, input: AuditFinishInput): Promise<OperationAttempt>
}
