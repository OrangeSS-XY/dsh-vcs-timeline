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
import { MAX_CLOSED_PULL_REQUESTS } from '../../shared/contracts.ts'
import type { OperationState } from '../../shared/contracts.ts'
import type { PullRequest, PullRequestAction, PullRequestActionKind, PullRequestList } from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type { PanelDeps, PanelHandlers, PanelState, PullRequestFilter } from '../types.ts'
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

/* ------------------------------------------------------- analytics helpers */

/** Pull requests the merged-history trend chart covers. */
export const MERGED_TREND_WEEKS = 8

/** One UTC day in milliseconds. */
const DAY_MS = 86_400_000

/**
 * How close one pull request is to being mergeable, from reported facts only.
 *
 * - `ready`: open, the provider says mergeable, no change request and CI has
 *   not failed. A pending/none CI state is not a failure and stays `ready`.
 * - `conflicts`: open and the provider explicitly says it is not mergeable.
 * - `blocked`: everything else, including draft/merged/closed PRs and an
 *   unknown (`null`) mergeability. "Unknown" must never be counted as ready.
 */
export type MergeReadiness = 'ready' | 'conflicts' | 'blocked'

/** Classify one pull request's merge readiness. */
export function mergeReadiness(
  pr: Pick<PullRequest, 'state' | 'mergeable' | 'reviewState' | 'checksState'>,
): MergeReadiness {
  if (pr.state !== 'open') return 'blocked'
  if (pr.mergeable === false) return 'conflicts'
  if (pr.mergeable !== true) return 'blocked'
  if (pr.reviewState === 'changes-requested') return 'blocked'
  if (pr.checksState === 'failure') return 'blocked'
  return 'ready'
}

/** Whether one pull request is still active (open or draft, not merged/closed). */
export function isActivePullRequest(pr: Pick<PullRequest, 'state'>): boolean {
  return pr.state === 'open' || pr.state === 'draft'
}

/**
 * Whether one loaded pull request needs the viewer now.
 *
 * Merged/closed rows are history: their stale action list must not be counted
 * as outstanding work, so only active PRs qualify.
 */
export function pullRequestNeedsAttention(pr: Pick<PullRequest, 'state' | 'actions'>): boolean {
  return isActivePullRequest(pr) && needsAttention(pr.actions)
}

/** One author of the loaded pull-request list, ranked for the dashboard. */
export interface PullRequestAuthorSummary {
  /** Provider login, the grouping key. */
  login: string
  /** Human name when the provider exposes one, else the login. */
  displayName: string
  /** Every loaded PR authored by this person (all states). */
  total: number
  /** Still-open (non-draft) PRs. */
  open: number
  /** Merged PRs. */
  merged: number
  /** Additions across PRs that reported them; null when none did. */
  additions: number | null
  /** Deletions across PRs that reported them; null when none did. */
  deletions: number | null
  /** additions + deletions when at least one side was reported; else null. */
  lines: number | null
}

/** One ISO week (Monday start) of the merged mini chart. */
export interface MergedWeek {
  /** Monday of the week, `YYYY-MM-DD` (UTC). */
  weekStart: string
  /** Merged PRs whose `mergedAt` falls in this week. */
  count: number
  /** False when the week starts before the measured history window. */
  inWindow: boolean
}

/** Aggregate facts the pull-request dashboard renders, all from the list. */
export interface PullRequestSummary {
  /** PRs in state `open` (drafts are counted separately). */
  open: number
  /** PRs in state `draft`. */
  draft: number
  /** Open PRs whose readiness is `ready`. */
  mergeReady: number
  /** Open PRs whose readiness is `conflicts`. */
  conflicts: number
  /** Active PRs whose suggested actions need the viewer. */
  attention: number
  /** PRs in state `merged`. */
  merged: number
  /** PRs in state `closed`. */
  closed: number
  /** Open PRs whose mergeability the provider did not report. */
  unknownMergeable: number
  /**
   * False when the list did not request closed/merged history
   * (`closedWindowDays` absent): the merged count is then unknown, not zero.
   */
  mergedAvailable: boolean
  /** Days of merged/closed history the list covers, when reported. */
  windowDays: number | null
  /** True when the provider cap cut the merged/closed side of the list. */
  historyTruncated: boolean
  /** Authors ranked by merged count then total PRs. */
  authors: PullRequestAuthorSummary[]
  /** Last {@link MERGED_TREND_WEEKS} ISO weeks, oldest first. */
  mergedByWeek: MergedWeek[]
  /** True when at least one loaded PR reported line counts. */
  authorLinesAvailable: boolean
}

/** UTC Monday of the ISO week containing one date. */
export function isoWeekStart(date: Date): Date {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const mondayOffset = (day.getUTCDay() + 6) % 7
  return new Date(day.getTime() - mondayOffset * DAY_MS)
}

/**
 * Aggregate one pulled list into the dashboard's facts.
 *
 * Every number is derived from the list the Host returned. The merged side is
 * only counted as zero when the list actually requested that history
 * (`closedWindowDays` present); otherwise {@link PullRequestSummary.mergedAvailable}
 * stays false and the UI shows "unavailable" instead of a fabricated 0.
 * @param list - the loaded pull-request list.
 * @param now - clock used to anchor the 8-week trend and the history window.
 * @param windowDays - requested history window; used only as a fallback when
 * the list did not report `closedWindowDays`.
 */
export function summarizePullRequests(
  list: PullRequestList,
  now: number,
  windowDays?: number,
): PullRequestSummary {
  const reportedWindow = typeof list.closedWindowDays === 'number'
    && Number.isFinite(list.closedWindowDays)
    && list.closedWindowDays > 0
    ? list.closedWindowDays
    : null
  const requestedWindow = typeof windowDays === 'number' && Number.isFinite(windowDays) && windowDays > 0
    ? windowDays
    : null
  const effectiveWindow = reportedWindow ?? requestedWindow
  const clock = Number.isFinite(now) ? now : Date.now()

  let open = 0
  let draft = 0
  let mergeReady = 0
  let conflicts = 0
  let attention = 0
  let merged = 0
  let closed = 0
  let unknownMergeable = 0
  let authorLinesAvailable = false
  const authorRows = new Map<string, PullRequestAuthorSummary>()

  const currentWeek = isoWeekStart(new Date(clock))
  const weeks: MergedWeek[] = []
  const weekIndex = new Map<string, number>()
  for (let offset = MERGED_TREND_WEEKS - 1; offset >= 0; offset -= 1) {
    const weekStart = new Date(currentWeek.getTime() - offset * 7 * DAY_MS).toISOString().slice(0, 10)
    weekIndex.set(weekStart, weeks.length)
    weeks.push({ weekStart, count: 0, inWindow: true })
  }
  const windowStart = effectiveWindow === null ? null : clock - effectiveWindow * DAY_MS
  for (const week of weeks) {
    week.inWindow = windowStart === null || Date.parse(`${week.weekStart}T00:00:00.000Z`) >= windowStart
  }

  for (const pr of list.pullRequests) {
    const login = pr.author.login !== '' ? pr.author.login : (pr.author.displayName ?? '')
    const displayName = pr.author.displayName !== undefined && pr.author.displayName !== ''
      ? pr.author.displayName
      : login
    let author = authorRows.get(login)
    if (author === undefined) {
      author = {
        login,
        displayName,
        total: 0,
        open: 0,
        merged: 0,
        additions: null,
        deletions: null,
        lines: null,
      }
      authorRows.set(login, author)
    } else if (author.displayName === login && displayName !== login) {
      // Prefer the human name once any PR of this author reports one.
      author.displayName = displayName
    }
    author.total += 1
    if (typeof pr.additions === 'number' && Number.isFinite(pr.additions)) {
      author.additions = (author.additions ?? 0) + pr.additions
      authorLinesAvailable = true
    }
    if (typeof pr.deletions === 'number' && Number.isFinite(pr.deletions)) {
      author.deletions = (author.deletions ?? 0) + pr.deletions
      authorLinesAvailable = true
    }

    if (pullRequestNeedsAttention(pr)) attention += 1
    if (pr.state === 'open') {
      open += 1
      author.open += 1
      const readiness = mergeReadiness(pr)
      if (readiness === 'ready') mergeReady += 1
      else if (readiness === 'conflicts') conflicts += 1
      if (pr.mergeable === null) unknownMergeable += 1
      continue
    }
    if (pr.state === 'draft') {
      draft += 1
      continue
    }
    if (pr.state === 'closed') {
      closed += 1
      continue
    }
    merged += 1
    author.merged += 1
    if (typeof pr.mergedAt === 'string' && pr.mergedAt !== '') {
      const mergedAt = Date.parse(pr.mergedAt)
      if (Number.isFinite(mergedAt)) {
        const bucket = weekIndex.get(isoWeekStart(new Date(mergedAt)).toISOString().slice(0, 10))
        if (bucket !== undefined) {
          const week = weeks[bucket]
          if (week !== undefined) week.count += 1
        }
      }
    }
  }

  for (const author of authorRows.values()) {
    author.lines = author.additions === null && author.deletions === null
      ? null
      : (author.additions ?? 0) + (author.deletions ?? 0)
  }
  const authors = [...authorRows.values()].sort((left, right) => (
    right.merged - left.merged
    || right.total - left.total
    || left.login.localeCompare(right.login)
  ))

  return {
    open,
    draft,
    mergeReady,
    conflicts,
    attention,
    merged,
    closed,
    unknownMergeable,
    mergedAvailable: reportedWindow !== null,
    windowDays: reportedWindow,
    historyTruncated: list.historyTruncated === true,
    authors,
    mergedByWeek: weeks,
    authorLinesAvailable,
  }
}

/**
 * Apply one dashboard filter to the loaded pull requests.
 *
 * The result keeps the Host's order (newest activity first), so a filter never
 * silently re-sorts the list. `all` returns every loaded row, including the
 * merged/closed history the dashboard counted.
 */
export function filterPullRequests(
  pullRequests: readonly PullRequest[],
  filter: PullRequestFilter,
): PullRequest[] {
  switch (filter) {
    case 'merge-ready':
      return pullRequests.filter((pr) => mergeReadiness(pr) === 'ready')
    case 'conflicts':
      return pullRequests.filter((pr) => mergeReadiness(pr) === 'conflicts')
    case 'merged':
      return pullRequests.filter((pr) => pr.state === 'merged')
    case 'attention':
      return pullRequests.filter((pr) => pullRequestNeedsAttention(pr))
    default:
      return [...pullRequests]
  }
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

/* ------------------------------------------------------- dashboard pieces */

/** Author rows the dashboard ranks before it stops. */
export const PR_AUTHOR_ROWS = 5

/**
 * Proportional CSS width of one author's line bar.
 *
 * Unlike the hotspot churn ranking this is a linear share of the largest line
 * total in the visible ranking: the bar answers "who contributed more lines",
 * so a null/unknown value stays an empty bar instead of a fabricated nib.
 */
export function lineShareWidth(value: number | null | undefined, max: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '0%'
  if (!(max > 0) || !Number.isFinite(max)) return '0%'
  return `${Math.max(2, Math.round(Math.min(1, value / max) * 1000) / 10)}%`
}

/** Dark circular initial avatar with a stable hue per author. */
function DashAvatar(props: { name: string }): React.ReactElement {
  return h('span', {
    className: 'dvt-pr-dash-avatar',
    'aria-hidden': 'true',
    style: { '--dvt-pr-hue': String(F.authorHue(props.name)) } as unknown as React.CSSProperties,
  }, F.authorInitials(props.name))
}

/** One stat tile; the whole tile is the filter button. */
function DashTile(props: {
  filter: PullRequestFilter
  label: string
  value: string
  hint: string
  active: PullRequestFilter
  muted?: boolean
  onSelect(filter: PullRequestFilter): void
}): React.ReactElement {
  return h('button', {
    type: 'button',
    className: 'dvt-pr-dash-tile',
    'aria-pressed': props.active === props.filter,
    'data-filter': props.filter,
    'data-count': props.value,
    title: props.hint,
    onClick: () => props.onSelect(props.filter),
  },
  h('span', { className: 'dvt-pr-dash-tile-label' }, props.label),
  h('span', {
    className: `dvt-pr-dash-tile-value dvt-mono${props.muted === true ? ' dvt-pr-dash-tile-value-muted' : ''}`,
  }, props.value),
  )
}

/** Top-author ranking: dark avatar, merged/total counts, ± lines, purple share bar. */
function AuthorRanking(props: { summary: PullRequestSummary; deps: PanelDeps }): React.ReactElement {
  const { summary, deps } = props
  const { t } = deps
  const rows = summary.authors.slice(0, PR_AUTHOR_ROWS)
  if (rows.length === 0) {
    return h('p', { className: 'dvt-pr-dash-empty' }, t('pr.dash.authors.empty'))
  }
  const maxLines = summary.authors.reduce((best, author) => Math.max(best, author.lines ?? 0), 0)
  return h('ol', { className: 'dvt-pr-dash-author-list' },
    rows.map((author) => h('li', {
      key: author.login,
      className: 'dvt-pr-dash-author',
      'data-author': author.login,
    },
    h(DashAvatar, { name: author.displayName === '' ? author.login : author.displayName }),
    h('span', { className: 'dvt-pr-dash-author-main' },
      h('span', { className: 'dvt-pr-dash-author-name dvt-clip', title: author.displayName }, author.displayName),
      h('span', { className: 'dvt-pr-dash-author-meta dvt-mono' },
        t('pr.dash.author.meta', { total: author.total, merged: author.merged }),
      ),
    ),
    author.lines === null
      ? h('span', { className: 'dvt-pr-dash-lines dvt-mono dvt-pr-dash-lines-muted' },
        t('pr.dash.author.noLines'))
      : h('span', {
        className: 'dvt-pr-dash-lines dvt-mono',
        title: t('pr.dash.author.linesTitle', { count: author.lines }),
      },
      h('span', { className: 'dvt-stat-add' }, `+${author.additions ?? 0}`),
      h('span', { className: 'dvt-stat-del' }, `−${author.deletions ?? 0}`),
      ),
    h('span', { className: 'dvt-pr-dash-bar', 'aria-hidden': 'true' },
      h('span', {
        className: 'dvt-pr-dash-bar-fill',
        style: { width: lineShareWidth(author.lines, maxLines) },
      }),
    ),
    )),
  )
}

/** Eight-week merged mini chart; bars carry their value in the title. */
function MergedTrend(props: { summary: PullRequestSummary; deps: PanelDeps }): React.ReactElement {
  const { summary, deps } = props
  const { t } = deps
  if (!summary.mergedAvailable) {
    return h('p', { className: 'dvt-pr-dash-empty' }, t('pr.dash.note.noHistory'))
  }
  const weeks = summary.mergedByWeek
  const total = weeks.reduce((sum, week) => sum + week.count, 0)
  if (total === 0) {
    return h('p', { className: 'dvt-pr-dash-empty' }, t('pr.dash.trend.none'))
  }
  const max = weeks.reduce((best, week) => Math.max(best, week.count), 0)
  return h('div', {
    className: 'dvt-pr-dash-chart',
    role: 'img',
    'aria-label': t('pr.dash.trend.title'),
  },
  weeks.map((week) => h('div', {
    key: week.weekStart,
    className: `dvt-pr-dash-week${week.inWindow ? '' : ' dvt-pr-dash-week-out'}`,
    'data-week': week.weekStart,
    'data-count': String(week.count),
    title: week.inWindow
      ? t('pr.dash.trend.weekTitle', { week: week.weekStart, count: week.count })
      : t('pr.dash.trend.outside', { week: week.weekStart }),
  },
  h('span', { className: 'dvt-pr-dash-week-value dvt-mono' }, String(week.count)),
  h('span', { className: 'dvt-pr-dash-week-track', 'aria-hidden': 'true' },
    week.count <= 0 || max <= 0
      ? null
      : h('span', {
        className: 'dvt-pr-dash-week-fill',
        style: { height: `${Math.max(6, Math.round((week.count / max) * 100))}%` },
      }),
  ),
  h('span', { className: 'dvt-pr-dash-week-label' }, week.weekStart.slice(5).replace('-', '/')),
  )),
  )
}

/**
 * The compact analytics banner above the list.
 *
 * Five tiles answer "how much work is ready / conflicted / waiting / merged";
 * two cards rank the authors and chart mergers over the last eight ISO weeks.
 * Tiles and chips set the same filter, and every honest-unknown note (anonymous
 * provider, unknown mergeability, truncated history, unrequested history) is
 * stated instead of folded into a zero.
 */
function PrDashboard(props: {
  list: PullRequestList
  summary: PullRequestSummary
  filter: PullRequestFilter
  deps: PanelDeps
  handlers: PanelHandlers
}): React.ReactElement {
  const { list, summary, filter, deps, handlers } = props
  const { t } = deps
  const select = handlers.onSetPullRequestFilter
  const mergedDays = summary.windowDays ?? 0
  const mergedTile = summary.mergedAvailable
    ? h(DashTile, {
      filter: 'merged',
      label: t('pr.dash.tile.merged', { days: mergedDays }),
      value: String(summary.merged),
      hint: t('pr.dash.tile.merged.hint', { days: mergedDays }),
      active: filter,
      onSelect: select,
    })
    : h(DashTile, {
      filter: 'merged',
      label: t('pr.dash.tile.mergedNoWindow'),
      value: t('pr.dash.unavailable'),
      hint: t('pr.dash.tile.mergedNoWindow.hint'),
      muted: true,
      active: filter,
      onSelect: select,
    })
  const notes: React.ReactElement[] = []
  if (!list.authenticated) {
    notes.push(h('p', { key: 'anonymous', className: 'dvt-pr-dash-note' }, t('pr.dash.note.unauthenticated')))
  }
  if (summary.unknownMergeable > 0) {
    notes.push(h('p', { key: 'mergeable', className: 'dvt-pr-dash-note' },
      t('pr.dash.note.unknownMergeable', { count: summary.unknownMergeable })))
  }
  if (summary.historyTruncated && summary.windowDays !== null) {
    notes.push(h('p', { key: 'truncated', className: 'dvt-pr-dash-note' },
      t('pr.dash.note.historyTruncated', {
        days: summary.windowDays,
        limit: MAX_CLOSED_PULL_REQUESTS,
      })))
  }
  const chip = (value: PullRequestFilter, label: string): React.ReactElement => h('button', {
    key: value,
    type: 'button',
    className: 'dvt-pr-chip',
    'aria-pressed': filter === value,
    'data-filter': value,
    onClick: () => select(value),
  }, label)
  return h('section', { className: 'dvt-pr-dash', 'aria-label': t('pr.dash.title') },
    h('div', { className: 'dvt-pr-dash-head' },
      h('div', { className: 'dvt-pr-dash-titles' },
        h('div', { className: 'dvt-pr-dash-title' }, t('pr.dash.title')),
        h('div', { className: 'dvt-pr-dash-hint' }, t('pr.dash.hint')),
      ),
    ),
    h('div', { className: 'dvt-pr-dash-tiles' },
      h(DashTile, {
        filter: 'all',
        label: t('pr.dash.tile.open'),
        value: String(summary.open + summary.draft),
        hint: t('pr.dash.tile.open.hint', { open: summary.open, draft: summary.draft }),
        active: filter,
        onSelect: select,
      }),
      h(DashTile, {
        filter: 'merge-ready',
        label: t('pr.dash.tile.merge-ready'),
        value: String(summary.mergeReady),
        hint: t('pr.dash.tile.merge-ready.hint'),
        active: filter,
        onSelect: select,
      }),
      h(DashTile, {
        filter: 'conflicts',
        label: t('pr.dash.tile.conflicts'),
        value: String(summary.conflicts),
        hint: t('pr.dash.tile.conflicts.hint'),
        active: filter,
        onSelect: select,
      }),
      h(DashTile, {
        filter: 'attention',
        label: t('pr.dash.tile.attention'),
        value: String(summary.attention),
        hint: t('pr.dash.tile.attention.hint'),
        active: filter,
        onSelect: select,
      }),
      mergedTile,
    ),
    h('div', { className: 'dvt-pr-dash-grid' },
      h('section', { className: 'dvt-pr-dash-card dvt-pr-dash-authors' },
        h('div', { className: 'dvt-pr-dash-card-title' }, t('pr.dash.authors.title')),
        h('p', { className: 'dvt-pr-dash-card-hint' }, t('pr.dash.authors.hint')),
        h(AuthorRanking, { summary, deps }),
      ),
      h('section', { className: 'dvt-pr-dash-card dvt-pr-dash-trend' },
        h('div', { className: 'dvt-pr-dash-card-title' }, t('pr.dash.trend.title')),
        h('p', { className: 'dvt-pr-dash-card-hint' }, t('pr.dash.trend.hint')),
        h(MergedTrend, { summary, deps }),
      ),
    ),
    notes.length === 0 ? null : h('div', { className: 'dvt-pr-dash-notes' }, notes),
    h('div', { className: 'dvt-pr-chips', role: 'group', 'aria-label': t('pr.dash.filter.label') },
      chip('all', t('pr.dash.filter.all')),
      chip('merge-ready', t('pr.dash.filter.merge-ready')),
      chip('conflicts', t('pr.dash.filter.conflicts')),
      chip('merged', t('pr.dash.filter.merged')),
      chip('attention', t('pr.dash.filter.attention')),
    ),
  )
}

/** The pull-request list body. */
export function renderPullRequests(
  state: PanelState,
  deps: PanelDeps,
  handlers: PanelHandlers,
): React.ReactElement | null {
  const { t } = deps
  const repository = selectedRepository(state)
  const slice = state.pullRequests
  // First load of this source: the composition root's SkeletonSwap owns the
  // loading surface, so the view returns no element of its own.
  if (state.boot === 'loading') return null
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
  if (slice.loading && slice.data === null) return null
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
    // No provider data and no first load in flight: keep the offline branch
    // insight if it exists, otherwise let the root render its own state.
    const insight = renderLocalInsight(state, deps, handlers, false)
    return insight === null ? null : h('div', { className: 'dvt-col dvt-pr-view' }, insight)
  }
  const now = deps.now?.() ?? Date.now()
  const stats = summarizePullRequests(data, now, data.closedWindowDays)
  const visible = filterPullRequests(data.pullRequests, slice.filter)
  const activeRows = visible.filter(isActivePullRequest)
  const mine = activeRows.filter((pr) => needsAttention(pr.actions))
  const others = activeRows.filter((pr) => !needsAttention(pr.actions))
  const historyRows = visible.filter((pr) => !isActivePullRequest(pr))
  const selected = slice.selectedNumber
  const summaryBar = h('div', { className: 'dvt-pr-summary' },
    h('span', { className: 'dvt-pr-summary-counts' }, t('pr.summary', {
      open: stats.open + stats.draft,
      mine: stats.attention,
    })),
    h('span', { className: 'dvt-pr-summary-remote' },
      h('span', { className: 'dvt-pr-provider' }, data.provider === 'gitlab' ? 'GitLab' : data.provider === 'github' ? 'GitHub' : t('pr.provider.unknown')),
      h('span', { className: 'dvt-pr-path dvt-mono', title: data.remotePath }, data.remotePath),
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
  const body = data.pullRequests.length === 0
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
      h(PrDashboard, {
        list: data,
        summary: stats,
        filter: slice.filter,
        deps,
        handlers,
      }),
      renderLocalInsight(state, deps, handlers, true),
      visible.length === 0
        ? h('div', { className: 'dvt-col dvt-pr-filtered-empty' },
          h(EmptyState, {
            icon: IconPr,
            title: t('pr.dash.filteredEmpty'),
            hint: t('pr.dash.filteredEmpty.hint'),
            actions: h('button', {
              type: 'button',
              className: 'dvt-btn dvt-btn-sm',
              onClick: () => handlers.onSetPullRequestFilter('all'),
            }, t('pr.dash.filter.all')),
          }),
        )
        : h('div', { className: 'dvt-pr-sections' },
          mine.length > 0 ? section(t('pr.section.mine'), mine) : null,
          others.length > 0 ? section(t('pr.section.others'), others) : null,
          historyRows.length > 0 ? section(t('pr.section.history'), historyRows) : null,
        ),
    )
  return h('div', { className: 'dvt-col dvt-pr-view' },
    summaryBar,
    data.partial === true
      ? h(Banner, { kind: 'warn', title: t('state.partial.title'), text: (data.warnings ?? []).join('; ') || t('pr.detail.partial') })
      : null,
    body,
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
