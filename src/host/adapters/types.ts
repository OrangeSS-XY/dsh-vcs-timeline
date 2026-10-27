/**
 * Adapter contract shared by the Git and SVN backends.
 *
 * An adapter owns every VCS fact. It never talks HTTP, never persists
 * anything, and never assumes the identity of a Git commit and an SVN
 * revision: `history` returns {@link VcsEvent} values whose revision field
 * keeps each system's own semantics.
 * @module dsh-vcs-timeline/host/adapters/types
 */

import type {
  ApiError,
  ChangeSet,
  DiffResult,
  OperationBeforeState,
  OperationType,
  Repository,
  VcsEvent,
  VcsEventType,
  VcsType,
  WorkingTreeStatus,
} from '../../shared/contracts.ts'

export type { OperationBeforeState, OperationType } from '../../shared/contracts.ts'

/** One finished subprocess invocation. */
export interface RunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  /** True when the runner killed the process at its deadline. */
  timedOut?: boolean
  /** True when the subprocess never spawned (client missing, ENOENT, ...). */
  spawnFailed?: boolean
  /** Sanitized spawn/run failure message. */
  failureMessage?: string
}

/** Options for one managed subprocess run. */
export interface RunOptions {
  signal?: AbortSignal
  /** Cap for each collected stream, in bytes. */
  maxBytes?: number
  /** Wall-clock deadline for the whole command. */
  timeoutMs?: number
  /** Extra environment for the child process. */
  env?: Readonly<Record<string, string>>
}

/** The narrow subprocess seam adapters run commands through. */
export interface Runner {
  run(argv: readonly string[], cwd: string, options?: RunOptions): Promise<RunResult>
  /** Resolve an executable name to an absolute path, or null when missing. */
  resolveExecutable(command: string): Promise<string | null>
}

/** One page request over repository history. */
export interface HistoryQuery {
  cursor?: string | null
  /** Page size; already clamped by the caller. */
  limit: number
  author?: string
  text?: string
  /** Inclusive lower bound, ISO 8601. */
  since?: string
  /** Inclusive upper bound, ISO 8601. */
  until?: string
  eventTypes?: VcsEventType[]
  /**
   * Attach each event's changed files (`VcsEvent.changedFiles`).
   *
   * Off/absent by default: the page is cheaper without it and the Client needs
   * to distinguish "not requested" from "changed nothing". An adapter that
   * cannot produce the lists must leave the key absent rather than fake it.
   */
  includeFiles?: boolean
}

/** One page of repository history. */
export interface HistoryPage {
  events: VcsEvent[]
  nextCursor: string | null
  hasMore: boolean
  warnings?: string[]
}

/** Diff request after validation. */
export interface AdapterDiffQuery {
  revisionA?: string
  revisionB?: string
  filePath?: string
  contextLines?: number
  maxBytes: number
}

/** Parameters of a requested write operation. */
export type OperationParams = Record<string, string | number | boolean>

/** A planned command: argv only, never a shell string. */
export interface OperationPlan {
  allowed: boolean
  blockedReason?: string
  /** Sanitized argv for display and execution. */
  argv: string[]
  cwd: string
  summary: string
  warnings: string[]
  /** True when the operation talks to a remote. */
  network: boolean
}

/** Result shape every adapter method uses to report a safe failure. */
export type AdapterResult<T> = { ok: true; value: T } | { ok: false; error: ApiError }

/** Uniform surface implemented by the Git and SVN adapters. */
export interface VcsAdapter {
  readonly vcsType: VcsType
  /** Locate the repository root containing `path`, or null. */
  detect(path: string): Promise<AdapterResult<{ rootPath: string } | null>>
  /** Read the repository's descriptive snapshot. */
  info(rootPath: string, signal?: AbortSignal): Promise<AdapterResult<Repository>>
  /** One page of history, newest first. */
  history(rootPath: string, repositoryId: string, query: HistoryQuery, signal?: AbortSignal): Promise<AdapterResult<HistoryPage>>
  /** File list and metadata of one revision. */
  changeSet(rootPath: string, repositoryId: string, revision: string, signal?: AbortSignal): Promise<AdapterResult<ChangeSet>>
  /** Unified diff text of one revision or range. */
  diff(rootPath: string, repositoryId: string, query: AdapterDiffQuery, signal?: AbortSignal): Promise<AdapterResult<DiffResult>>
  /** Working tree snapshot. */
  status(rootPath: string, repositoryId: string, signal?: AbortSignal): Promise<AdapterResult<WorkingTreeStatus>>
  /** State read immediately before a write operation. */
  beforeState(rootPath: string, operation: OperationType, signal?: AbortSignal): Promise<AdapterResult<OperationBeforeState>>
  /** Plan the exact argv of a write operation, or refuse it. */
  planOperation(rootPath: string, operation: OperationType, params: OperationParams, before: OperationBeforeState): Promise<AdapterResult<OperationPlan>>
}
