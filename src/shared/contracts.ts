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
  /**
   * Files this commit changed, in the order the VCS reported them.
   *
   * Present only when the query asked for them (`includeFiles`); a repository
   * history page without that flag never carries a file list, so the Client
   * cannot mistake "not asked for" for "changed nothing".
   */
  changedFiles?: ChangedFile[]
  /** True when the commit changed more files than {@link MAX_EVENT_FILES}. */
  changedFilesTruncated?: boolean
}

/** Most changed files one timeline event carries; the rest sets `changedFilesTruncated`. */
export const MAX_EVENT_FILES = 200

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
  | 'stage'
  | 'unstage'
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
  | 'unsupported-remote'
  | 'auth-required'
  | 'rate-limited'
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
  /**
   * Ask the Host to attach each commit's changed files to its event.
   *
   * The file-centered browser needs one commit's file list to build the tree
   * and to filter by path; the Host answers it from the same history window as
   * the rest of the page.
   */
  includeFiles?: boolean
  /**
   * Restrict history to one branch/ref. The Host validates the name as a
   * branch and uses it as the `git log <ref>` revision, never as a client-side
   * guess; SVN reports a warning instead of pretending branch semantics.
   */
  branch?: string
  /** `all` = every branch, `current` (default) = HEAD only. */
  branchScope?: 'current' | 'all'
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

/** Hosting providers this plugin understands for pull/merge requests. */
export type PullRequestProvider = 'github' | 'gitlab' | 'unknown'

/** Lifecycle state of one pull request. */
export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed'

/** Aggregated review state of one pull request. */
export type PullRequestReviewState = 'approved' | 'changes-requested' | 'review-required' | 'none'

/** Aggregated CI/status-check state of one pull request head. */
export type PullRequestChecksState = 'success' | 'failure' | 'pending' | 'none'

/** One actor (author, reviewer, assignee) as the provider reports it. */
export interface PullRequestActor {
  /** Provider login/handle, stable identity for dedupe. */
  login: string
  /** Human display name when the provider exposes one. */
  displayName?: string
}

/** One review verdict on a pull request. */
export interface PullRequestReview {
  author: PullRequestActor
  state: 'approved' | 'changes-requested' | 'commented' | 'pending' | 'dismissed'
  submittedAt?: string
}

/** One CI check / status context of the pull request head. */
export interface PullRequestCheck {
  name: string
  state: 'success' | 'failure' | 'pending' | 'neutral'
  url?: string
}

/**
 * What the viewer should do next about one pull request.
 *
 * The Host derives this only from facts it actually read (requested reviewers,
 * review decision, CI state, mergeability); when the provider did not supply
 * the fact, the action is `unknown` with a hint instead of a guess.
 */
export type PullRequestActionKind =
  | 'review'
  | 'address-feedback'
  | 'merge'
  | 'fix-ci'
  | 'fix-conflicts'
  | 'push'
  | 'create-pr'
  | 'pull'
  | 'sync'
  | 'wait'
  | 'unknown'

/** One suggested next action, with the reason it was suggested. */
export interface PullRequestAction {
  kind: PullRequestActionKind
  /** Localization key suffix; the Client owns the wording. */
  reason: string
}

/** One pull request summary. */
export interface PullRequest {
  schemaVersion: SchemaVersion
  id: string
  repositoryId: string
  provider: PullRequestProvider
  number: number
  title: string
  url: string
  state: PullRequestState
  author: PullRequestActor
  /** Head branch name. */
  branch: string
  /** Base/target branch name. */
  baseBranch: string
  createdAt: string
  updatedAt: string
  /** Provider merge timestamp; present for merged PRs when the provider reports it. */
  mergedAt?: string
  /** Provider close timestamp; present for closed PRs when the provider reports it. */
  closedAt?: string
  reviewState: PullRequestReviewState
  checksState: PullRequestChecksState
  /** True/false from the provider; null when it did not report mergeability. */
  mergeable: boolean | null
  reviews: PullRequestReview[]
  checks: PullRequestCheck[]
  /** Reviewers whose review is still pending. */
  pendingReviewers: PullRequestActor[]
  /** Whether the current viewer's review is explicitly requested. */
  requestedFromViewer: boolean
  /** Suggested next actions, ordered by urgency. */
  actions: PullRequestAction[]
  changedFiles?: number
  additions?: number
  deletions?: number
  commitCount?: number
  commentCount?: number
  /** Free-form provider data the UI may show verbatim (e.g. labels). */
  labels?: string[]
}

/** One page of pull requests plus what the Host could and could not read. */
export interface PullRequestList {
  repositoryId: string
  provider: PullRequestProvider
  /** Remote host (never credentials). */
  host: string
  /** Owner/namespace + repository path on the host. */
  remotePath: string
  /** Viewer login when the Host could authenticate; null for anonymous. */
  viewer: string | null
  /** True when the Host authenticated (richer facts: reviews, CI, mergeable). */
  authenticated: boolean
  pullRequests: PullRequest[]
  /**
   * How far back merged/closed pull requests were requested for the analytics
   * dashboard, in days. Absent when history was not included.
   */
  closedWindowDays?: number
  /** True when the provider cap cut the merged/closed side of the list. */
  historyTruncated?: boolean
  /** True when some provider data could not be read. */
  partial?: boolean
  warnings?: string[]
  fetchedAt: string
}

/** One changed file of a pull request. */
export interface PullRequestFile {
  path: string
  oldPath?: string
  status: FileChangeStatus
  additions?: number
  deletions?: number
  binary?: boolean
}

/** One pull request with its changed-file list. */
export interface PullRequestDetail {
  pullRequest: PullRequest
  files: PullRequestFile[]
  /** Raw description/body, truncated by the Host. */
  body?: string
  truncated?: boolean
  warnings?: string[]
}

/** Input of one pull-request list request. */
export interface PullRequestQuery {
  repositoryId: string
  /** Bypass the Host cache (the refresh button). */
  refresh?: boolean
  /**
   * Also read recently merged/closed pull requests, so the client can show the
   * analytics dashboard (merge readiness, conflicts, merged counts, authors).
   * Defaults to true; the Host clamps the window.
   */
  includeClosed?: boolean
  /** How far back merged/closed history is requested, in days. */
  windowDays?: number
}

/** Input of one pull-request detail request. */
export interface PullRequestDetailQuery {
  repositoryId: string
  number: number
}

/** One commit of the local branch insight (newest first). */
export interface BranchCompareCommit {
  hash: string
  summary: string
  author?: string
  timestamp: string
}

/** Input of one local branch-insight request. */
export interface BranchCompareQuery {
  repositoryId: string
  /** Base/target branch; defaults to the repository's default/main branch. */
  baseBranch?: string
}

/**
 * Local branch insight: what the current branch still carries relative to its
 * base/target. It is computed with git only (no provider API), so the PR tab
 * still says something useful when the remote is unreachable or unconfigured.
 */
export interface BranchCompare {
  repositoryId: string
  vcsType: VcsType
  currentBranch: string | null
  baseBranch: string | null
  /** False when this VCS/repo cannot be compared locally (e.g. SVN branches). */
  available: boolean
  /** Why the local comparison is unavailable, when it is. */
  unsupportedReason?: string
  /** Commits on the current branch that the base branch does not contain. */
  ahead: number
  /** Commits on the base branch that the current branch does not contain. */
  behind: number
  commits: BranchCompareCommit[]
  filesChanged: number
  additions?: number
  deletions?: number
  /** Paths both sides changed (potential conflicts); null when unknown. */
  conflictPaths: string[] | null
  /** Commits ahead of the configured upstream; null when no upstream exists. */
  unpushed: number | null
  hasUpstream: boolean
  /** Suggested local next steps (push / create-pr / pull / sync / wait). */
  actions: PullRequestAction[]
  warnings?: string[]
  computedAt: string
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
  /** Diff of the working tree (unstaged or staged side). */
  worktreeDiff(query: WorktreeDiffQuery): Promise<WorktreeDiffResult>
  /** Pre-commit rule findings over a real diff. */
  checks(query: ChecksQuery): Promise<ChecksReport>
  /** Files the current session's tool calls touched, marked inferred. */
  sessionChanges(query: SessionChangesQuery): Promise<SessionChanges>
  /** File hotspot ranking over a bounded commit window. */
  statsHotspots(query: HotspotQuery): Promise<HotspotReport>
  status(repositoryId: string): Promise<WorkingTreeStatus>
  previewOperation(request: OperationRequest): Promise<OperationPreview>
  executeOperation(request: OperationRequest): Promise<OperationAttempt>
  listOperations(query: OperationQuery): Promise<OperationPage>
  getOperation(operationId: string): Promise<OperationAttempt>
  listPullRequests(query: PullRequestQuery): Promise<PullRequestList>
  pullRequestDetail(query: PullRequestDetailQuery): Promise<PullRequestDetail>
  branchCompare(query: BranchCompareQuery): Promise<BranchCompare>
}

/** Largest pull-request page the Host will serve. */
export const MAX_PULL_REQUESTS = 40
/** How long one pull-request list stays fresh in the Host cache, in ms. */
export const PULL_REQUEST_CACHE_MS = 60_000
/** Days of merged/closed pull-request history the analytics dashboard reads. */
export const DEFAULT_PR_HISTORY_DAYS = 30
/** Upper bound the Host clamps a requested history window to. */
export const MAX_PR_HISTORY_DAYS = 90
/** Most merged/closed pull requests one list read carries. */
export const MAX_CLOSED_PULL_REQUESTS = 40

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

/** Runtime guard for {@link PullRequestList}. */
export function isPullRequestList(value: unknown): value is PullRequestList {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.repositoryId === 'string'
    && (record.provider === 'github' || record.provider === 'gitlab' || record.provider === 'unknown')
    && Array.isArray(record.pullRequests)
    && typeof record.fetchedAt === 'string'
}

/** Runtime guard for {@link BranchCompare}. */
export function isBranchCompare(value: unknown): value is BranchCompare {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.repositoryId === 'string'
    && typeof record.ahead === 'number'
    && typeof record.behind === 'number'
    && Array.isArray(record.commits)
    && typeof record.available === 'boolean'
}

/** Runtime guard for {@link PullRequestDetail}. */
export function isPullRequestDetail(value: unknown): value is PullRequestDetail {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  const pr = record.pullRequest
  return typeof pr === 'object'
    && pr !== null
    && typeof (pr as Record<string, unknown>).number === 'number'
    && Array.isArray(record.files)
}

// ───────────────────────────────────────────────────────────────────────────
// v1.1 additions: pending workbench, pre-commit checks, branch filtering,
// session attribution and hotspot statistics. Same rules as everything above:
// every value crosses the Host/Client boundary, missing facts stay absent, and
// inferred facts are labelled as inferred.
// ───────────────────────────────────────────────────────────────────────────

/**
 * One working-tree diff request.
 *
 * `filePath` omitted means "the whole side in one diff" (used by the
 * pre-commit checks); provided means one file for the pending workbench.
 */
export interface WorktreeDiffQuery {
  repositoryId: string
  filePath?: string
  /** true = the index (staged) side; false/absent = the unstaged side. */
  staged?: boolean
  contextLines?: number
  maxBytes?: number
}

/** One working-tree diff result. Never pretends an untracked file is tracked. */
export interface WorktreeDiffResult {
  repositoryId: string
  /** Null for a whole-side diff. */
  filePath: string | null
  staged: boolean
  /** `untracked` only when one untracked file was asked for. */
  kind: 'tracked' | 'untracked'
  text: string
  truncated: boolean
  truncationReason?: string
  binary: boolean
  bytes: number
}

/** How serious one pre-commit finding is. */
export type CheckSeverity = 'blocking' | 'warning' | 'info'

/** Stable rule ids; the Client owns every word shown for them. */
export type CheckRuleId =
  | 'conflict-marker'
  | 'secret-pattern'
  | 'private-key'
  | 'lockfile'
  | 'test-deleted'
  | 'binary-file'
  | 'large-file'
  | 'untracked-skipped'
  | 'no-changes'

/** One rule finding. `detail` is machine data, not UI copy. */
export interface CheckFinding {
  rule: CheckRuleId
  severity: CheckSeverity
  path?: string
  line?: number
  count?: number
  detail?: string
}

/** Which side a checks report describes. */
export type CheckScope = 'staged' | 'worktree'

/** Request of one pre-commit checks report. */
export interface ChecksQuery {
  repositoryId: string
  staged?: boolean
  maxBytes?: number
}

/** One rule-based report over a real diff. */
export interface ChecksReport {
  repositoryId: string
  scope: CheckScope
  findings: CheckFinding[]
  /** Changed files the Host actually inspected. */
  filesChecked: number
  truncated: boolean
  /** True when there was no diff to check. */
  empty: boolean
  warnings?: string[]
  generatedAt: string
}

/** Files touched by the current session's tool calls. */
export interface SessionChangedFile {
  /** Repository-relative path using `/`. */
  path: string
  /** Last tool name that touched it (raw, as the session recorded it). */
  tool: string
  /** How many observed tool calls touched this path. */
  touches: number
  /** ISO 8601 time of the last observed touch, when the event carries one. */
  lastToolAt?: string
  /** Always `inferred`: derived from tool-call arguments, never a commit. */
  confidence: 'inferred'
}

/** Input of one session-attribution request. */
export interface SessionChangesQuery {
  repositoryId: string
  /** The session whose tool calls to read; the Host only reads live sessions. */
  sessionId?: string
}

/** Session attribution facts for one repository. */
export interface SessionChanges {
  repositoryId: string
  /** The session that was asked about; null when the client sent none. */
  sessionId: string | null
  /** False when the Host could not read that session at all. */
  available: boolean
  files: SessionChangedFile[]
  /** True when more paths were observed than {@link MAX_SESSION_FILES}. */
  truncated?: boolean
  warnings?: string[]
  generatedAt: string
}

/** Input of one hotspot ranking request. */
export interface HotspotQuery {
  repositoryId: string
  /** Maximum rows returned; the Host clamps it. */
  limit?: number
  /** How many commits back the Host scans. */
  maxCommits?: number
}

/** One day of commit activity inside the scanned window. */
export interface HotspotDay {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string
  commits: number
  /** Distinct files touched that day (bounded by the same scan). */
  files: number
  additions?: number
  deletions?: number
}

/** One file's churn/authors/recency over the scanned window. */
export interface FileHotspot {
  path: string
  commits: number
  additions?: number
  deletions?: number
  /** additions + deletions when the VCS reports line stats; null otherwise. */
  churn: number | null
  authors: string[]
  authorCount: number
  lastChangedAt?: string
  lastAuthor?: string
}

/**
 * One contributor ranked over the same scanned window as the file ranking.
 *
 * Roles are not stored here: they are a presentation of `commits` relative to
 * the window total, so the client can never disagree with the facts.
 */
export interface HotspotAuthor {
  /** Author name exactly as the VCS printed it. */
  name: string
  /** Commits of the window authored by this person. */
  commits: number
  /** additions + deletions across the window; null when the VCS reported none. */
  churn: number | null
  additions?: number
  deletions?: number
  /** Distinct files this author changed in the window. */
  files: number
  /** Author date of the oldest covered commit by this person, when known. */
  firstCommitAt?: string
  /** Author date of the newest covered commit by this person, when known. */
  lastCommitAt?: string
}

/**
 * One commit of the recent-activity stream.
 *
 * `files` is capped for transport; `fileCount` always states the real total so
 * the UI can say "+N more" without guessing.
 */
export interface HotspotCommit {
  hash: string
  /** Author name; empty when the log carried none. */
  author: string
  /** Author date as ISO 8601, when git printed a parseable value. */
  timestamp?: string
  /** Commit subject (first line of the message). */
  subject: string
  /** Paths changed by the commit, newest-first window order. */
  files: string[]
  /** Total changed paths, even when `files` is capped. */
  fileCount: number
  additions?: number
  deletions?: number
  /** True when the commit has more than one parent. */
  merge: boolean
}

/** Honest scope facts attached to every statistics answer. */
export interface HotspotScope {
  /** Branch the scan was anchored on; null when the VCS cannot say. */
  branch: string | null
  /** True when merge commits are part of the scan. */
  mergesIncluded: boolean
  /** Oldest commit time actually covered, when known. */
  since?: string
  /** How many commits the scan window allowed. */
  windowCommits: number
}

/** One hotspot ranking answer. */
export interface HotspotReport {
  repositoryId: string
  vcsType: VcsType
  /** False when this VCS/repository cannot produce file statistics. */
  available: boolean
  unsupportedReason?: string
  files: FileHotspot[]
  /** Contributors of the same window, ranked by line contribution. */
  authors: HotspotAuthor[]
  /** Newest commits of the window, for the activity stream. */
  recent: HotspotCommit[]
  /** Commit activity per UTC day inside the scanned window (chart data). */
  daily: HotspotDay[]
  /** Commits actually scanned (the honesty badge). */
  scannedCommits: number
  /** True when history is longer than the scan window. */
  truncated: boolean
  scope: HotspotScope
  warnings?: string[]
  computedAt: string
  /** True when the Host answered from its short-lived cache. */
  cached: boolean
}

/** Largest hotspot page the Host will serve. */
export const MAX_HOTSPOT_FILES = 100
/** Most contributor rows one report carries. */
export const MAX_HOTSPOT_CONTRIBUTORS = 20
/** Most activity commits one report carries. */
export const MAX_HOTSPOT_RECENT_COMMITS = 24
/** Most paths one activity commit lists (the total stays in `fileCount`). */
export const MAX_HOTSPOT_COMMIT_FILES = 8
/** Default number of commits a hotspot scan covers. */
export const DEFAULT_HOTSPOT_COMMITS = 500
/** How long one hotspot report stays fresh in the Host cache, in ms. */
export const HOTSPOT_CACHE_MS = 60_000
/** Largest number of session-touched paths the Host reports. */
export const MAX_SESSION_FILES = 500

/** Runtime guard for {@link WorktreeDiffResult}. */
export function isWorktreeDiffResult(value: unknown): value is WorktreeDiffResult {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.text === 'string'
    && typeof record.truncated === 'boolean'
    && typeof record.binary === 'boolean'
    && (record.kind === 'tracked' || record.kind === 'untracked')
}

/** Runtime guard for {@link ChecksReport}. */
export function isChecksReport(value: unknown): value is ChecksReport {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return Array.isArray(record.findings)
    && (record.scope === 'staged' || record.scope === 'worktree')
    && typeof record.truncated === 'boolean'
    && typeof record.empty === 'boolean'
}

/** Runtime guard for {@link SessionChanges}. */
export function isSessionChanges(value: unknown): value is SessionChanges {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.repositoryId === 'string'
    && typeof record.available === 'boolean'
    && Array.isArray(record.files)
}

/** Runtime guard for {@link HotspotReport}. */
export function isHotspotReport(value: unknown): value is HotspotReport {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.repositoryId === 'string'
    && typeof record.available === 'boolean'
    && Array.isArray(record.files)
    && typeof record.scannedCommits === 'number'
}

/** Whether an operation mutates repository state. */
export function isWriteOperation(operation: OperationType): boolean {
  switch (operation) {
    case 'stage':
    case 'unstage':
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
