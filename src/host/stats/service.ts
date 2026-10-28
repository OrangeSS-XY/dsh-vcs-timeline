/**
 * File hotspot statistics route service.
 *
 * Answers "which files change most" over a bounded commit window with two
 * `git log` reads of the same window: one numstat stream for the per-file line
 * counts and one metadata stream for author, author date and parents. The
 * window asks git for one commit more than it reports; that extra record is how
 * `truncated` stays exact instead of guessed.
 *
 * The read path is honest by construction: SVN line statistics are not
 * available through this Host path and say so, an empty repository answers with
 * an empty ranking plus a warning instead of an error, and a missing git client
 * is a stable `vcs-not-installed` error. Reports are cached in-process for
 * {@link HOTSPOT_CACHE_MS} and a cache hit returns a copy, so a caller can
 * never corrupt the cached ranking.
 * @module dsh-vcs-timeline/host/stats/service
 */

import type { HotspotQuery, HotspotReport, Repository } from '../../shared/contracts.ts'
import { DEFAULT_HOTSPOT_COMMITS, HOTSPOT_CACHE_MS, MAX_HOTSPOT_FILES } from '../../shared/contracts.ts'
import type { RunResult, Runner } from '../adapters/types.ts'
import { isEmptyRepositoryError, parseLogFileNumstatZ } from '../adapters/git/commands.ts'
import { clampInt, safeErrorMessage } from '../security.ts'
import { fail, ServiceError, type RepositoryResolver } from '../services/timeline-service.ts'
import {
  aggregateHotspots,
  HOTSPOT_META_CAP,
  HOTSPOT_NUMSTAT_CAP,
  HOTSPOT_TIMEOUT_MS,
  hotspotMetaArgs,
  hotspotNumstatArgs,
  MAX_HOTSPOT_COMMITS,
  parseHotspotMetaZ,
} from './hotspots.ts'

/** Rows one report carries when the query asks for no size. */
const DEFAULT_HOTSPOT_ROWS = 30

/** Most reports the process keeps cached at once. */
const MAX_CACHE_ENTRIES = 32

/** Why a hotspot ranking has no commits to rank; never fabricated rows. */
const EMPTY_REPOSITORY_WARNING = 'this repository has no commits yet; the hotspot ranking is empty'
const EMPTY_WINDOW_WARNING = 'no commits were found in the scan window; the hotspot ranking is empty'

/** Why this VCS cannot produce a hotspot ranking here. */
const SVN_UNSUPPORTED_REASON = 'svn-history-line-stats-unsupported'

/** Dependencies of the hotspot statistics service. */
export interface StatsServiceDeps {
  resolver: RepositoryResolver
  runner: Runner
  now?: () => Date
}

/** Read surface used by `POST /vcs/stats/hotspots`. */
export interface StatsService {
  hotspots(query: HotspotQuery): Promise<HotspotReport>
}

/** One cached report and its absolute freshness deadline. */
interface CacheEntry {
  report: HotspotReport
  expiresAt: number
}

/** A copy of one report so a caller can never mutate the cached object. */
function copyReport(report: HotspotReport, cached: boolean): HotspotReport {
  return {
    ...report,
    files: report.files.map(file => ({ ...file, authors: [...file.authors] })),
    daily: report.daily.map(day => ({ ...day })),
    scope: { ...report.scope },
    ...(report.warnings === undefined ? {} : { warnings: [...report.warnings] }),
    cached,
  }
}

/**
 * Create the hotspot statistics service.
 * @param deps - gated resolver, managed runner, optional clock.
 * @returns the service.
 */
export function createStatsService(deps: StatsServiceDeps): StatsService {
  const now = deps.now ?? (() => new Date())
  const cache = new Map<string, CacheEntry>()

  /** One bounded git read; a throwing runner degrades to a failed result. */
  const run = async (root: string, argv: readonly string[], maxBytes: number): Promise<RunResult> => {
    try {
      return await deps.runner.run(argv, root, { timeoutMs: HOTSPOT_TIMEOUT_MS, maxBytes })
    } catch (error: unknown) {
      return { exitCode: null, stdout: '', stderr: safeErrorMessage(error) }
    }
  }

  /** Raise the stable error for a history read that did not complete. */
  const raise = (result: RunResult, what: string): never => {
    const raw = safeErrorMessage(result.failureMessage ?? result.stderr, 200)
    const detail = raw === '' ? undefined : raw
    if (result.spawnFailed === true) {
      return fail('vcs-not-installed', `git could not be started to read ${what}`, detail)
    }
    if (result.timedOut === true) return fail('timeout', `reading ${what} timed out`, detail)
    return fail('operation-failed', `the ${what} could not be read`, detail)
  }

  /** The answer for a repository whose history is not readable yet. */
  const emptyReport = (repository: Repository, windowCommits: number, computedAt: string): HotspotReport => ({
    repositoryId: repository.id,
    vcsType: 'git',
    available: true,
    files: [],
    daily: [],
    scannedCommits: 0,
    truncated: false,
    scope: { branch: repository.currentBranch ?? null, mergesIncluded: true, windowCommits },
    warnings: [EMPTY_REPOSITORY_WARNING],
    computedAt,
    cached: false,
  })

  /** Keep one report for {@link HOTSPOT_CACHE_MS}, dropping expired and oldest entries. */
  const store = (key: string, report: HotspotReport, finishedAt: Date): void => {
    const nowMs = finishedAt.getTime()
    for (const [entryKey, entry] of cache) {
      if (entry.expiresAt <= nowMs) cache.delete(entryKey)
    }
    while (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next()
      if (oldest.done === true) break
      cache.delete(oldest.value)
    }
    cache.set(key, { report, expiresAt: nowMs + HOTSPOT_CACHE_MS })
  }

  return {
    async hotspots(query) {
      if (typeof query !== 'object' || query === null) fail('invalid-request', 'query is required')
      const resolved = await deps.resolver.resolve(query.repositoryId)
      if (!resolved.ok) throw new ServiceError(resolved.error)
      const { repository, root } = resolved.value

      const limit = clampInt(query.limit, 1, MAX_HOTSPOT_FILES, DEFAULT_HOTSPOT_ROWS)
      const windowCommits = clampInt(query.maxCommits, 1, MAX_HOTSPOT_COMMITS, DEFAULT_HOTSPOT_COMMITS)
      const requestedAt = now()

      // SVN history carries no line statistics through this read path: answer
      // with an honest, empty report instead of inventing numbers.
      if (repository.vcsType !== 'git') {
        return {
          repositoryId: repository.id,
          vcsType: repository.vcsType,
          available: false,
          unsupportedReason: SVN_UNSUPPORTED_REASON,
          files: [],
          daily: [],
          scannedCommits: 0,
          truncated: false,
          // Nothing is scanned here; the scope only states the window a scan
          // would have allowed (svn log never filters merge revisions either).
          scope: { branch: repository.currentBranch ?? null, mergesIncluded: true, windowCommits },
          computedAt: requestedAt.toISOString(),
          cached: false,
        }
      }

      const key = `${repository.id}\u0000${limit}\u0000${windowCommits}`
      const hit = cache.get(key)
      if (hit !== undefined) {
        if (hit.expiresAt > requestedAt.getTime()) return copyReport(hit.report, true)
        cache.delete(key)
      }

      // One extra commit is requested: the ranking covers `windowCommits`
      // commits, and the extra record proves that history continues beyond it.
      const [numstat, meta] = await Promise.all([
        run(root, hotspotNumstatArgs(windowCommits + 1), HOTSPOT_NUMSTAT_CAP),
        run(root, hotspotMetaArgs(windowCommits + 1), HOTSPOT_META_CAP),
      ])

      // An unborn HEAD fails both reads; that is an empty repository, not an error.
      if (isEmptyRepositoryError(numstat.stderr) || isEmptyRepositoryError(meta.stderr)) {
        const finishedAt = now()
        const report = emptyReport(repository, windowCommits, finishedAt.toISOString())
        store(key, report, finishedAt)
        return copyReport(report, false)
      }
      if (numstat.exitCode !== 0) raise(numstat, 'the per-file change history')
      if (meta.exitCode !== 0) raise(meta, 'the commit metadata history')

      const aggregate = aggregateHotspots({
        commits: parseHotspotMetaZ(meta.stdout),
        numstat: parseLogFileNumstatZ(numstat.stdout),
        windowCommits,
        limit,
      })
      const finishedAt = now()
      const warnings: string[] = []
      if (aggregate.scannedCommits === 0) warnings.push(EMPTY_WINDOW_WARNING)
      const report: HotspotReport = {
        repositoryId: repository.id,
        vcsType: 'git',
        available: true,
        files: aggregate.files,
        daily: aggregate.daily,
        scannedCommits: aggregate.scannedCommits,
        truncated: aggregate.truncated,
        scope: {
          branch: repository.currentBranch ?? null,
          mergesIncluded: true,
          ...(aggregate.since === undefined ? {} : { since: aggregate.since }),
          windowCommits,
        },
        ...(warnings.length === 0 ? {} : { warnings }),
        computedAt: finishedAt.toISOString(),
        cached: false,
      }
      store(key, report, finishedAt)
      return copyReport(report, false)
    },
  }
}
