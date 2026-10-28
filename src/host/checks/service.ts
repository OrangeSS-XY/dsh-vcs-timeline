/**
 * Pre-commit checks service.
 *
 * Runs the pure rule engine (`./rules.ts`) over a real diff the adapter reads,
 * so every finding points at bytes that actually exist in the working tree or
 * index. The Host never guesses: a missing diff is a warning, an untracked file
 * that `git diff` cannot show is reported as skipped, and SVN (no staging area)
 * always answers for the working copy with an explicit warning.
 * @module dsh-vcs-timeline/host/checks/service
 */

import type { CheckFinding, ChecksQuery, ChecksReport } from '../../shared/contracts.ts'
import { DEFAULT_DIFF_MAX_BYTES, HARD_DIFF_MAX_BYTES } from '../../shared/contracts.ts'
import { clampInt } from '../security.ts'
import { ServiceError, type RepositoryResolver } from '../services/timeline-service.ts'
import { runCheckRules } from './rules.ts'

/** Dependencies of the checks service. */
export interface ChecksServiceDeps {
  resolver: RepositoryResolver
  now?: () => Date
}

/** Read surface used by `POST /vcs/checks`. */
export interface ChecksService {
  checks(query: ChecksQuery): Promise<ChecksReport>
}

/**
 * Create the pre-commit checks service.
 * @param deps - gated resolver and optional clock.
 * @returns the service.
 */
export function createChecksService(deps: ChecksServiceDeps): ChecksService {
  const now = deps.now ?? (() => new Date())

  return {
    async checks(query) {
      const resolved = await deps.resolver.resolve(query.repositoryId)
      if (!resolved.ok) throw new ServiceError(resolved.error)
      const { adapter, repository, root } = resolved.value
      const warnings: string[] = []
      const requestedStaged = query.staged === true
      const staged = requestedStaged && repository.vcsType === 'git'
      if (requestedStaged && repository.vcsType === 'svn') {
        warnings.push('svn-has-no-staging-area; the working copy was checked instead')
      }
      const maxBytes = clampInt(query.maxBytes, 1_024, HARD_DIFF_MAX_BYTES, DEFAULT_DIFF_MAX_BYTES)
      const diff = await adapter.worktreeDiff(root, repository.id, {
        staged,
        contextLines: 3,
        maxBytes,
      })
      if (!diff.ok) throw new ServiceError(diff.error)

      const rules = runCheckRules(diff.value.text)
      const findings: CheckFinding[] = [...rules.findings]
      if (diff.value.binary) {
        findings.push({ rule: 'binary-file', severity: 'info' })
      }
      // `git diff` never shows untracked files; tell the truth about them
      // instead of leaving the user to assume they were checked.
      if (!staged && repository.vcsType === 'git') {
        const status = await adapter.status(root, repository.id)
        if (status.ok) {
          const untracked = status.value.entries.filter(entry => entry.status === '?').length
          if (untracked > 0) {
            findings.push({ rule: 'untracked-skipped', severity: 'info', count: untracked })
            warnings.push('untracked files are not part of this checks report')
          }
        } else {
          warnings.push('the untracked-file count could not be read')
        }
      }
      if (diff.value.truncated) warnings.push('the diff was truncated; later files were not checked')
      return {
        repositoryId: repository.id,
        scope: staged ? 'staged' : 'worktree',
        findings,
        filesChecked: rules.filesChecked,
        truncated: diff.value.truncated,
        empty: rules.empty,
        ...(warnings.length === 0 ? {} : { warnings }),
        generatedAt: now().toISOString(),
      }
    },
  }
}
