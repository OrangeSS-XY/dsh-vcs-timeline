/**
 * Persistence contract for plugin-owned records.
 *
 * The UI and the VCS adapters never touch JSONL directly: they go through the
 * timeline/audit services, which go through this interface. A future SQLite
 * implementation replaces the module behind it without touching either.
 * @module dsh-vcs-timeline/host/storage/interface
 */

import type {
  ChangeSet,
  OperationAttempt,
  OperationPage,
  OperationQuery,
  Repository,
  TimelinePage,
  TimelineQuery,
  VcsEvent,
} from '../../shared/contracts.ts'

/** Store-level failure with a stable, secret-free message. */
export class StoreError extends Error {
  /** Machine code (`storage-failure` by default). */
  readonly code: string

  constructor(message: string, code = 'storage-failure') {
    super(message)
    this.name = 'StoreError'
    this.code = code
  }
}

/** Append-only record store with paginated queries. */
export interface TimelineStore {
  /** Resolve the store directory (created lazily on first write). */
  location(): string
  /** Ensure the store directory exists. */
  init(): Promise<void>
  appendRepository(record: Repository): Promise<void>
  appendEvent(record: VcsEvent): Promise<void>
  appendChangeSet(record: ChangeSet): Promise<void>
  appendOperation(record: OperationAttempt): Promise<void>
  /** Latest snapshot per repository id, newest first. */
  listRepositories(): Promise<Repository[]>
  /** Latest snapshot of one repository. */
  getRepository(id: string): Promise<Repository | undefined>
  queryEvents(query: TimelineQuery): Promise<TimelinePage>
  /** Folded audit records, newest first. */
  queryOperations(query: OperationQuery): Promise<OperationPage>
  /** Latest state of one attempt. */
  getOperation(id: string): Promise<OperationAttempt | undefined>
  /** Flush pending writes and release handles. */
  close(): Promise<void>
}
