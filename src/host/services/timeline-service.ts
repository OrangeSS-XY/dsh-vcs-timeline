/**
 * Read-path services: repository listing plus history, changesets, diffs and
 * working-tree status, all resolved through the gated repository registry.
 * @module dsh-vcs-timeline/host/services/timeline-service
 */

import type {
  ApiError,
  ChangeSet,
  Diagnostics,
  DiffQuery,
  DiffResult,
  Repository,
  RepositoryList,
  TimelinePage,
  TimelineQuery,
  WorkingTreeStatus,
} from '../../shared/contracts.ts'
import { DEFAULT_DIFF_MAX_BYTES, DEFAULT_PAGE_SIZE, HARD_DIFF_MAX_BYTES, MAX_PAGE_SIZE } from '../../shared/contracts.ts'
import type { VcsAdapter } from '../adapters/types.ts'
import type { RepositoryRegistry } from '../discovery.ts'
import { clampInt, parseIsoTimestamp } from '../security.ts'
import type { TimelineStore } from '../storage/interface.ts'

/** One resolved repository: its record, canonical root, and adapter. */
export interface ResolvedRepository {
  repository: Repository
  root: string
  adapter: VcsAdapter
}

/** A resolved repository or a stable error. */
export type ResolveResult = { ok: true; value: ResolvedRepository } | { ok: false; error: ApiError }

/** Resolves a repository id into the exact adapter and canonical root. */
export interface RepositoryResolver {
  resolve(id: string): Promise<ResolveResult>
  adapters: { git: VcsAdapter; svn: VcsAdapter }
}

/**
 * Build the resolver over the registry.
 * @param registry - gated repository registry.
 * @param adapters - both adapters.
 * @returns the resolver.
 */
export function createRepositoryResolver(
  registry: RepositoryRegistry,
  adapters: { git: VcsAdapter; svn: VcsAdapter },
): RepositoryResolver {
  return {
    adapters,
    async resolve(id) {
      if (typeof id !== 'string' || id === '') {
        return { ok: false, error: { code: 'invalid-request', message: 'repositoryId is required' } }
      }
      const gated = await registry.gate(id)
      if (!gated.ok) return { ok: false, error: gated.error }
      const adapter = gated.repository.vcsType === 'git' ? adapters.git : adapters.svn
      return { ok: true, value: { repository: gated.repository, root: gated.canonicalRoot, adapter } }
    },
  }
}

/** Dependencies of the read service. */
export interface TimelineServiceDeps {
  resolver: RepositoryResolver
  registry: RepositoryRegistry
  store: TimelineStore
  diagnostics: () => Promise<Diagnostics>
  now?: () => Date
}

/** Read service surface. */
export interface TimelineService {
  listRepositories(workspacePath: string | null): Promise<RepositoryList>
  addRepository(path: string): Promise<Repository>
  removeRepository(id: string): Promise<{ removed: boolean }>
  repository(id: string): Promise<Repository>
  timeline(query: TimelineQuery): Promise<TimelinePage>
  changeSet(repositoryId: string, revision: string): Promise<ChangeSet>
  diff(query: DiffQuery): Promise<DiffResult>
  status(repositoryId: string): Promise<WorkingTreeStatus>
}

/** Thrown by services for a stable, safe API error. */
export class ServiceError extends Error {
  readonly code: ApiError['code']
  readonly detail?: string
  readonly retryable?: boolean

  constructor(error: ApiError) {
    super(error.message)
    this.name = 'ServiceError'
    this.code = error.code
    this.detail = error.detail
    this.retryable = error.retryable
  }

  toApiError(): ApiError {
    return {
      code: this.code,
      message: this.message,
      ...(this.detail === undefined ? {} : { detail: this.detail }),
      ...(this.retryable === undefined ? {} : { retryable: this.retryable }),
    }
  }
}

/** Raise a stable service error. */
export function fail(code: ApiError['code'], message: string, detail?: string): never {
  throw new ServiceError({ code, message, ...(detail === undefined ? {} : { detail }) })
}

/** Validate a requested page size. */
function pageSize(value: unknown): number {
  return clampInt(value, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)
}

/** Validate and clamp a filter window. */
function normalizeWindow(query: TimelineQuery): { since?: string; until?: string } {
  const since = parseIsoTimestamp(query.since) ?? undefined
  const until = parseIsoTimestamp(query.until) ?? undefined
  return {
    ...(since === undefined ? {} : { since }),
    ...(until === undefined ? {} : { until }),
  }
}

/**
 * Create the read service.
 * @param deps - resolver, registry, store, diagnostics provider.
 * @returns the service.
 */
export function createTimelineService(deps: TimelineServiceDeps): TimelineService {
  return {
    async listRepositories(workspacePath) {
      const result = await deps.registry.list(workspacePath)
      const diagnostics = await deps.diagnostics()
      return {
        repositories: result.repositories,
        diagnostics: { ...diagnostics, warnings: [...diagnostics.warnings, ...result.warnings] },
      }
    },

    async addRepository(path) {
      if (typeof path !== 'string' || path.trim() === '') fail('invalid-request', 'path is required')
      const added = await deps.registry.add(path)
      if (!added.ok) throw new ServiceError(added.error)
      return added.repository
    },

    async removeRepository(id) {
      const removed = await deps.registry.remove(id)
      return { removed }
    },

    async repository(id) {
      const resolved = await deps.resolver.resolve(id)
      if (!resolved.ok) throw new ServiceError(resolved.error)
      return resolved.value.repository
    },

    async timeline(query) {
      if (typeof query !== 'object' || query === null) fail('invalid-request', 'query is required')
      const resolved = await deps.resolver.resolve(query.repositoryId)
      if (!resolved.ok) throw new ServiceError(resolved.error)
      const { adapter, repository, root } = resolved.value
      const limit = pageSize(query.limit)
      const window = normalizeWindow(query)
      const eventTypes = Array.isArray(query.eventTypes)
        ? query.eventTypes.filter((type): type is 'commit' => type === 'commit')
        : undefined
      const history = await adapter.history(root, repository.id, {
        ...(typeof query.cursor === 'string' ? { cursor: query.cursor } : {}),
        limit,
        ...(typeof query.author === 'string' && query.author.trim() !== '' ? { author: query.author.trim().slice(0, 200) } : {}),
        ...(typeof query.text === 'string' && query.text.trim() !== '' ? { text: query.text.trim().slice(0, 200) } : {}),
        ...window,
        ...(eventTypes === undefined ? {} : { eventTypes }),
        includeFiles: query.includeFiles === true,
      })
      if (!history.ok) throw new ServiceError(history.error)
      return {
        events: history.value.events,
        nextCursor: history.value.nextCursor,
        hasMore: history.value.hasMore,
        ...(history.value.warnings === undefined ? {} : { warnings: history.value.warnings, partial: true }),
      }
    },

    async changeSet(repositoryId, revision) {
      const resolved = await deps.resolver.resolve(repositoryId)
      if (!resolved.ok) throw new ServiceError(resolved.error)
      const result = await resolved.value.adapter.changeSet(resolved.value.root, resolved.value.repository.id, revision)
      if (!result.ok) throw new ServiceError(result.error)
      try {
        await deps.store.appendChangeSet(result.value)
      } catch {
        // Caching a changeset must never fail the read path.
      }
      return result.value
    },

    async diff(query) {
      const resolved = await deps.resolver.resolve(query.repositoryId)
      if (!resolved.ok) throw new ServiceError(resolved.error)
      const maxBytes = clampInt(query.maxBytes, 1_024, HARD_DIFF_MAX_BYTES, DEFAULT_DIFF_MAX_BYTES)
      const result = await resolved.value.adapter.diff(resolved.value.root, resolved.value.repository.id, {
        ...(typeof query.revisionA === 'string' ? { revisionA: query.revisionA } : {}),
        ...(typeof query.revisionB === 'string' ? { revisionB: query.revisionB } : {}),
        ...(typeof query.filePath === 'string' ? { filePath: query.filePath } : {}),
        ...(typeof query.contextLines === 'number' ? { contextLines: clampInt(query.contextLines, 0, 32, 3) } : {}),
        maxBytes,
      })
      if (!result.ok) throw new ServiceError(result.error)
      return result.value
    },

    async status(repositoryId) {
      const resolved = await deps.resolver.resolve(repositoryId)
      if (!resolved.ok) throw new ServiceError(resolved.error)
      const result = await resolved.value.adapter.status(resolved.value.root, resolved.value.repository.id)
      if (!result.ok) throw new ServiceError(result.error)
      return result.value
    },
  }
}
