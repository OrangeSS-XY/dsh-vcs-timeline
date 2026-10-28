/**
 * Repository discovery and the workspace trust gate.
 *
 * Discovery never scans the disk: it looks at the registered DSH workspaces
 * (or the one workspace a session belongs to) plus roots the user explicitly
 * granted through the add flow, at the root itself and at bounded
 * descendants. Every path handed to an adapter first comes back through
 * {@link RepositoryRegistry.gate}, which re-canonicalizes it and re-checks
 * membership, so a symlink or directory swap between discovery and execution
 * cannot escape the gate.
 * @module dsh-vcs-timeline/host/discovery
 */

import { constants, type Dirent } from 'node:fs'
import { access, readdir, realpath, stat } from 'node:fs/promises'
import { basename, sep } from 'node:path'
import type { ApiError, Repository, VcsType } from '../shared/contracts.ts'
import { repositoryId, safeErrorMessage } from './security.ts'
import type { TimelineStore } from './storage/interface.ts'
import type { VcsAdapter } from './adapters/types.ts'

/** One registered DSH workspace, structurally. */
export interface WorkspaceInfo {
  id: string
  path: string
}

/** Directory names never descended into. */
const SKIP_DIRECTORIES = new Set([
  '.git', '.svn', '.hg', 'node_modules', 'bower_components', 'vendor',
  'dist', 'build', 'out', '.next', '.nuxt', '.output', 'target', 'obj',
  '__pycache__', '.venv', 'venv', '.tox', '.cache', '.gradle', '.idea',
  'coverage', '.pytest_cache', '.mypy_cache', '.svelte-kit',
])

/** Discovery bounds (kept small so a refresh stays cheap). */
export const MAX_DISCOVERY_DEPTH = 3
export const MAX_DISCOVERY_ENTRIES = 4_000

/** Adapter pair used for detection and metadata. */
export interface AdapterPair {
  git: VcsAdapter
  svn: VcsAdapter
}

/** Dependencies of the registry. */
export interface RepositoryRegistryDeps {
  workspaces: () => WorkspaceInfo[]
  adapters: AdapterPair
  store?: TimelineStore
  now?: () => Date
  log?: (message: string) => void
}

/** One discovered repository root. */
interface DetectedRoot {
  rootPath: string
  vcsType: VcsType
}

/** Result of one gate check. */
export type GateResult =
  | { ok: true; repository: Repository; canonicalRoot: string }
  | { ok: false; error: ApiError }

/** Outcome of a discovery pass. */
export interface DiscoveryResult {
  repositories: Repository[]
  warnings: string[]
}

/** Check whether a path exists and is a directory. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

/** Check whether a path exists. */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Canonicalize a path; null when it does not resolve. */
export async function canonicalize(path: string): Promise<string | null> {
  try {
    return await realpath(path)
  } catch {
    return null
  }
}

/** If `dir` is a VCS root, report which one. */
export async function detectRootKind(dir: string): Promise<VcsType | null> {
  if (await exists(`${dir}${sep}.git`)) return 'git'
  if (await exists(`${dir}${sep}.svn`)) return 'svn'
  return null
}

/**
 * Bounded breadth-first discovery under one root.
 *
 * A detected repository is not descended into: nested repositories stay
 * unlisted instead of being silently duplicated. `docs/ARCHITECTURE.md`
 * records this strategy.
 */
async function discoverUnder(root: string, depthLimit: number, maxEntries: number): Promise<DetectedRoot[]> {
  const found: DetectedRoot[] = []
  let visited = 0
  let queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }]
  while (queue.length > 0 && visited < maxEntries) {
    const next: Array<{ path: string; depth: number }> = []
    for (const current of queue) {
      if (visited >= maxEntries) break
      visited += 1
      const kind = await detectRootKind(current.path)
      if (kind !== null) {
        found.push({ rootPath: current.path, vcsType: kind })
        continue
      }
      if (current.depth >= depthLimit) continue
      let entries: Dirent[]
      try {
        entries = await readdir(current.path, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (SKIP_DIRECTORIES.has(entry.name)) continue
        if (entry.name.startsWith('.')) continue
        next.push({ path: `${current.path}${sep}${entry.name}`, depth: current.depth + 1 })
      }
    }
    queue = next
  }
  return found
}

/** Repository registry: discovery, metadata enrichment, and path gating. */
export interface RepositoryRegistry {
  /** Discover repositories for one workspace path, or for every workspace. */
  list(workspacePath: string | null): Promise<DiscoveryResult>
  /** Explicitly add one repository root (validated as Git/SVN). */
  add(path: string): Promise<{ ok: true; repository: Repository } | { ok: false; error: ApiError }>
  /** Forget an explicitly added repository; workspace-discovered ones stay. */
  remove(id: string): Promise<boolean>
  /** Cached repository by id, after a successful `list` or `add`. */
  get(id: string): Repository | undefined
  /** Gate a repository id for an operation and re-canonicalize its root. */
  gate(id: string): Promise<GateResult>
  /** Canonical root paths this registry currently knows. */
  knownRoots(): string[]
}

/**
 * Create the repository registry.
 * @param deps - workspaces, adapters, optional store, clock, logger.
 * @returns the registry.
 */
export function createRepositoryRegistry(deps: RepositoryRegistryDeps): RepositoryRegistry {
  const now = deps.now ?? (() => new Date())
  const cache = new Map<string, Repository>()
  const granted = new Set<string>()

  const enrich = async (root: string, kind: VcsType): Promise<Repository | null> => {
    const adapter = kind === 'git' ? deps.adapters.git : deps.adapters.svn
    const info = await adapter.info(root)
    if (!info.ok) {
      deps.log?.(`dsh-vcs-timeline: info failed for ${root}: ${info.error.message}`)
      return null
    }
    const repository: Repository = { ...info.value, id: repositoryId(kind, info.value.rootPath) }
    cache.set(repository.id, repository)
    return repository
  }

  const persist = async (repository: Repository): Promise<void> => {
    if (deps.store === undefined) return
    try {
      await deps.store.appendRepository(repository)
    } catch (error: unknown) {
      deps.log?.(`dsh-vcs-timeline: repository persist failed: ${safeErrorMessage(error)}`)
    }
  }

  const collect = async (workspacePath: string | null): Promise<DiscoveryResult> => {
    const warnings: string[] = []
    const workspaces = deps.workspaces()
    const roots = new Set<string>()
    if (workspacePath !== null && workspacePath.trim() !== '') {
      const canonical = await canonicalize(workspacePath)
      if (canonical === null) {
        warnings.push(`workspace path does not resolve: ${workspacePath}`)
      } else if (!workspaces.some(workspace => canonical === workspace.path || canonical.startsWith(`${workspace.path}${sep}`))) {
        warnings.push('workspace path is not a registered workspace')
      } else {
        roots.add(canonical)
      }
    } else {
      for (const workspace of workspaces) roots.add(workspace.path)
    }
    for (const grantedRoot of granted) roots.add(grantedRoot)

    const detected: DetectedRoot[] = []
    const seen = new Set<string>()
    for (const root of roots) {
      const kind = await detectRootKind(root)
      const picked: DetectedRoot[] = kind !== null
        ? [{ rootPath: root, vcsType: kind }]
        : await discoverUnder(root, MAX_DISCOVERY_DEPTH, MAX_DISCOVERY_ENTRIES)
      for (const item of picked) {
        const key = `${item.vcsType}:${item.rootPath}`
        if (seen.has(key)) continue
        seen.add(key)
        detected.push(item)
      }
    }

    const repositories: Repository[] = []
    for (const item of detected) {
      const previous = [...cache.values()].find(repository => repository.rootPath === item.rootPath && repository.vcsType === item.vcsType)
      const repository = await enrich(item.rootPath, item.vcsType)
      if (repository === null) continue
      const snapshot: Repository = {
        ...repository,
        detectedAt: previous?.detectedAt ?? repository.detectedAt,
        lastSeenAt: now().toISOString(),
      }
      cache.set(snapshot.id, snapshot)
      if (previous === undefined || previous.currentRevision !== snapshot.currentRevision || previous.currentBranch !== snapshot.currentBranch) {
        await persist(snapshot)
      }
      repositories.push(snapshot)
    }
    repositories.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.rootPath.localeCompare(b.rootPath))
    return { repositories, warnings }
  }

  return {
    list: collect,

    async add(path) {
      if (typeof path !== 'string' || path.trim() === '') {
        return { ok: false, error: { code: 'invalid-request', message: 'repository path is required' } }
      }
      if (!(await isDirectory(path))) {
        return { ok: false, error: { code: 'invalid-request', message: 'path does not exist or is not a directory', detail: safeErrorMessage(path) } }
      }
      const canonical = await canonicalize(path)
      if (canonical === null) {
        return { ok: false, error: { code: 'invalid-request', message: 'path does not resolve', detail: safeErrorMessage(path) } }
      }
      const root = await findRootFor(canonical)
      if (root === null) {
        return { ok: false, error: { code: 'not-a-repository', message: 'no Git or SVN metadata was found at this path' } }
      }
      granted.add(root.rootPath)
      const repository = await enrich(root.rootPath, root.vcsType)
      if (repository === null) {
        // Surface the adapter's real reason (most often a missing VCS client)
        // instead of a generic internal error, so the add dialog can tell the
        // user what to install or configure.
        const adapter = root.vcsType === 'git' ? deps.adapters.git : deps.adapters.svn
        const probe = await adapter.info(root.rootPath)
        if (!probe.ok) {
          const error = probe.error.code === 'vcs-not-installed'
            ? {
              ...probe.error,
              message: `the ${root.vcsType} client is not available; install it or configure its path, then retry`,
            }
            : probe.error
          return { ok: false, error }
        }
        return { ok: false, error: { code: 'internal', message: 'repository metadata could not be read' } }
      }
      const snapshot: Repository = { ...repository, lastSeenAt: now().toISOString(), detectedAt: now().toISOString() }
      cache.set(snapshot.id, snapshot)
      await persist(snapshot)
      return { ok: true, repository: snapshot }
    },

    async remove(id) {
      const repository = cache.get(id)
      if (repository === undefined) return false
      if (!granted.has(repository.rootPath)) return false
      granted.delete(repository.rootPath)
      cache.delete(id)
      return true
    },

    get(id) {
      return cache.get(id)
    },

    async gate(id) {
      const location = id.indexOf(':')
      if (location <= 0) return { ok: false, error: { code: 'unknown-repository', message: 'unknown repository id' } }
      const vcsType = id.slice(0, location)
      if (vcsType !== 'git' && vcsType !== 'svn') {
        return { ok: false, error: { code: 'unknown-repository', message: 'unknown repository id' } }
      }
      const cached = cache.get(id)
      if (cached === undefined) return { ok: false, error: { code: 'unknown-repository', message: 'repository is not known in this session; refresh the repository list' } }
      const canonical = await canonicalize(cached.rootPath)
      if (canonical === null) {
        return { ok: false, error: { code: 'unknown-repository', message: 'repository path no longer resolves' } }
      }
      if (repositoryId(vcsType, canonical) !== id) {
        return { ok: false, error: { code: 'path-not-allowed', message: 'repository path changed after discovery' } }
      }
      const allowed = granted.has(canonical)
        || deps.workspaces().some(workspace => canonical === workspace.path || canonical.startsWith(`${workspace.path}${sep}`))
      if (!allowed) {
        return { ok: false, error: { code: 'path-not-allowed', message: 'repository is outside every registered workspace' } }
      }
      const kind = await detectRootKind(canonical)
      if (kind === null || kind !== vcsType) {
        return { ok: false, error: { code: 'not-a-repository', message: 'path is no longer a repository root of the expected type' } }
      }
      const adapter = kind === 'git' ? deps.adapters.git : deps.adapters.svn
      const info = await adapter.info(canonical)
      if (!info.ok) return { ok: false, error: info.error }
      const repository: Repository = { ...info.value, id, rootPath: canonical }
      cache.set(id, repository)
      return { ok: true, repository, canonicalRoot: canonical }
    },

    knownRoots() {
      return [...cache.values()].map(repository => repository.rootPath)
    },
  }

  /**
   * Find the repository root enclosing a canonical path.
   *
   * Walks up at most 40 levels looking for VCS metadata, which handles a user
   * choosing a subdirectory of a working copy. The result is canonicalized
   * again, so the returned root is the real one.
   */
  async function findRootFor(canonicalPath: string): Promise<DetectedRoot | null> {
    let current = canonicalPath
    for (let depth = 0; depth < 40; depth += 1) {
      const kind = await detectRootKind(current)
      if (kind !== null) {
        const canonicalRoot = await canonicalize(current)
        return canonicalRoot === null ? null : { rootPath: canonicalRoot, vcsType: kind }
      }
      const parent = current.slice(0, Math.max(0, current.lastIndexOf(sep)))
      if (parent === '' || parent === current) break
      current = parent
    }
    return null
  }
}

/** The display name used for a repository root. */
export function repositoryDisplayName(rootPath: string): string {
  const name = basename(rootPath)
  return name === '' ? rootPath : name
}
