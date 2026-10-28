/**
 * dsh-vcs-timeline — pull-request view (list + detail).
 *
 * Answers three questions at a glance: which pull requests are open, who did
 * what (author, branch, reviews, CI), and what the viewer should do next. The
 * Host derives the suggested actions from facts it actually read; when it could
 * not authenticate it says so instead of guessing, and this view shows the
 * credential setup instead of a broken list.
 * @module dsh-vcs-timeline/client/ui/pr
 */

import * as React from 'react'
import type { OperationState } from '../../shared/contracts.ts'
import type { PullRequest, PullRequestAction, PullRequestActionKind } from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type { PanelDeps, PanelHandlers, PanelState } from '../types.ts'
import { IconClock, IconError, IconPr, IconRefresh, IconUpload } from './icons.ts'
import {
  Banner,
  EmptyState,
  errorText,
  IconButton,
  SkeletonRows,
} from './primitives.ts'
import { Subbar } from './detail.ts'
import { selectedRepository } from './shared.ts'

const h = React.createElement

/** Localized action label for one suggested next step. */
export function actionLabel(kind: PullRequestActionKind, t: PanelDeps['t']): string {
  return t(`pr.action.${kind}`)
}

/** Localized reason sentence for one suggested action. */
export function actionReason(action: PullRequestAction, t: PanelDeps['t']): string {
  const key = `pr.reason.${action.reason}`
  const text = t(key)
  return text === key ? t(`pr.action.${action.kind}`) : text
}

/** Whether one action needs the viewer to do something now. */
export function actionNeedsAttention(action: PullRequestAction): boolean {
  return action.kind !== 'wait' && action.kind !== 'unknown'
}

/** Whether any of the suggested actions needs the viewer now. */
export function needsAttention(actions: readonly PullRequestAction[]): boolean {
  return actions.some(actionNeedsAttention)
}

/** One small status badge; the text always names the state, color is secondary. */
function Badge(props: { tone?: 'ok' | 'warn' | 'error' | 'muted'; text: string; title?: string }): React.ReactElement {
  const tone = props.tone ?? 'muted'
  return h('span', {
    className: `dvt-pr-badge dvt-pr-badge-${tone}`,
    title: props.title ?? props.text,
  }, props.text)
}

/** Review/CI/mergeability badges of one pull request. */
function StatusBadges(props: { pr: PullRequest; deps: PanelDeps }): React.ReactElement {
  const { pr, deps } = props
  const { t } = deps
  const badges: React.ReactElement[] = []
  if (pr.state === 'draft') badges.push(h(Badge, { key: 'draft', tone: 'muted', text: t('pr.badge.draft') }))
  badges.push(h(Badge, {
    key: 'review',
    tone: pr.reviewState === 'approved' ? 'ok' : pr.reviewState === 'changes-requested' ? 'error' : 'muted',
    text: t(`pr.badge.review.${pr.reviewState}`),
  }))
  badges.push(h(Badge, {
    key: 'checks',
    tone: pr.checksState === 'success' ? 'ok' : pr.checksState === 'failure' ? 'error' : pr.checksState === 'pending' ? 'warn' : 'muted',
    text: t(`pr.badge.checks.${pr.checksState}`),
  }))
  if (pr.mergeable !== null) {
    badges.push(h(Badge, {
      key: 'merge',
      tone: pr.mergeable ? 'ok' : 'warn',
      text: pr.mergeable ? t('pr.badge.mergeable') : t('pr.badge.conflict'),
    }))
  }
  return h('span', { className: 'dvt-pr-badges' }, badges)
}

/** One suggested-action chip. */
function ActionChip(props: { action: PullRequestAction; deps: PanelDeps }): React.ReactElement {
  return h('span', {
    className: `dvt-pr-action dvt-pr-action-${props.action.kind}`,
    title: actionReason(props.action, props.deps.t),
  }, actionLabel(props.action.kind, props.deps.t))
}

/** One pull-request list row. */
function PullRequestRow(props: {
  pr: PullRequest
  deps: PanelDeps
  handlers: PanelHandlers
  selected: boolean
}): React.ReactElement {
  const { pr, deps, handlers, selected } = props
  const { t } = deps
  const hue = F.authorHue(pr.author.login)
  const when = F.relativeTime(pr.updatedAt, Date.now())
  const updated = when === null
    ? F.formatCompactTime(pr.updatedAt, deps.locale)
    : when.unit === 'justNow'
      ? t('rel.justNow')
      : when.unit === 'minutes'
        ? t('rel.minutesAgo', { count: when.count })
        : when.unit === 'hours'
          ? t('rel.hoursAgo', { count: when.count })
          : t('rel.daysAgo', { count: when.count })
  return h('li', { className: `dvt-pr-row${selected ? ' dvt-pr-row-selected' : ''}` },
    h('button', {
      type: 'button',
      className: 'dvt-pr-card',
      'aria-label': `#${pr.number} ${pr.title}`,
      title: `${pr.title}\n${pr.branch} → ${pr.baseBranch}`,
      onClick: () => handlers.onSelectPullRequest(pr.number),
    },
    h('span', { className: 'dvt-pr-top' },
      h('span', { className: 'dvt-pr-number' }, `#${pr.number}`),
      h('span', {
        className: 'dvt-tl-avatar',
        'aria-hidden': 'true',
        style: { background: `hsl(${hue} 58% 52%)`, color: 'var(--dsw-alias-bg-base)' },
      }, F.authorInitials(pr.author.login)),
      h('span', { className: 'dvt-pr-author' }, pr.author.displayName ?? pr.author.login),
      h('span', { className: 'dvt-pr-title' }, pr.title),
      h('span', { className: 'dvt-pr-updated' }, h(IconClock, { size: 10 }), h('span', null, updated)),
    ),
    h('span', { className: 'dvt-pr-meta' },
      h('span', { className: 'dvt-pr-branch dvt-mono' }, pr.branch),
      h('span', { className: 'dvt-pr-arrow', 'aria-hidden': 'true' }, '→'),
      h('span', { className: 'dvt-pr-base dvt-mono' }, pr.baseBranch),
      h(StatusBadges, { pr, deps }),
      needsAttention(pr.actions)
        ? h('span', { className: 'dvt-pr-actions' }, pr.actions.filter(actionNeedsAttention).slice(0, 2).map((action) => h(ActionChip, { key: `${action.kind}:${action.reason}`, action, deps })))
        : null,
    ),
    ),
  )
}

/** Credential setup hint for the auth-required state. */
function AuthHint(props: { deps: PanelDeps }): React.ReactElement {
  const { t } = props.deps
  return h('div', { className: 'dvt-pr-auth' },
    h('div', { className: 'dvt-pr-auth-title' }, t('pr.auth.title')),
    h('div', { className: 'dvt-pr-auth-hint' }, t('pr.auth.hint')),
  )
}

/** Relative-age label for PR/local rows. */
export function relativeLabel(iso: string, deps: PanelDeps): string {
  const relative = F.relativeTime(iso, Date.now())
  if (relative === null) return F.formatCompactTime(iso, deps.locale)
  const { t } = deps
  switch (relative.unit) {
    case 'justNow': return t('rel.justNow')
    case 'minutes': return t('rel.minutesAgo', { count: relative.count })
    case 'hours': return t('rel.hoursAgo', { count: relative.count })
    default: return t('rel.daysAgo', { count: relative.count })
  }
}

/**
 * Local branch insight: what the current branch carries relative to its base,
 * computed with git only. Shown as a compact strip beside a real PR list and as
 * the full panel whenever the provider cannot be reached or has no PRs.
 */
export function renderLocalInsight(
  state: PanelState,
  deps: PanelDeps,
  handlers: PanelHandlers,
  compact: boolean,
): React.ReactElement | null {
  const { t } = deps
  const slice = state.pullRequests
  const compare = slice.compare
  if (compare === null) {
    if (!slice.compareLoading) return null
    return h('div', { className: 'dvt-local-insight dvt-local-insight-loading' }, t('pr.local.loading'))
  }
  if (!compare.available) {
    return h('div', { className: 'dvt-local-insight' },
      h('div', { className: 'dvt-local-insight-head' }, t('pr.local.title')),
      h('div', { className: 'dvt-local-hint' }, t('pr.local.unavailable', { reason: compare.unsupportedReason ?? '' })),
    )
  }
  const chips: React.ReactElement[] = []
  chips.push(h('span', { key: 'ahead', className: 'dvt-local-chip' }, t('pr.local.ahead', { count: compare.ahead })))
  chips.push(h('span', { key: 'behind', className: 'dvt-local-chip' }, t('pr.local.behind', { count: compare.behind })))
  chips.push(compare.unpushed === null
    ? h('span', { key: 'upstream', className: 'dvt-local-chip dvt-local-chip-muted' }, t('pr.local.noUpstream'))
    : h('span', { key: 'unpushed', className: 'dvt-local-chip' }, t('pr.local.unpushed', { count: compare.unpushed })))
  chips.push(h('span', { key: 'files', className: 'dvt-local-chip' }, t('pr.local.files', { count: compare.filesChanged })))
  if (compare.conflictPaths !== null && compare.conflictPaths.length > 0) {
    chips.push(h('span', { key: 'conflicts', className: 'dvt-local-chip dvt-local-chip-warn' },
      t('pr.local.conflicts', { count: compare.conflictPaths.length })))
  }
  const actionNodes = compare.actions.map((action) => h('span', {
    key: action.kind + ':' + action.reason,
    className: 'dvt-pr-action dvt-pr-action-' + action.kind,
    title: actionReason(action, t),
  }, actionLabel(action.kind, t)))
  const branchLine = compare.currentBranch === null || compare.baseBranch === null
    ? null
    : h('span', { className: 'dvt-local-branches dvt-mono' },
      t('pr.local.currentToBase', { current: compare.currentBranch, base: compare.baseBranch }))

  if (compact) {
    return h('div', { className: 'dvt-local-strip', title: t('pr.local.hint') },
      h('span', { className: 'dvt-local-strip-label' }, t('pr.local.title')),
      branchLine,
      h('span', { className: 'dvt-local-chips' }, chips),
      h('span', { className: 'dvt-local-actions' }, actionNodes),
      h('button', {
        type: 'button',
        className: 'dvt-iconbtn dvt-local-refresh',
        'aria-label': t('pr.refresh'),
        title: t('pr.refresh'),
        onClick: handlers.onRefreshPullRequests,
      }, '⟳'),
    )
  }

  return h('div', { className: 'dvt-local-insight' },
    h('div', { className: 'dvt-local-insight-head' },
      h('span', { className: 'dvt-local-title' }, t('pr.local.title')),
      branchLine,
    ),
    h('div', { className: 'dvt-local-hint' }, t('pr.local.hint')),
    h('div', { className: 'dvt-local-chips' }, chips),
    actionNodes.length === 0 ? null : h('div', { className: 'dvt-local-actions' }, actionNodes),
    compare.commits.length === 0
      ? h('div', { className: 'dvt-local-empty' }, t('pr.local.empty'))
      : h('ul', { className: 'dvt-local-commits' },
        compare.commits.map((commit) => h('li', { key: commit.hash, className: 'dvt-local-commit' },
          h('span', { className: 'dvt-fileinfo-commit-hash dvt-mono' }, F.shortHash(commit.hash, 7)),
          h('span', { className: 'dvt-local-commit-summary dvt-clip', title: commit.summary }, F.truncate(commit.summary, 70)),
          h('span', { className: 'dvt-local-commit-author dvt-clip' },
            commit.author === undefined || commit.author === '' ? t('common.unknown') : commit.author,
          ),
          h('span', { className: 'dvt-local-commit-time' }, relativeLabel(commit.timestamp, deps)),
        )),
      ),
    h('div', { className: 'dvt-local-foot' },
      h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshPullRequests }, t('pr.refresh')),
    ),
  )
}

/** The pull-request list body. */
export function renderPullRequests(
  state: PanelState,
  deps: PanelDeps,
  handlers: PanelHandlers,
): React.ReactElement {
  const { t } = deps
  const repository = selectedRepository(state)
  const slice = state.pullRequests
  if (state.boot === 'loading') return h(SkeletonRows, { rows: 5 })
  if (state.boot === 'error') {
    return h(EmptyState, {
      icon: IconError,
      tone: 'error',
      title: t('state.error.title'),
      hint: F.errorMessage(state.bootError, t),
      actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshRepositories }, t('common.retry')),
    })
  }
  if (repository === null) {
    return h(EmptyState, { icon: IconPr, title: t('state.noRepositories.title'), hint: t('state.noRepositories.hint') })
  }
  if (slice.loading && slice.data === null) {
    return h('div', { className: 'dvt-col dvt-pr-view' },
      h(SkeletonRows, { rows: 4 }),
      renderLocalInsight(state, deps, handlers, false),
    )
  }
  if (slice.error !== null) {
    const code = slice.error.code
    const title = code === 'auth-required'
      ? t('pr.auth.title')
      : code === 'unsupported-remote'
        ? t('pr.unsupported')
        : code === 'rate-limited'
          ? t('pr.rateLimited')
          : code === 'network-unknown'
            ? t('pr.networkError')
            : code === 'internal'
              ? t('pr.hostOutdated.title')
              : t('state.error.title')
    const hint = code === 'auth-required'
      ? t('pr.auth.hint')
      : code === 'unsupported-remote'
        ? t('pr.unsupported.hint')
        : code === 'rate-limited'
          ? t('pr.rateLimited.hint')
          : code === 'network-unknown'
            ? t('pr.networkError.hint')
            : code === 'internal'
              ? t('pr.hostOutdated.hint')
              : errorText(slice.error, t)
    return h('div', { className: 'dvt-col dvt-pr-view' },
      h(EmptyState, {
        icon: code === 'auth-required' || code === 'unsupported-remote' ? IconPr : IconError,
        tone: code === 'unsupported-remote' ? 'warn' : 'error',
        title,
        hint,
        actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshPullRequests }, t('common.retry')),
      }),
      code === 'auth-required' ? h(AuthHint, { deps }) : null,
      renderLocalInsight(state, deps, handlers, false),
    )
  }
  const data = slice.data
  if (data === null) {
    return h('div', { className: 'dvt-col dvt-pr-view' },
      renderLocalInsight(state, deps, handlers, false) ?? h(SkeletonRows, { rows: 5 }),
    )
  }
  const mine = data.pullRequests.filter((pr) => needsAttention(pr.actions))
  const others = data.pullRequests.filter((pr) => !needsAttention(pr.actions))
  const selected = slice.selectedNumber
  const summary = h('div', { className: 'dvt-pr-summary' },
    h('span', { className: 'dvt-pr-summary-counts' }, t('pr.summary', {
      open: data.pullRequests.length,
      mine: mine.length,
    })),
    h('span', { className: 'dvt-pr-summary-remote' },
      h('span', { className: 'dvt-pr-provider' }, data.provider === 'gitlab' ? 'GitLab' : data.provider === 'github' ? 'GitHub' : t('pr.provider.unknown')),
      h('span', { className: 'dvt-pr-path dvt-mono' }, data.remotePath),
      h('span', { className: data.authenticated ? 'dvt-pr-authstate dvt-pr-authstate-ok' : 'dvt-pr-authstate' },
        data.authenticated && data.viewer !== null ? t('pr.authenticated', { viewer: data.viewer }) : t('pr.anonymous'),
      ),
    ),
    h('span', { className: 'dvt-pr-summary-actions' },
      h(IconButton, { label: t('pr.refresh'), icon: IconRefresh, disabled: slice.loading, onClick: handlers.onRefreshPullRequests }),
    ),
  )
  const section = (title: string, rows: PullRequest[]): React.ReactElement => h('section', { className: 'dvt-pr-section' },
    h('div', { className: 'dvt-tl-day' },
      h('span', { className: 'dvt-tl-day-label' }, title),
      h('span', { className: 'dvt-tl-day-count' }, String(rows.length)),
    ),
    h('ul', { className: 'dvt-pr-list' },
      rows.map((pr) => h(PullRequestRow, {
        key: pr.id,
        pr,
        deps,
        handlers,
        selected: selected === pr.number,
      })),
    ),
  )
  return h('div', { className: 'dvt-col dvt-pr-view' },
    summary,
    data.partial === true
      ? h(Banner, { kind: 'warn', title: t('state.partial.title'), text: (data.warnings ?? []).join('; ') || t('pr.detail.partial') })
      : null,
    data.pullRequests.length === 0
      ? h('div', { className: 'dvt-col dvt-pr-empty' },
        h(EmptyState, {
          icon: IconPr,
          title: t('pr.empty'),
          hint: t('pr.empty.hint'),
          actions: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onRefreshPullRequests }, t('common.retry')),
        }),
        renderLocalInsight(state, deps, handlers, false),
      )
      : h('div', { className: 'dvt-col' },
        renderLocalInsight(state, deps, handlers, true),
        h('div', { className: 'dvt-pr-sections' },
          mine.length > 0 ? section(t('pr.section.mine'), mine) : null,
          others.length > 0 ? section(t('pr.section.others'), others) : null,
        ),
      ),
    !data.authenticated ? h(AuthHint, { deps }) : null,
  )
}

/** Detail pane breadcrumb of one pull request. */
export function prDetailHeader(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  const { t } = deps
  const number = state.pullRequests.selectedNumber
  const pr = state.pullRequests.data?.pullRequests.find((entry) => entry.number === number)
    ?? state.pullRequests.detail?.pullRequest
    ?? null
  return h(Subbar, {
    onBack: handlers.onClosePullRequest,
    backLabel: t('pr.detail.close'),
    title: pr === null ? t('pr.title') : `#${pr.number} ${F.truncate(pr.title, 80)}`,
    subtitle: pr === null ? undefined : `${pr.branch} → ${pr.baseBranch}`,
    trailing: pr === null
      ? undefined
      : h('a', {
        className: 'dvt-pr-link',
        href: pr.url,
        target: '_blank',
        rel: 'noreferrer noopener',
        title: t('pr.openInBrowser'),
      }, h(IconUpload, { size: 11 }), h('span', null, t('pr.openInBrowser'))),
  })
}

/** Suggested actions block. */
function ActionsBlock(props: { pr: PullRequest; deps: PanelDeps }): React.ReactElement | null {
  const { pr, deps } = props
  const { t } = deps
  if (pr.actions.length === 0) return null
  return h('div', { className: 'dvt-detail-section' },
    h('div', { className: 'dvt-dialog-label' }, t('pr.detail.actions')),
    h('ul', { className: 'dvt-pr-action-list' },
      pr.actions.map((action) => h('li', {
        key: `${action.kind}:${action.reason}`,
        className: `dvt-pr-action-item dvt-pr-action-${action.kind}`,
      },
      h('span', { className: 'dvt-pr-action-kind' }, actionLabel(action.kind, t)),
      h('span', { className: 'dvt-pr-action-reason' }, actionReason(action, t)),
      )),
    ),
  )
}

/** One metadata row. */
function MetaRow(props: { label: string; children: React.ReactNode }): React.ReactElement {
  return h(React.Fragment, null,
    h('dt', { className: 'dvt-meta-key' }, props.label),
    h('dd', { className: 'dvt-meta-val' }, props.children),
  )
}

/** Scrollable pull-request detail. */
export function prDetailBody(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  const { t } = deps
  const slice = state.pullRequests
  if (slice.detailLoading) return h(SkeletonRows, { rows: 5 })
  if (slice.detailError !== null) {
    return h(Banner, {
      kind: 'error',
      text: errorText(slice.detailError, t),
      action: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: () => {
        if (slice.selectedNumber !== null) handlers.onSelectPullRequest(slice.selectedNumber)
      } }, t('common.retry')),
    })
  }
  const detail = slice.detail
  const pr = detail?.pullRequest ?? slice.data?.pullRequests.find((entry) => entry.number === slice.selectedNumber) ?? null
  if (pr === null) return h(EmptyState, { icon: IconPr, title: t('pr.empty') })
  const when = F.formatTime(pr.updatedAt, deps.locale)
  return h('div', { className: 'dvt-col dvt-pr-detail' },
    detail?.body === undefined || detail.body.trim() === ''
      ? null
      : h('div', { className: 'dvt-detail-section' },
        h('div', { className: 'dvt-dialog-label' }, t('pr.detail.body')),
        h('div', { className: 'dvt-pr-body' }, F.truncate(detail.body, 1200)),
      ),
    h(ActionsBlock, { pr, deps }),
    h('dl', { className: 'dvt-meta' },
      h(MetaRow, { label: t('detail.author'), children: pr.author.displayName ?? pr.author.login }),
      h(MetaRow, { label: t('detail.branch'), children: h('span', { className: 'dvt-mono' }, `${pr.branch} → ${pr.baseBranch}`) }),
      h(MetaRow, { label: t('pr.detail.updated'), children: when }),
      h(MetaRow, { label: t('pr.detail.review'), children: t(`pr.badge.review.${pr.reviewState}`) }),
      h(MetaRow, { label: t('pr.detail.checks'), children: t(`pr.badge.checks.${pr.checksState}`) }),
      pr.mergeable === null
        ? null
        : h(MetaRow, { label: t('pr.detail.mergeable'), children: pr.mergeable ? t('pr.badge.mergeable') : t('pr.badge.conflict') }),
      pr.changedFiles === undefined
        ? null
        : h(MetaRow, { label: t('pr.detail.files'), children: `${pr.changedFiles} · +${pr.additions ?? 0} −${pr.deletions ?? 0}` }),
    ),
    pr.reviews.length === 0
      ? null
      : h('div', { className: 'dvt-detail-section' },
        h('div', { className: 'dvt-dialog-label' }, t('pr.detail.reviews')),
        h('ul', { className: 'dvt-pr-review-list' },
          pr.reviews.map((review) => h('li', { key: `${review.author.login}:${review.submittedAt ?? ''}`, className: 'dvt-pr-review' },
            h('span', { className: `dvt-pr-review-state dvt-pr-review-${review.state}` }, t(`pr.review.${review.state}`)),
            h('span', { className: 'dvt-pr-review-author' }, review.author.login),
            review.submittedAt === undefined ? null : h('span', { className: 'dvt-pr-review-time' }, F.formatCompactTime(review.submittedAt, deps.locale)),
          )),
        ),
      ),
    pr.checks.length === 0
      ? null
      : h('div', { className: 'dvt-detail-section' },
        h('div', { className: 'dvt-dialog-label' }, t('pr.detail.checks')),
        h('ul', { className: 'dvt-pr-check-list' },
          pr.checks.slice(0, 12).map((check) => h('li', { key: check.name, className: `dvt-pr-check dvt-pr-check-${check.state}` },
            h('span', { className: 'dvt-pr-check-name' }, check.name),
            h('span', { className: 'dvt-pr-check-state' }, t(`pr.check.${check.state}`)),
          )),
        ),
      ),
    detail === null
      ? null
      : h('div', { className: 'dvt-detail-section' },
        h('div', { className: 'dvt-dialog-label' }, `${t('pr.detail.files')} · ${detail.files.length}`),
        detail.truncated === true ? h(Banner, { kind: 'warn', text: t('pr.detail.partial') }) : null,
        h('ul', { className: 'dvt-files' },
          detail.files.map((file, index) => h('li', { key: `${file.path}:${index}`, className: 'dvt-file' },
            h('span', { className: `dvt-file-status dvt-status-${file.status}` }, F.statusLetter(file.status)),
            h('span', { className: 'dvt-file-path' },
              h('span', { className: 'dvt-file-name' }, file.path),
            ),
            h('span', { className: 'dvt-file-stats' },
              file.additions === undefined ? null : h('span', { className: 'dvt-stat-add' }, `+${file.additions}`),
              file.deletions === undefined ? null : h('span', { className: 'dvt-stat-del' }, `−${file.deletions}`),
              file.binary === true ? h('span', { className: 'dvt-bin' }, 'BIN') : null,
            ),
          )),
        ),
      ),
  )
}
