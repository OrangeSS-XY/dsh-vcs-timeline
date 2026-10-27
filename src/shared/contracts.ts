/**
 * dsh-vcs-timeline — cross-boundary contracts.
 *
 * Every type here crosses the Host/Client boundary over the plugin's `/vcs`
 * routes, and every persisted record carries `schemaVersion`. Times are ISO
 * 8601 UTC strings; repository-relative paths always use `/`.
 * @module dsh-vcs-timeline/shared/contracts
 */

/** Version stamped on every persisted record. */
export const SCHEMA_VERSION = 1 as const

/** Version stamped on every persisted record. */
export type SchemaVersion = typeof SCHEMA_VERSION

/** The version control systems this plugin understands. */
export type VcsType = 'git' | 'svn'

/** A repository this plugin can operate on. */
export interface Repository {
  schemaVersion: SchemaVersion
  /** Stable id derived from the canonical root path and VCS type. */
  id: string
  vcsType: VcsType
  /** Local absolute path of the repository root. */
  rootPath: string
  displayName: string
  /** Remote URLs with embedded credentials stripped. */
  remoteUrls?: string[]
  /** Git: the repository default branch (when known). */
  defaultBranch?: string
  /** Git: the checked-out branch; SVN: omitted. */
  currentBranch?: string
  /** Git HEAD hash or SVN base revision, for display only. */
  currentRevision?: string
  detectedAt: string
  lastSeenAt: string
}

/** Kinds of timeline events. Only `commit` comes from repository history. */
export type VcsEventType =
  | 'commit'
  | 'push'
  | 'fetch'
  | 'pull'
  | 'update'
  | 'merge'
  | 'rebase'
  | 'branch'
  | 'tag'
  | 'switch'
  | 'unknown'

/** Where an event's facts came from. */
export type EventSource = 'repository' | 'plugin-audit' | 'external-observation'

/** One timeline entry. */
export interface VcsEvent {
  schemaVersion: SchemaVersion
  id: string
  repositoryId: string
  vcsType: VcsType
  eventType: VcsEventType
  source: EventSource
  timestamp: string
  actor?: string
  summary: string
  /** SVN revision number, as a string. */
  revision?: string
  /** Git commit hash. */
  commitHash?: string
  /** Git parent hashes. */
  parentHashes?: string[]
  branch?: string
  /** Remote name or URL with credentials stripped. */
  remote?: string
  beforeRevision?: string
  afterRevision?: string
  changeSetId?: string
  operationAttemptId?: string
  outcome?: 'success' | 'failure' | 'partial' | 'unknown'
  externalObservationConfidence?: 'confirmed' | 'inferred'
  metadata?: Record<string, string | number | boolean | null>
}

/** Per-file change classification. */
export type FileChangeStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'type-changed'
  | 'unknown'

/** One changed file inside a {@link ChangeSet}. */
export interface ChangedFile {
  /** Repository-relative path using `/`. */
  path: string
  /** Previous path for renames and copies. */
  oldPath?: string
  status: FileChangeStatus
  additions?: number
  deletions?: number
  binary?: boolean
}

/** The full file list of one revision plus metadata. */
export interface ChangeSet {
  schemaVersion: SchemaVersion
  id: string
  repositoryId: string
  vcsType: VcsType
  /** Git commit hash or SVN revision string. */
  revision: string
  parentRevision?: string
  createdAt: string
  files: ChangedFile[]
  truncated?: boolean
  truncationReason?: string
}

/** Operations the plugin may perform. */
export type OperationType =
  | 'status'
  | 'diff'
  | 'commit'
  | 'push'
  | 'fetch'
  | 'pull'
  | 'update'
  | 'merge'
  | 'rebase'
  | 'switch'
  | 'unknown'

/** Lifecycle of one operation attempt. */
export type OperationState =
  | 'started'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'partial'
  | 'unknown'

/** One audited operation attempt. Audit records are append-only. */
export interface OperationAttempt {
  schemaVersion: SchemaVersion
  id: string
  repositoryId: string
  vcsType: VcsType
  operation: OperationType
  state: OperationState
  startedAt: string
  finishedAt?: string
  actor: 'user-via-plugin'
  /** Sanitized, secret-free description of the request. */
  requestSummary: string
  beforeRevision?: string
  afterRevision?: string
  changedPaths?: string[]
  exitCode?: number
  errorCode?: string
  safeErrorMessage?: string
  outputSummary?: string
  remoteOutcome?: 'confirmed-success' | 'confirmed-failure' | 'unknown'
  correlationId: string
}

/** Stable, UI-facing error codes. */
export type ApiErrorCode =
  | 'invalid-request'
  | 'unknown-repository'
  | 'path-not-allowed'
  | 'vcs-not-installed'
  | 'not-a-repository'
  | 'timeout'
  | 'output-too-large'
  | 'conflict'
  | 'operation-failed'
  | 'operation-blocked'
  | 'confirmation-required'
  | 'confirmation-invalid'
  | 'storage-failure'
  | 'network-unknown'
  | 'internal'

/** One Host error, safe to show in the Client. */
export interface ApiError {
  code: ApiErrorCode
  message: string
  detail?: string
  retryable?: boolean
}

/** Envelope carried by every `/vcs` JSON response. */
export type ApiEnvelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApiError }

/** Filter and paging input for {@link TimelineQuery}. */
export interface TimelineQuery {
  repositoryId: string
  eventTypes?: VcsEventType[]
  author?: string
  text?: string
  since?: string
  until?: string
  cursor?: string | null
  /** Requested page size; the Host clamps it. */
  limit?: number
}

/** One page of timeline events. */
export interface TimelinePage {
  events: VcsEvent[]
  nextCursor: string | null
  hasMore: boolean
  /** True when some source failed and the page is a partial view. */
  partial?: boolean
  warnings?: string[]
}

/** Filter and paging input for the operation audit. */
export interface OperationQuery {
  repositoryId?: string
  cursor?: string | null
  limit?: number
}

/** One page of audit attempts, newest first, one folded record per id. */
export interface OperationPage {
  operations: OperationAttempt[]
  nextCursor: string | null
  hasMore: boolean
  warnings?: string[]
}

/** Diff request. */
export interface DiffQuery {
  repositoryId: string
  /** Older side; for a single commit diff omit both. */
  revisionA?: string
  /** Newer side; for one commit pass only this. */
  revisionB?: string
  /** Restricts the diff to one repository-relative file. */
  filePath?: string
  contextLines?: number
  maxBytes?: number
}

/** One diff, as plain text. */
export interface DiffResult {
  repositoryId: string
  revisionA: string | null
  revisionB: string | null
  filePath?: string
  /** Unified diff text (never HTML). */
  text: string
  truncated: boolean
  truncationReason?: string
  binary: boolean
  bytes: number
}

/** One working-tree entry. */
export interface WorkingTreeEntry {
  path: string
  /** Git index status letter (A/M/D/R/...); SVN item status. */
  status: string
  /** Git worktree status letter, when different from `status`. */
  worktreeStatus?: string
  staged?: boolean
}

/** Working-tree snapshot of one repository. */
export interface WorkingTreeStatus {
  repositoryId: string
  vcsType: VcsType
  clean: boolean
  branch?: string
  head?: string
  entries: WorkingTreeEntry[]
  conflicts: string[]
  truncated?: boolean
  warnings?: string[]
}

/** Toolchain and environment diagnostics shown in the panel footer. */
export interface Diagnostics {
  pluginVersion: string
  dshVersion: string | null
  platform: string
  dataDir: string
  gitVersion: string | null
  svnVersion: string | null
  workspaceCount: number
  warnings: string[]
}

/** Repository discovery result. */
export interface RepositoryList {
  repositories: Repository[]
  diagnostics: Diagnostics
}

/** State read before a write operation, used for preview and audit. */
export interface OperationBeforeState {
  branch?: string
  revision?: string
  head?: string
  clean?: boolean
  stagedFiles?: string[]
  remoteUrls?: string[]
  ahead?: number
  behind?: number
}

/** Preview of one pending write operation. */
export interface OperationPreview {
  repositoryId: string
  operation: OperationType
  allowed: boolean
  blockedReason?: string
  /** Human-readable summary of what will happen. */
  summary: string
  /** Sanitized argv for display; never a shell string. */
  argv: string[]
  before: OperationBeforeState
  warnings: string[]
  /** Single-use token required by the execute call. */
  confirmationToken: string
  expiresAt: string
}

/** Input for previewing one write operation. */
export interface OperationRequest {
  repositoryId: string
  operation: OperationType
  params?: Record<string, string | number | boolean>
  confirmationToken?: string
}

/** Response body of one successful `/vcs` call. */
export interface VcsApi {
  diagnostics(): Promise<Diagnostics>
  listRepositories(workspacePath: string | null): Promise<RepositoryList>
  addRepository(path: string): Promise<Repository>
  removeRepository(repositoryId: string): Promise<{ removed: boolean }>
  repository(repositoryId: string): Promise<Repository>
  timeline(query: TimelineQuery): Promise<TimelinePage>
  changeSet(repositoryId: string, revision: string): Promise<ChangeSet>
  diff(query: DiffQuery): Promise<DiffResult>
  status(repositoryId: string): Promise<WorkingTreeStatus>
  previewOperation(request: OperationRequest): Promise<OperationPreview>
  executeOperation(request: OperationRequest): Promise<OperationAttempt>
  listOperations(query: OperationQuery): Promise<OperationPage>
  getOperation(operationId: string): Promise<OperationAttempt>
}

/** Largest timeline page the Host will serve. */
export const MAX_PAGE_SIZE = 100
/** Default timeline page size. */
export const DEFAULT_PAGE_SIZE = 30
/** Largest diff the Host will serve, in bytes. */
export const DEFAULT_DIFF_MAX_BYTES = 256 * 1024
/** Hard ceiling for a requested diff. */
export const HARD_DIFF_MAX_BYTES = 2 * 1024 * 1024

/** Runtime guard for {@link ApiError}. */
export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.code === 'string' && typeof record.message === 'string'
}

/** Runtime guard for {@link Repository}. */
export function isRepository(value: unknown): value is Repository {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === SCHEMA_VERSION
    && typeof record.id === 'string'
    && (record.vcsType === 'git' || record.vcsType === 'svn')
    && typeof record.rootPath === 'string'
    && typeof record.displayName === 'string'
}

/** Runtime guard for {@link ChangeSet}. */
export function isChangeSet(value: unknown): value is ChangeSet {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === SCHEMA_VERSION
    && typeof record.id === 'string'
    && typeof record.revision === 'string'
    && Array.isArray(record.files)
}

/** Runtime guard for {@link TimelinePage}. */
export function isTimelinePage(value: unknown): value is TimelinePage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.events) && (record.nextCursor === null || typeof record.nextCursor === 'string')
}

/** Runtime guard for {@link DiffResult}. */
export function isDiffResult(value: unknown): value is DiffResult {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.text === 'string' && typeof record.truncated === 'boolean' && typeof record.binary === 'boolean'
}

/** Runtime guard for {@link WorkingTreeStatus}. */
export function isWorkingTreeStatus(value: unknown): value is WorkingTreeStatus {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.clean === 'boolean' && Array.isArray(record.entries) && Array.isArray(record.conflicts)
}

/** Runtime guard for {@link OperationAttempt}. */
export function isOperationAttempt(value: unknown): value is OperationAttempt {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return record.schemaVersion === SCHEMA_VERSION
    && typeof record.id === 'string'
    && typeof record.operation === 'string'
    && typeof record.state === 'string'
    && typeof record.correlationId === 'string'
}

/** Runtime guard for {@link OperationPage}. */
export function isOperationPage(value: unknown): value is OperationPage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.operations) && (record.nextCursor === null || typeof record.nextCursor === 'string')
}

/** Runtime guard for {@link Diagnostics}. */
export function isDiagnostics(value: unknown): value is Diagnostics {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.pluginVersion === 'string' && typeof record.dataDir === 'string' && Array.isArray(record.warnings)
}

/** Whether an operation mutates repository state. */
export function isWriteOperation(operation: OperationType): boolean {
  switch (operation) {
    case 'fetch':
    case 'pull':
    case 'update':
    case 'commit':
    case 'push':
      return true
    default:
      return false
  }
}
