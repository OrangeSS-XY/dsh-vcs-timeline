/**
 * dsh-vcs-timeline — in-memory snapshot cache for dynamic loading.
 *
 * The plugin warms this cache in the background (see `sync.ts`), and the panel
 * seeds its first render from it, so clicking into the timeline paints the
 * last known history immediately instead of a skeleton. Nothing here is
 * persisted: it is a page-lifetime memory cache, sized in repositories and
 * query keys, never in commits the Host did not return.
 *
 * Every entry is timestamped. Readers decide freshness; the cache itself never
 * serves a stale write as fresh, it only remembers when a value was stored.
 * Callers must treat returned objects as immutable snapshots.
 * @module dsh-vcs-timeline/client/cache
 */

import { DEFAULT_PAGE_SIZE } from '../shared/contracts.ts'
import type {
  BranchCompare,
  ChecksReport,
  Diagnostics,
  HotspotReport,
  OperationPage,
  PullRequestList,
  Repository,
  SessionChanges,
  TimelinePage,
  TimelineQuery,
  WorkingTreeStatus,
} from '../shared/contracts.ts'
import type { ChecksScope } from './types.ts'

/** How many repositories keep their slices in memory at once (LRU). */
export const MAX_CACHED_REPOSITORIES = 8

/** Cache key of the "all workspaces" warm run (`workspacePath === null`). */
export const ALL_WORKSPACES_KEY = '*'

/** Normalize a workspace path into one cache key (Windows paths are caseless). */
export function workspaceKey(workspacePath: string | null): string {
  if (workspacePath === null) return ALL_WORKSPACES_KEY
  const trimmed = workspacePath.trim()
  if (trimmed === '') return ALL_WORKSPACES_KEY
  return trimmed.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Stable key of one timeline query.
 *
 * A cache entry is only reused when the query that produced it is identical:
 * exposing a filtered page under a different filter would show facts from the
 * wrong window. Event-type chips are sorted so their order cannot split the key.
 */
export function timelineQueryKey(query: TimelineQuery): string {
  const eventTypes = [...(query.eventTypes ?? [])].sort().join(',')
  return [
    query.repositoryId,
    `limit=${query.limit ?? DEFAULT_PAGE_SIZE}`,
    `files=${query.includeFiles === true ? 1 : 0}`,
    `text=${query.text?.trim() ?? ''}`,
    `author=${query.author?.trim() ?? ''}`,
    `since=${query.since ?? ''}`,
    `branch=${query.branch?.trim() ?? ''}`,
    `scope=${query.branchScope ?? 'current'}`,
    `events=${eventTypes}`,
  ].join('|')
}

/** One cached timeline page plus the instant it was stored. */
export interface CachedTimeline {
  queryKey: string
  page: TimelinePage
  savedAt: number
}

/** One cached repository listing. */
export interface CachedWorkspace {
  repositories: Repository[]
  diagnostics: Diagnostics
  selectedRepositoryId: string | null
  savedAt: number
}

/** One cached working-tree status. */
export interface CachedStatus {
  value: WorkingTreeStatus
  savedAt: number
}

/** One cached operation page. */
export interface CachedAudit {
  page: OperationPage
  savedAt: number
}

/** One cached stat report. */
export interface CachedHotspots {
  value: HotspotReport
  savedAt: number
}

/** One cached session attribution. */
export interface CachedSession {
  value: SessionChanges
  savedAt: number
}

/** One cached checks report (per side of the working tree). */
export interface CachedChecks {
  value: ChecksReport
  savedAt: number
}

/** One cached pull-request list. */
export interface CachedPullRequests {
  value: PullRequestList
  savedAt: number
}

/** One cached branch insight. */
export interface CachedCompare {
  value: BranchCompare
  savedAt: number
}

/** Every slice cached for one repository. */
export interface RepositoryCache {
  timeline: CachedTimeline | null
  status: CachedStatus | null
  audit: CachedAudit | null
  hotspots: CachedHotspots | null
  session: CachedSession | null
  checks: Map<ChecksScope, CachedChecks>
  pullRequests: CachedPullRequests | null
  compare: CachedCompare | null
  /** Last write of any slice, epoch ms. */
  savedAt: number | null
}

/** Last location the user was viewing, used to warm the right repository. */
export interface CachedLocation {
  workspacePath: string | null
  repositoryId: string | null
}

/** Empty repository cache. */
function createRepositoryCache(): RepositoryCache {
  return {
    timeline: null,
    status: null,
    audit: null,
    hotspots: null,
    session: null,
    checks: new Map(),
    pullRequests: null,
    compare: null,
    savedAt: null,
  }
}

/**
 * Bounded, page-lifetime cache of Host read results.
 *
 * One instance per plugin activation. `now` is injectable so cache tests are
 * deterministic and so the panel's own clock (when injected) stays consistent.
 */
export class PanelCache {
  private readonly now: () => number
  private readonly workspaces = new Map<string, CachedWorkspace>()
  private readonly repos = new Map<string, RepositoryCache>()
  private location: CachedLocation = { workspacePath: null, repositoryId: null }

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /** Replace the repository listing of one workspace. */
  rememberRepositories(
    workspacePath: string | null,
    repositories: Repository[],
    diagnostics: Diagnostics,
    selectedRepositoryId: string | null,
  ): void {
    const key = workspaceKey(workspacePath)
    this.workspaces.set(key, {
      repositories: [...repositories],
      diagnostics,
      selectedRepositoryId,
      savedAt: this.now(),
    })
    if (selectedRepositoryId !== null) this.touchRepository(selectedRepositoryId)
  }

  /** Cached repository listing for exactly this workspace, or null. */
  readRepositories(workspacePath: string | null): CachedWorkspace | null {
    return this.workspaces.get(workspaceKey(workspacePath)) ?? null
  }

  /** Remember the timeline page for one exact query. */
  rememberTimeline(repositoryId: string, queryKey: string, page: TimelinePage): void {
    const cache = this.ensureRepository(repositoryId)
    cache.timeline = { queryKey, page, savedAt: this.now() }
    cache.savedAt = cache.timeline.savedAt
  }

  readTimeline(repositoryId: string): CachedTimeline | null {
    return this.repos.get(repositoryId)?.timeline ?? null
  }

  rememberStatus(repositoryId: string, value: WorkingTreeStatus): void {
    const cache = this.ensureRepository(repositoryId)
    cache.status = { value, savedAt: this.now() }
    cache.savedAt = cache.status.savedAt
  }

  readStatus(repositoryId: string): CachedStatus | null {
    return this.repos.get(repositoryId)?.status ?? null
  }

  rememberAudit(repositoryId: string, page: OperationPage): void {
    const cache = this.ensureRepository(repositoryId)
    cache.audit = { page, savedAt: this.now() }
    cache.savedAt = cache.audit.savedAt
  }

  readAudit(repositoryId: string): CachedAudit | null {
    return this.repos.get(repositoryId)?.audit ?? null
  }

  rememberHotspots(repositoryId: string, value: HotspotReport): void {
    const cache = this.ensureRepository(repositoryId)
    cache.hotspots = { value, savedAt: this.now() }
    cache.savedAt = cache.hotspots.savedAt
  }

  readHotspots(repositoryId: string): CachedHotspots | null {
    return this.repos.get(repositoryId)?.hotspots ?? null
  }

  rememberSession(repositoryId: string, value: SessionChanges): void {
    const cache = this.ensureRepository(repositoryId)
    cache.session = { value, savedAt: this.now() }
    cache.savedAt = cache.session.savedAt
  }

  readSession(repositoryId: string): CachedSession | null {
    return this.repos.get(repositoryId)?.session ?? null
  }

  rememberChecks(repositoryId: string, scope: ChecksScope, value: ChecksReport): void {
    const cache = this.ensureRepository(repositoryId)
    cache.checks.set(scope, { value, savedAt: this.now() })
    cache.savedAt = this.now()
  }

  readChecks(repositoryId: string, scope: ChecksScope): CachedChecks | null {
    return this.repos.get(repositoryId)?.checks.get(scope) ?? null
  }

  rememberPullRequests(repositoryId: string, value: PullRequestList): void {
    const cache = this.ensureRepository(repositoryId)
    cache.pullRequests = { value, savedAt: this.now() }
    cache.savedAt = cache.pullRequests.savedAt
  }

  readPullRequests(repositoryId: string): CachedPullRequests | null {
    return this.repos.get(repositoryId)?.pullRequests ?? null
  }

  rememberCompare(repositoryId: string, value: BranchCompare): void {
    const cache = this.ensureRepository(repositoryId)
    cache.compare = { value, savedAt: this.now() }
    cache.savedAt = cache.compare.savedAt
  }

  readCompare(repositoryId: string): CachedCompare | null {
    return this.repos.get(repositoryId)?.compare ?? null
  }

  /** Whole cached repository snapshot (for hydration), or null when unseen. */
  readRepository(repositoryId: string): RepositoryCache | null {
    return this.repos.get(repositoryId) ?? null
  }

  /** Whether any slice exists for this repository. */
  hasRepository(repositoryId: string): boolean {
    return this.repos.has(repositoryId)
  }

  /** Remember the last workspace/repository, so the next warm targets it. */
  noteLocation(workspacePath: string | null, repositoryId: string | null): void {
    this.location = { workspacePath, repositoryId }
    if (repositoryId !== null) this.touchRepository(repositoryId)
  }

  /** The last workspace/repository the user viewed. */
  readLocation(): CachedLocation {
    return { ...this.location }
  }

  /** Forget everything (used when the plugin unloads). */
  clear(): void {
    this.workspaces.clear()
    this.repos.clear()
    this.location = { workspacePath: null, repositoryId: null }
  }

  /** Number of repositories currently cached (tests and diagnostics). */
  repositoryCount(): number {
    return this.repos.size
  }

  /** The cache entry for one repository, created on first write and touched. */
  private ensureRepository(repositoryId: string): RepositoryCache {
    this.touchRepository(repositoryId)
    const existing = this.repos.get(repositoryId)
    if (existing !== undefined) return existing
    const created = createRepositoryCache()
    this.repos.set(repositoryId, created)
    while (this.repos.size > MAX_CACHED_REPOSITORIES) {
      const oldest = this.repos.keys().next()
      if (oldest.done === true) break
      this.repos.delete(oldest.value)
    }
    return created
  }

  /** Mark one repository as most recently used (Map insertion order is LRU). */
  private touchRepository(repositoryId: string): void {
    const existing = this.repos.get(repositoryId)
    if (existing === undefined) return
    this.repos.delete(repositoryId)
    this.repos.set(repositoryId, existing)
  }
}

/** Create one cache instance (tests inject a clock). */
export function createPanelCache(now?: () => number): PanelCache {
  return new PanelCache(now)
}
