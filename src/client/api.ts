/**
 * dsh-vcs-timeline — browser API client for the Host `/vcs` routes.
 *
 * Every method posts one JSON body to a document-relative path and returns a
 * discriminated result instead of throwing, so a dead route, a dropped
 * connection, or a malformed envelope becomes a normal error state in the
 * panel rather than an unhandled rejection. Runtime guards from
 * `shared/contracts.ts` reject payloads that do not match the wire contract.
 * @module dsh-vcs-timeline/client/api
 */

import {
  isApiError,
  isChangeSet,
  isDiffResult,
  isDiagnostics,
  isOperationAttempt,
  isOperationPage,
  isBranchCompare,
  isPullRequestDetail,
  isPullRequestList,
  isRepository,
  isTimelinePage,
  isWorkingTreeStatus,
} from '../shared/contracts.ts'
import type {
  ApiError,
  ApiErrorCode,
  ChangeSet,
  Diagnostics,
  DiffQuery,
  DiffResult,
  OperationAttempt,
  OperationPage,
  OperationPreview,
  OperationQuery,
  OperationRequest,
  BranchCompare,
  BranchCompareQuery,
  PullRequestDetail,
  PullRequestDetailQuery,
  PullRequestList,
  PullRequestQuery,
  Repository,
  RepositoryList,
  TimelinePage,
  TimelineQuery,
  WorkingTreeStatus,
} from '../shared/contracts.ts'

/** Minimal response face the client needs from `fetch`. */
export interface FetchResponseLike {
  json(): Promise<unknown>
}

/** Minimal fetch face, stubbable in tests. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponseLike>

/** Result of one Host call: the value or a stable error, never a throw. */
export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApiError }

/** The complete read/write surface this panel consumes. */
export interface VcsClient {
  diagnostics(): Promise<ApiResult<Diagnostics>>
  listRepositories(workspacePath: string | null): Promise<ApiResult<RepositoryList>>
  addRepository(path: string): Promise<ApiResult<Repository>>
  repository(repositoryId: string): Promise<ApiResult<Repository>>
  timeline(query: TimelineQuery): Promise<ApiResult<TimelinePage>>
  changeSet(repositoryId: string, revision: string): Promise<ApiResult<ChangeSet>>
  diff(query: DiffQuery): Promise<ApiResult<DiffResult>>
  status(repositoryId: string): Promise<ApiResult<WorkingTreeStatus>>
  previewOperation(request: OperationRequest): Promise<ApiResult<OperationPreview>>
  executeOperation(request: OperationRequest): Promise<ApiResult<OperationAttempt>>
  listOperations(query: OperationQuery): Promise<ApiResult<OperationPage>>
  getOperation(operationId: string): Promise<ApiResult<OperationAttempt>>
  listPullRequests(query: PullRequestQuery): Promise<ApiResult<PullRequestList>>
  pullRequestDetail(query: PullRequestDetailQuery): Promise<ApiResult<PullRequestDetail>>
  branchCompare(query: BranchCompareQuery): Promise<ApiResult<BranchCompare>>
}

/** Stable codes the Host may return; anything else is folded into `internal`. */
const KNOWN_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  'invalid-request',
  'unknown-repository',
  'path-not-allowed',
  'vcs-not-installed',
  'not-a-repository',
  'timeout',
  'output-too-large',
  'conflict',
  'operation-failed',
  'operation-blocked',
  'confirmation-required',
  'confirmation-invalid',
  'storage-failure',
  'network-unknown',
  'unsupported-remote',
  'auth-required',
  'rate-limited',
  'internal',
])

/** Error used when a payload does not satisfy the wire contract. */
function invalidResponse(): ApiError {
  return { code: 'internal', message: 'invalid-response' }
}

/** Error used when the request never reached the Host route. */
function hostUnavailable(): ApiError {
  return { code: 'network-unknown', message: 'host-unavailable', retryable: true }
}

/** Fold any error payload into a stable, UI-safe {@link ApiError}. */
export function normalizeApiError(value: unknown): ApiError {
  if (isApiError(value) && KNOWN_CODES.has(value.code)) {
    const error: ApiError = { code: value.code, message: value.message }
    if (typeof value.detail === 'string' && value.detail !== '') error.detail = value.detail
    if (typeof value.retryable === 'boolean') error.retryable = value.retryable
    return error
  }
  return { code: 'internal', message: 'invalid-error-payload' }
}

/** Whether a value is the `{repositories, diagnostics}` discovery payload. */
function isRepositoryList(value: unknown): value is RepositoryList {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.repositories) && isDiagnostics(record.diagnostics)
}

/** Whether a value is an operation preview. */
function isOperationPreview(value: unknown): value is OperationPreview {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.allowed === 'boolean'
    && Array.isArray(record.argv)
    && typeof record.confirmationToken === 'string'
    && typeof record.summary === 'string'
}

/** Whether a value is the `{removed}` add/remove payload. */
function isRemovedResult(value: unknown): value is { removed: boolean } {
  return typeof value === 'object'
    && value !== null
    && typeof (value as Record<string, unknown>).removed === 'boolean'
}

/** One typed request against a path in the Host route family. */
async function post(
  fetchImpl: FetchLike,
  path: string,
  body: Record<string, unknown>,
): Promise<ApiResult<unknown>> {
  let response: FetchResponseLike
  try {
    response = await fetchImpl(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, error: hostUnavailable() }
  }

  let envelope: unknown
  try {
    envelope = await response.json()
  } catch {
    return { ok: false, error: invalidResponse() }
  }

  if (typeof envelope !== 'object' || envelope === null) {
    return { ok: false, error: invalidResponse() }
  }
  const record = envelope as Record<string, unknown>
  if (record.ok === true) {
    return { ok: true, value: record.value }
  }
  if (record.ok === false) {
    return { ok: false, error: normalizeApiError(record.error) }
  }
  return { ok: false, error: invalidResponse() }
}

/** Wrap an untyped responder with a payload guard. */
async function guarded<T>(
  pending: Promise<ApiResult<unknown>>,
  guard: (value: unknown) => value is T,
): Promise<ApiResult<T>> {
  const result = await pending
  if (!result.ok) return result
  return guard(result.value) ? { ok: true, value: result.value } : { ok: false, error: invalidResponse() }
}

/** Create the client bound to one fetch implementation. */
export function createVcsApi(fetchImpl: FetchLike): VcsClient {
  return {
    diagnostics: () => guarded(post(fetchImpl, 'vcs/diagnostics', {}), isDiagnostics),

    listRepositories: (workspacePath) => guarded(
      post(fetchImpl, 'vcs/repos/list', { workspacePath }),
      isRepositoryList,
    ),

    addRepository: (path) => guarded(
      post(fetchImpl, 'vcs/repos/add', { path }),
      isRepository,
    ),

    repository: (repositoryId) => guarded(
      post(fetchImpl, 'vcs/repository', { repositoryId }),
      isRepository,
    ),

    timeline: (query) => guarded(
      post(fetchImpl, 'vcs/timeline', { ...query }),
      isTimelinePage,
    ),

    changeSet: (repositoryId, revision) => guarded(
      post(fetchImpl, 'vcs/changeset', { repositoryId, revision }),
      isChangeSet,
    ),

    diff: (query) => guarded(
      post(fetchImpl, 'vcs/diff', { ...query }),
      isDiffResult,
    ),

    status: (repositoryId) => guarded(
      post(fetchImpl, 'vcs/status', { repositoryId }),
      isWorkingTreeStatus,
    ),

    previewOperation: (request) => guarded(
      post(fetchImpl, 'vcs/op/preview', { ...request }),
      isOperationPreview,
    ),

    executeOperation: (request) => guarded(
      post(fetchImpl, 'vcs/op/execute', { ...request }),
      isOperationAttempt,
    ),

    listOperations: (query) => guarded(
      post(fetchImpl, 'vcs/op/list', { ...query }),
      isOperationPage,
    ),

    getOperation: (operationId) => guarded(
      post(fetchImpl, 'vcs/op/get', { operationId }),
      isOperationAttempt,
    ),

    listPullRequests: (query) => guarded(
      post(fetchImpl, 'vcs/pr/list', { ...query }),
      isPullRequestList,
    ),

    pullRequestDetail: (query) => guarded(
      post(fetchImpl, 'vcs/pr/detail', { ...query }),
      isPullRequestDetail,
    ),

    branchCompare: (query) => guarded(
      post(fetchImpl, 'vcs/branch/compare', { ...query }),
      isBranchCompare,
    ),
  }
}

/** The repository add route (kept separate: not part of the read loop). */
export async function addRepositoryVia(
  fetchImpl: FetchLike,
  path: string,
): Promise<ApiResult<Repository>> {
  return guarded(post(fetchImpl, 'vcs/repos/add', { path }), isRepository)
}

/** The repository remove route. */
export async function removeRepositoryVia(
  fetchImpl: FetchLike,
  repositoryId: string,
): Promise<ApiResult<{ removed: boolean }>> {
  return guarded(post(fetchImpl, 'vcs/repos/remove', { repositoryId }), isRemovedResult)
}
