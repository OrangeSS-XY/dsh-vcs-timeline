/**
 * Local branch insight route service.
 *
 * Answers "what does the current branch still carry relative to its base?" with
 * git alone: no provider API, no network, no credentials. That is what keeps the
 * pull-request tab useful on a machine whose remote is unreachable or whose
 * token is missing.
 *
 * The read is bounded: one command per fact, an 8 s deadline each, capped
 * collected output, and the gated repository resolver decides which root the
 * commands run in. Nothing here throws for a degenerate repository (empty,
 * detached HEAD, missing base): the answer then carries zeros and nulls plus a
 * warning that names the situation.
 * @module dsh-vcs-timeline/host/branch/service
 */

import type { BranchCompare, BranchCompareCommit, BranchCompareQuery, Repository } from '../../shared/contracts.ts'
import type { RunResult, Runner } from '../adapters/types.ts'
import { isEmptyRepositoryError } from '../adapters/git/commands.ts'
import { safeErrorMessage } from '../security.ts'
import { ServiceError, type RepositoryResolver } from '../services/timeline-service.ts'
import {
  COMPARE_COUNT_CAP,
  COMPARE_LOG_CAP,
  COMPARE_MERGE_TREE_CAP,
  COMPARE_SHORTSTAT_CAP,
  COMPARE_TIMEOUT_MS,
  compareCurrentBranchArgs,
  compareLogArgs,
  deriveBranchActions,
  isCompareBaseName,
  mergeTreeArgs,
  parseCompareLogZ,
  parseMergeTree,
  parseRevListCounts,
  parseShortstat,
  revListCountArgs,
  shortstatArgs,
  upstreamArgs,
  verifyRefArgs,
} from './compare.ts'

/** Most warnings one comparison reports. */
const MAX_COMPARE_WARNINGS = 8

/** Dependencies of the branch service. */
export interface BranchServiceDeps {
  resolver: RepositoryResolver
  runner: Runner
  now?: () => Date
}

/** Read surface used by `POST /vcs/branch/compare`. */
export interface BranchService {
  compare(query: BranchCompareQuery): Promise<BranchCompare>
}

/** First non-empty line of a command output, trimmed. */
function firstLine(text: string): string {
  return (text.split(/\r?\n/)[0] ?? '').trim()
}

/** A bounded, secret-free sentence describing a failed command. */
function failureDetail(result: RunResult): string {
  const raw = result.failureMessage ?? result.stderr ?? ''
  const text = safeErrorMessage(raw, 200)
  return text === '' ? '' : ` (${text})`
}

/**
 * Create the local branch-insight service.
 * @param deps - gated resolver, managed runner, optional clock.
 * @returns the service.
 */
export function createBranchService(deps: BranchServiceDeps): BranchService {
  const now = deps.now ?? (() => new Date())

  /** One bounded read; a throwing runner degrades to a failed result. */
  const run = async (root: string, argv: readonly string[], maxBytes: number): Promise<RunResult> => {
    try {
      return await deps.runner.run(argv, root, { timeoutMs: COMPARE_TIMEOUT_MS, maxBytes })
    } catch (error: unknown) {
      return { exitCode: null, stdout: '', stderr: safeErrorMessage(error) }
    }
  }

  /** The payload for a repository this route cannot compare locally. */
  const unavailable = (
    repository: Repository,
    reason: string,
    computedAt: string,
    warnings: string[] = [],
  ): BranchCompare => ({
    repositoryId: repository.id,
    vcsType: repository.vcsType,
    currentBranch: repository.currentBranch ?? null,
    baseBranch: null,
    available: false,
    unsupportedReason: reason,
    ahead: 0,
    behind: 0,
    commits: [],
    filesChanged: 0,
    conflictPaths: null,
    unpushed: null,
    hasUpstream: false,
    actions: [{ kind: 'unknown', reason: 'unsupported-vcs' }],
    ...(warnings.length === 0 ? {} : { warnings: warnings.slice(0, MAX_COMPARE_WARNINGS) }),
    computedAt,
  })

  return {
    async compare(query) {
      if (typeof query !== 'object' || query === null) {
        throw new ServiceError({ code: 'invalid-request', message: 'query is required' })
      }
      const resolved = await deps.resolver.resolve(query.repositoryId)
      if (!resolved.ok) throw new ServiceError(resolved.error)
      const { repository, root } = resolved.value
      const computedAt = now().toISOString()

      if (repository.vcsType !== 'git') {
        return unavailable(repository, 'svn-branches-not-compared', computedAt)
      }

      const warnings: string[] = []

      // 1. The current branch. `rev-parse --abbrev-ref HEAD` prints `HEAD` for a
      //    detached worktree and fails on an unborn branch.
      const branchRun = await run(root, compareCurrentBranchArgs(), COMPARE_COUNT_CAP)
      if (branchRun.spawnFailed === true || (branchRun.exitCode === null && branchRun.timedOut !== true)) {
        return unavailable(repository, 'git-client-missing', computedAt, [
          `git could not be started${failureDetail(branchRun)}`,
        ])
      }
      const branchName = branchRun.exitCode === 0 ? firstLine(branchRun.stdout) : ''
      const currentBranch = branchName === '' || branchName === 'HEAD' ? null : branchName
      const emptyRepository = currentBranch === null && isEmptyRepositoryError(branchRun.stderr)
      if (emptyRepository) warnings.push('this repository has no commits yet')
      else if (currentBranch === null) warnings.push('HEAD is detached; the current branch name is unknown')

      // 2. The base: explicit query value, then the repository default, then the
      //    first existing conventional branch, then the current branch.
      const candidates: string[] = []
      const consider = (name: unknown): void => {
        if (typeof name !== 'string') return
        const value = name.trim()
        if (value === '' || !isCompareBaseName(value) || candidates.includes(value)) return
        candidates.push(value)
      }
      let requested: string | undefined
      if (query.baseBranch !== undefined && query.baseBranch !== null) {
        if (typeof query.baseBranch !== 'string') {
          warnings.push('baseBranch must be a string; it was ignored')
        } else {
          const value = query.baseBranch.trim()
          if (value !== '') {
            if (isCompareBaseName(value)) requested = value
            else warnings.push('the requested base branch is not a valid branch name; it was ignored')
          }
        }
      }
      consider(requested)
      consider(repository.defaultBranch)
      consider('main')
      consider('master')
      consider(currentBranch)

      let baseBranch: string | null = null
      for (const candidate of candidates) {
        const check = await run(root, verifyRefArgs(candidate), COMPARE_COUNT_CAP)
        if (check.exitCode === 0) {
          baseBranch = candidate
          break
        }
      }
      if (baseBranch !== null && requested !== undefined && baseBranch !== requested) {
        warnings.push(`the requested base branch ${requested} does not exist; using ${baseBranch}`)
      } else if (baseBranch === null && !emptyRepository) {
        warnings.push('no base branch was found; the comparison stays empty')
      }

      // 3. The comparison itself. The upstream probe is independent of the base,
      //    so it runs alongside the base-relative reads.
      const upstreamProbe = run(root, upstreamArgs(), COMPARE_COUNT_CAP)
      let ahead = 0
      let behind = 0
      let commits: BranchCompareCommit[] = []
      let filesChanged = 0
      let additions: number | undefined
      let deletions: number | undefined
      let conflictPaths: string[] | null = null

      const comparingOwnBranch = baseBranch !== null && currentBranch !== null && baseBranch === currentBranch
      if (baseBranch !== null && !comparingOwnBranch) {
        const [countsResult, logResult, shortstatResult, mergeResult] = await Promise.all([
          run(root, revListCountArgs(baseBranch, 'HEAD'), COMPARE_COUNT_CAP),
          run(root, compareLogArgs(baseBranch), COMPARE_LOG_CAP),
          run(root, shortstatArgs(baseBranch), COMPARE_SHORTSTAT_CAP),
          run(root, mergeTreeArgs(baseBranch), COMPARE_MERGE_TREE_CAP),
        ])
        const counts = countsResult.exitCode === 0 ? parseRevListCounts(countsResult.stdout) : null
        if (counts === null) warnings.push('the ahead/behind counts could not be read')
        else {
          behind = counts.left
          ahead = counts.right
        }
        if (logResult.exitCode === 0) {
          commits = parseCompareLogZ(logResult.stdout)
        } else {
          warnings.push('the commits of the comparison could not be read')
        }
        if (shortstatResult.exitCode === 0) {
          const shortstat = parseShortstat(shortstatResult.stdout)
          filesChanged = shortstat.filesChanged
          additions = shortstat.additions
          deletions = shortstat.deletions
        } else {
          warnings.push('the changed-file summary could not be read')
        }
        const merge = parseMergeTree(mergeResult)
        conflictPaths = merge.conflicts
        if (merge.unsupportedReason !== undefined) {
          warnings.push(`merge conflicts could not be checked: ${merge.unsupportedReason}`)
        }
      } else if (baseBranch !== null) {
        // Comparing a branch with itself: every difference is zero and the merge
        // is clean by definition, so no command is spent proving it.
        conflictPaths = []
        additions = 0
        deletions = 0
      }

      // 4. The upstream, for the unpushed count.
      const upstreamRun = await upstreamProbe
      let hasUpstream = false
      let unpushed: number | null = null
      if (upstreamRun.exitCode === 0 && firstLine(upstreamRun.stdout) !== '') {
        hasUpstream = true
        const unpushedRun = await run(root, revListCountArgs('@{u}', 'HEAD'), COMPARE_COUNT_CAP)
        const counts = unpushedRun.exitCode === 0 ? parseRevListCounts(unpushedRun.stdout) : null
        if (counts === null) warnings.push('the number of commits ahead of the upstream could not be read')
        else unpushed = counts.right
      }

      const actions = deriveBranchActions({ conflicts: conflictPaths, ahead, behind, unpushed })
      return {
        repositoryId: repository.id,
        vcsType: 'git',
        currentBranch,
        baseBranch,
        available: true,
        ahead,
        behind,
        commits,
        filesChanged,
        ...(additions === undefined ? {} : { additions }),
        ...(deletions === undefined ? {} : { deletions }),
        conflictPaths,
        unpushed,
        hasUpstream,
        actions,
        ...(warnings.length === 0 ? {} : { warnings: warnings.slice(0, MAX_COMPARE_WARNINGS) }),
        computedAt,
      }
    },
  }
}
