/**
 * Pending-workbench view: the uncommitted half of the repository.
 *
 * One screen answers "what is not committed, what does it actually look like,
 * what is risky about it, and what did this session touch": the dirty files
 * grouped by their real git state (conflicts / staged / unstaged / untracked),
 * the selected file's live diff, and a right column with the rule-based
 * pre-commit checks, the inferred session attribution and the local branch
 * insight. Every number on this screen comes from the Host's real status /
 * diff / checks answers; nothing is estimated.
 * @module dsh-vcs-timeline/client/ui/workbench
 */

import * as React from 'react'
import type { ChecksReport, FileChangeStatus, SessionChanges, WorkingTreeEntry } from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type { PanelDeps, PanelHandlers, PanelState } from '../types.ts'
import { IconCheck, IconClock, IconDiff, IconError, IconRefresh, IconWarning } from './icons.ts'
import {
  Banner,
  DotSep,
  EmptyState,
  IconButton,
  LineStats,
  SectionHeader,
  SkeletonRows,
  errorText,
} from './primitives.ts'
import { Subbar } from './detail.ts'
import { missingTool, selectedRepository } from './shared.ts'

const h = React.createElement

/** One row group of the pending list. */
interface PendingGroup {
  key: 'conflicts' | 'staged' | 'unstaged' | 'untracked'
  label: string
  rows: WorkingTreeEntry[]
}

/** Group the real status entries into the four states the VCS distinguishes. */
export function groupPendingEntries(state: PanelState): PendingGroup[] {
  const status = state.status
  const entries = status === null ? [] : status.entries
  const conflicts = new Set(status === null ? [] : status.conflicts)
  const inConflicts = (entry: WorkingTreeEntry): boolean => conflicts.has(entry.path)
  const groups: PendingGroup[] = [
    {
      key: 'conflicts',
      label: 'pending.group.conflicts',
      rows: entries.filter((entry) => inConflicts(entry)),
    },
    {
      key: 'staged',
      label: 'pending.group.staged',
      rows: entries.filter((entry) => !inConflicts(entry) && entry.staged === true && entry.status !== '?'),
    },
    {
      key: 'unstaged',
      label: 'pending.group.unstaged',
      // SVN has no index; its modified/added/missing entries land here, and
      // `staged` stays absent rather than being faked.
      rows: entries.filter((entry) => !inConflicts(entry)
        && entry.status !== '?'
        && entry.staged !== true),
    },
    {
      key: 'untracked',
      label: 'pending.group.untracked',
      rows: entries.filter((entry) => !inConflicts(entry) && entry.status === '?'),
    },
  ]
  return groups.filter((group) => group.rows.length > 0)
}

/** Session attribution: path -> the row that touched it (inferred). */
function sessionIndex(session: SessionChanges | null): Map<string, string> {
  const map = new Map<string, string>()
  for (const file of session === null ? [] : session.files) map.set(file.path, file.tool)
  return map
}

/** Letter class for one working-tree status letter. */
function entryStatusClass(entry: WorkingTreeEntry): FileChangeStatus {
  const letter = entry.status
  if (letter === '?') return 'added'
  if (letter === 'A') return 'added'
  if (letter === 'D') return 'deleted'
  if (letter === 'R') return 'renamed'
  if (letter === 'C') return 'copied'
  if (letter === 'U') return 'modified'
  return 'modified'
}

/** One dirty-file row. */
function PendingRow(props: {
  entry: WorkingTreeEntry
  selected: boolean
  tool: string | undefined
  deps: PanelDeps
  handlers: PanelHandlers
}): React.ReactElement {
  const { entry, selected, tool, deps, handlers } = props
  const { t } = deps
  const { dir, name } = F.splitRepoPath(entry.path)
  return h('li', { className: 'dvt-wb-item' },
    h('button', {
      type: 'button',
      className: `dvt-wb-row${selected ? ' dvt-wb-row-active' : ''}`,
      title: entry.path,
      'aria-label': t('aria.pendingRow', { path: entry.path }),
      onClick: () => handlers.onSelectPendingFile(entry.path, entry.staged === true),
    },
    h('span', {
      className: `dvt-file-status dvt-status-${entryStatusClass(entry)}`,
      'aria-hidden': 'true',
    }, entry.staged === true && entry.status !== '?' ? entry.status : entry.worktreeStatus ?? entry.status),
    h('span', { className: 'dvt-wb-path' },
      dir === '' ? null : h('span', { className: 'dvt-file-dir' }, dir),
      h('span', { className: 'dvt-wb-name' }, name),
    ),
    tool === undefined
      ? null
      : h('span', {
        className: 'dvt-wb-session',
        title: t('pending.session.tool', { tool }),
      }, t('pending.session.badge')),
    ),
  )
}

/** Commit/stage controls of the pending workbench. */
function PendingActions(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  const { t } = deps
  const status = state.status
  const entries = status === null ? [] : status.entries
  const stagedCount = status === null ? 0 : entries.filter((entry) => entry.staged === true).length
  const hasChanges = entries.length > 0
  const note = stagedCount === 0 ? t('pending.actions.commit.disabled') : t('pending.actions.note')
  return h('div', { className: 'dvt-wb-actions' },
    h('button', {
      type: 'button',
      className: 'dvt-btn dvt-btn-primary dvt-btn-sm',
      disabled: stagedCount === 0,
      title: stagedCount === 0 ? t('pending.actions.commit.disabled') : t('pending.actions.commit'),
      onClick: () => handlers.onStartOperation('commit'),
    }, t('pending.actions.commit')),
    h('button', {
      type: 'button',
      className: 'dvt-btn dvt-btn-sm',
      disabled: !hasChanges,
      title: t('pending.actions.stageAll'),
      onClick: () => handlers.onStartOperation('stage'),
    }, t('pending.actions.stageAll')),
    h('button', {
      type: 'button',
      className: 'dvt-btn dvt-btn-ghost dvt-btn-sm',
      disabled: stagedCount === 0,
      title: t('pending.actions.unstageAll'),
      onClick: () => handlers.onStartOperation('unstage'),
    }, t('pending.actions.unstageAll')),
    h('div', { className: 'dvt-wb-actions-note', title: note }, note),
  )
}

/** The grouped dirty-file list (left column). */
function PendingList(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  const { t } = deps
  const repository = selectedRepository(state)
  if (state.boot === 'loading') return h(SkeletonRows, { rows: 6 })
  if (repository === null) {
    return h(EmptyState, {
      icon: IconDiff,
      title: state.noWorkspace ? t('state.noWorkspace.title') : t('state.noRepositories.title'),
      hint: state.noWorkspace ? t('state.noWorkspace.hint') : t('state.noRepositories.hint'),
    })
  }
  const tool = missingTool(state, repository)
  if (tool !== null) {
    return h(EmptyState, {
      icon: IconError,
      tone: 'error',
      title: t('state.missingTool', { vcs: tool === 'git' ? 'Git' : 'SVN', tool: tool === 'git' ? 'Git' : 'SVN' }),
      hint: tool === 'svn' ? t('addRepo.svnHint') : t('error.vcs-not-installed'),
    })
  }
  if (state.statusLoading && state.status === null) return h(SkeletonRows, { rows: 6 })
  if (state.statusError !== null) {
    return h(EmptyState, {
      icon: IconError,
      tone: 'error',
      title: t('state.error.title'),
      hint: F.errorMessage(state.statusError, t),
      actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRetryStatus }, t('common.retry')),
    })
  }
  const status = state.status
  if (status === null) return h(SkeletonRows, { rows: 6 })
  const groups = groupPendingEntries(state)
  if (groups.length === 0) {
    return h(EmptyState, {
      icon: IconCheck,
      title: t('pending.empty.title'),
      hint: t('pending.empty.hint'),
      actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRetryStatus }, t('common.refresh')),
    })
  }
  const sessions = sessionIndex(state.pending.session)
  return h('div', { className: 'dvt-wb-list' },
    h('div', { className: 'dvt-tree-head' },
      h('span', { className: 'dvt-tree-title' }, t('pending.title')),
      h('span', { className: 'dvt-tree-count' }, String(status.entries.length)),
    ),
    PendingActions(state, deps, handlers),
    h('div', { className: 'dvt-scroll' },
      groups.map((group) => h('section', { key: group.key, className: 'dvt-wb-group' },
        h('div', { className: 'dvt-wb-group-title' },
          h('span', null, t(group.label)),
          h('span', { className: 'dvt-wb-group-count' }, String(group.rows.length)),
        ),
        h('ul', { className: 'dvt-wb-items' },
          group.rows.map((entry) => h(PendingRow, {
            key: `${group.key}:${entry.path}`,
            entry,
            selected: state.pending.path === entry.path && state.pending.staged === (entry.staged === true),
            tool: sessions.get(entry.path),
            deps,
            handlers,
          })),
        ),
      )),
    ),
  )
}

/** The selected dirty file's live diff (centre column). */
function PendingDiff(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  const { t } = deps
  const pending = state.pending
  const repository = selectedRepository(state)
  if (pending.path === null) {
    return h(EmptyState, { icon: IconDiff, title: t('pending.diff.empty') })
  }
  const { dir, name } = F.splitRepoPath(pending.path)
  const data = pending.diff
  const rows = data === null ? [] : F.diffRows(data.text)
  return h('div', { className: 'dvt-col dvt-wb-diff' },
    h(Subbar, {
      onBack: handlers.onBackFromPendingDiff,
      backLabel: t('aria.back'),
      title: name,
      subtitle: dir,
      trailing: h('span', { className: 'dvt-tag' },
        t(data !== null && data.kind === 'untracked' ? 'pending.kind.untracked' : pending.staged ? 'pending.kind.staged' : 'pending.kind.unstaged')),
    }),
    repository === null ? null : h('span', { className: 'dvt-sr-only' }, repository.displayName),
    pending.diffLoading ? h(SkeletonRows, { rows: 6 }) : null,
    pending.diffError !== null
      ? h(Banner, {
        kind: 'error',
        text: errorText(pending.diffError, t),
        action: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: () => handlers.onSelectPendingFile(pending.path as string, pending.staged) }, t('common.retry')),
      })
      : null,
    data === null
      ? (pending.diffLoading || pending.diffError !== null ? null : h(EmptyState, { icon: IconDiff, title: t('diff.empty') }))
      : h('div', { className: 'dvt-col dvt-scroll' },
        data.binary === true
          ? h(Banner, { kind: 'info', title: t('diff.binary'), text: t('diff.binary.hint') })
          : null,
        data.truncated === true
          ? h(Banner, { kind: 'warn', title: t('common.warning'), text: t('diff.truncated.generic') })
          : null,
        data.binary === true
          ? null
          : rows.length === 0
            ? h(EmptyState, { icon: IconDiff, title: t('diff.empty') })
            : h('div', { className: 'dvt-diff', 'aria-label': t('diff.title') },
              rows.map((row, index) => h('div', {
                key: `row-${index}`,
                className: `dvt-diff-row dvt-diff-${row.kind}`,
              },
              h('span', { className: 'dvt-diff-gutter', 'aria-label': t('diff.lineNumbers') },
                h('span', { className: 'dvt-diff-old' }, row.oldLine === null ? '' : String(row.oldLine)),
                h('span', { className: 'dvt-diff-new' }, row.newLine === null ? '' : String(row.newLine)),
              ),
              h('span', { className: 'dvt-diff-code' }, row.text === '' ? ' ' : row.text),
              )),
            ),
        data.binary !== true && rows.length > 0
          ? h('div', { className: 'dvt-diff-foot' },
            h('span', { className: 'dvt-mono dvt-clip', title: pending.path }, pending.path),
            h('span', null, t('diff.lines', { count: rows.length })),
            h('span', null, F.formatBytes(data.bytes)),
            data.truncated === true ? h('span', null, t('diff.truncated')) : null,
          )
          : null,
      ),
  )
}

/** Title + severity icon of one check finding. */
function findingRow(finding: { rule: string; severity: string; path?: string; line?: number; count?: number }, deps: PanelDeps): React.ReactElement {
  const { t } = deps
  const Icon = finding.severity === 'blocking' ? IconError : finding.severity === 'warning' ? IconWarning : IconCheck
  return h('li', { key: `${finding.rule}:${finding.path ?? ''}:${finding.line ?? ''}`, className: `dvt-check dvt-check-${finding.severity}` },
    h('span', { className: 'dvt-check-icon' }, h(Icon, { size: 12 })),
    h('span', { className: 'dvt-check-main' },
      h('span', { className: 'dvt-check-title' }, t(`check.${finding.rule}`)),
      finding.path === undefined
        ? null
        : h('span', { className: 'dvt-check-path dvt-mono', title: finding.path }, finding.path),
    ),
    h('span', { className: 'dvt-check-meta' },
      finding.line === undefined ? null : h('span', null, t('check.line', { line: finding.line })),
      finding.count === undefined || finding.count <= 0 ? null : h('span', null, t('check.count', { count: finding.count })),
    ),
  )
}

/** Pre-commit checks card of the right column. */
function ChecksCard(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  const { t } = deps
  const pending = state.pending
  const report: ChecksReport | null = pending.checks
  const findings = report === null ? [] : report.findings
  const segmented = h('div', { className: 'dvt-seg', role: 'group', 'aria-label': t('pending.checks.title') },
    (['staged', 'worktree'] as const).map((scope) => h('button', {
      key: scope,
      type: 'button',
      className: 'dvt-seg-btn',
      'aria-pressed': pending.checksScope === scope,
      onClick: () => handlers.onSetChecksScope(scope),
    }, t(`pending.checks.scope.${scope}`))),
  )
  return h('div', { className: 'dvt-card' },
    h(SectionHeader, {
      title: t('pending.checks.title'),
      trailing: h('div', { className: 'dvt-card-actions' },
        segmented,
        h(IconButton, {
          label: t('pending.checks.retry'),
          icon: IconRefresh,
          onClick: handlers.onRefreshChecks,
        }),
      ),
    }),
    pending.checksLoading ? h(SkeletonRows, { rows: 2 }) : null,
    pending.checksError !== null
      ? h(Banner, {
        kind: 'error',
        text: errorText(pending.checksError, t),
        action: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshChecks }, t('common.retry')),
      })
      : null,
    pending.checksLoading || report === null
      ? null
      : findings.length === 0
        ? h('div', { className: 'dvt-card-hint' }, t('pending.checks.empty'))
        : h('ul', { className: 'dvt-checks' }, findings.map((finding) => findingRow(finding, deps))),
    report === null || pending.checksLoading
      ? null
      : h('div', { className: 'dvt-card-foot' },
        h('span', null, t('pending.checks.files', { count: report.filesChecked })),
        report.truncated ? h(DotSep) : null,
        report.truncated ? h('span', { className: 'dvt-danger' }, t('check.truncated')) : null,
        report.warnings !== undefined && report.warnings.length > 0
          ? h('span', { className: 'dvt-faint dvt-clip', title: report.warnings.join(' · ') }, report.warnings[0])
          : null,
      ),
  )
}

/** Session attribution card of the right column (always inferred). */
function SessionCard(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  const { t } = deps
  const pending = state.pending
  const session = pending.session
  return h('div', { className: 'dvt-card' },
    h(SectionHeader, {
      title: t('pending.session.title'),
      trailing: h('div', { className: 'dvt-card-actions' },
        h('span', { className: 'dvt-tag dvt-tag-inferred', title: t('pending.session.inferred.hint') }, t('pending.session.inferred')),
        h(IconButton, {
          label: t('pending.session.refresh'),
          icon: IconRefresh,
          onClick: handlers.onRefreshSessionChanges,
        }),
      ),
    }),
    pending.sessionLoading ? h(SkeletonRows, { rows: 2 }) : null,
    pending.sessionError !== null
      ? h(Banner, { kind: 'warn', text: errorText(pending.sessionError, t) })
      : null,
    session === null || pending.sessionLoading
      ? null
      : session.available === false
        ? h('div', { className: 'dvt-card-hint' }, t('pending.session.unavailable'))
        : session.files.length === 0
          ? h('div', { className: 'dvt-card-hint' }, t('pending.session.empty'))
          : h('ul', { className: 'dvt-session-list' },
            session.files.slice(0, 60).map((file) => h('li', { key: file.path, className: 'dvt-session-row', title: file.path },
              h('span', { className: 'dvt-session-path dvt-mono dvt-clip' }, file.path),
              h('span', { className: 'dvt-session-tool' }, t('pending.session.toolShort', { tool: file.tool, count: file.touches })),
            )),
          ),
    session !== null && session.available === true && session.files.length > 60
      ? h('div', { className: 'dvt-card-hint' }, t('pending.session.more', { count: session.files.length - 60 }))
      : null,
  )
}

/** Local branch insight card (works offline, no provider credentials). */
function CompareCard(state: PanelState, deps: PanelDeps): React.ReactElement {
  const { t } = deps
  const compare = state.pullRequests.compare
  return h('div', { className: 'dvt-card' },
    h(SectionHeader, { title: t('pending.compare.title') }),
    state.pullRequests.compareLoading ? h(SkeletonRows, { rows: 2 }) : null,
    state.pullRequests.compareError !== null
      ? h('div', { className: 'dvt-card-hint' }, t('pending.compare.unavailable'))
      : null,
    compare === null || state.pullRequests.compareLoading
      ? null
      : compare.available !== true
        ? h('div', { className: 'dvt-card-hint' }, t('pending.compare.unsupported'))
        : h('div', { className: 'dvt-compare' },
          h('div', { className: 'dvt-compare-line' },
            h('span', { className: 'dvt-compare-branch dvt-mono dvt-clip', title: compare.currentBranch ?? '' }, compare.currentBranch ?? t('common.unknown')),
            h('span', { className: 'dvt-compare-vs' }, '→'),
            h('span', { className: 'dvt-compare-branch dvt-mono dvt-clip', title: compare.baseBranch ?? '' }, compare.baseBranch ?? t('common.unknown')),
          ),
          h('div', { className: 'dvt-compare-stats' },
            h('span', null, t('pending.compare.ahead', { count: compare.ahead })),
            h('span', null, t('pending.compare.behind', { count: compare.behind })),
            compare.unpushed === null ? null : h('span', null, t('pending.compare.unpushed', { count: compare.unpushed })),
            compare.conflictPaths !== null && compare.conflictPaths.length > 0
              ? h('span', { className: 'dvt-danger' }, t('pending.compare.conflicts', { count: compare.conflictPaths.length }))
              : null,
          ),
        ),
  )
}

/** Right column of the workbench. */
function PendingInfo(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  return h('div', { className: 'dvt-wb-info' },
    ChecksCard(state, deps, handlers),
    SessionCard(state, deps, handlers),
    CompareCard(state, deps),
  )
}

/** The whole pending workbench: list | diff | facts. */
export function renderPendingWorkbench(
  state: PanelState,
  deps: PanelDeps,
  handlers: PanelHandlers,
): React.ReactElement {
  return h('div', { className: 'dvt-split dvt-wb-split' },
    PendingList(state, deps, handlers),
    h('div', { key: 'diff', className: 'dvt-pane dvt-wb-main' }, PendingDiff(state, deps, handlers)),
    h('div', { key: 'info', className: 'dvt-pane dvt-wb-side' }, PendingInfo(state, deps, handlers)),
  )
}
