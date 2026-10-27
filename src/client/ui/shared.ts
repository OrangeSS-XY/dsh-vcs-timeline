/**
 * Shared, non-visual helpers for the panel views.
 * @module dsh-vcs-timeline/client/ui/shared
 */

import type { OperationType, Repository, VcsType } from '../../shared/contracts.ts'
import type { TranslateFn } from '../i18n.ts'
import type { PanelState } from '../types.ts'

/** Write operations offered for one VCS type, in menu order. */
export const WRITE_OPERATIONS: Record<VcsType, OperationType[]> = {
  git: ['fetch', 'pull', 'push', 'commit'],
  svn: ['update', 'commit'],
}

/** Menu grouping: either a sync-ish action or a local/remote write. */
export function operationGroup(operation: OperationType): 'sync' | 'commit' | 'remote' {
  if (operation === 'commit') return 'commit'
  if (operation === 'push') return 'remote'
  return 'sync'
}

/** Localized display name of one VCS type. */
export function vcsLabel(vcsType: VcsType, t: TranslateFn): string {
  return vcsType === 'git' ? t('footer.git') : t('footer.svn')
}

/** Selected repository, if any. */
export function selectedRepository(state: PanelState): Repository | null {
  if (state.selectedRepositoryId === null) return null
  return state.repositories.find((repository) => repository.id === state.selectedRepositoryId) ?? null
}

/** Whether any timeline filter is narrowing the result. */
export function hasActiveFilters(state: PanelState): boolean {
  return state.filters.debouncedText.trim() !== ''
    || state.filters.eventTypes.length > 0
    || state.filters.author.trim() !== ''
    || state.filters.treeQuery.trim() !== ''
    || state.filters.fileStatus !== 'all'
    || state.filters.timePreset !== 'all'
    || state.selectedFilePath !== null
}

/** Whether the filters that live only in the browser narrow either pane. */
export function hasFileFilters(state: PanelState): boolean {
  return state.filters.treeQuery.trim() !== ''
    || state.filters.fileStatus !== 'all'
    || state.selectedFilePath !== null
}

/** The VCS client that is missing for the selected repository, if any. */
export function missingTool(state: PanelState, repository: Repository | null): VcsType | null {
  if (repository === null || state.diagnostics === null) return null
  if (repository.vcsType === 'git' && state.diagnostics.gitVersion === null) return 'git'
  if (repository.vcsType === 'svn' && state.diagnostics.svnVersion === null) return 'svn'
  return null
}

/** Whether the adapter reported that the repository has no commits yet. */
export function isUninitializedHistory(state: PanelState, repository: Repository | null): boolean {
  if (repository === null) return false
  if (repository.currentRevision === undefined || repository.currentRevision === '') return true
  return state.timeline.warnings.some((warning) => /no commits? yet|does not have any commits/i.test(warning))
}

/** Explanation for a state that only shows a banner. */
export function partialDetail(state: PanelState): string {
  const first = state.timeline.warnings[0]
  return first === undefined ? '' : first
}
