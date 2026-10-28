/**
 * dsh-vcs-timeline — pull-request next-action derivation.
 *
 * The Host only suggests an action it can justify from facts it actually read.
 * An anonymous read yields `unknown`/`needs-auth` instead of guessing, and the
 * chain below is ordered by urgency: a review someone is waiting on outranks a
 * blocked merge. The function is pure, so the whole decision table is
 * unit-tested without a provider.
 * @module dsh-vcs-timeline/host/pr/actions
 */

import type {
  PullRequestAction,
  PullRequestActor,
  PullRequestChecksState,
  PullRequestReviewState,
} from '../../shared/contracts.ts'

/** Every fact {@link deriveActions} reads. */
export interface PullRequestActionFacts {
  /** False for an anonymous read; the provider facts are then too thin to act on. */
  authenticated: boolean
  /** Provider login of the current viewer, when known. */
  viewer: string | null
  /** Login of the pull request author. */
  authorLogin: string
  reviewState: PullRequestReviewState
  checksState: PullRequestChecksState
  /** Provider mergeability; null when the provider did not report it. */
  mergeable: boolean | null
  /** Reviewers whose review is still requested. */
  pendingReviewers: PullRequestActor[]
  /** Whether the viewer's review is explicitly requested. */
  requestedFromViewer: boolean
}

/** Most actions one pull request carries. */
export const MAX_ACTIONS = 3

/** Compare two provider logins case-insensitively. */
export function sameLogin(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase()
}

/**
 * Whether one of the pending reviewers is the viewer.
 * @param pendingReviewers - reviewers still requested.
 * @param viewer - viewer login, or null for anonymous.
 * @returns true when the viewer is listed.
 */
export function reviewRequestedFrom(
  pendingReviewers: readonly PullRequestActor[],
  viewer: string | null,
): boolean {
  if (viewer === null || viewer.trim() === '') return false
  return pendingReviewers.some(reviewer => sameLogin(reviewer.login, viewer))
}

/**
 * Derive the ordered next actions for one pull request.
 *
 * Exactly one action is emitted today: the first matching branch of the
 * decision chain wins. The return type stays an array (bounded by
 * {@link MAX_ACTIONS}) so additive hints can be introduced later without a
 * contract change.
 * @param facts - the provider facts the Host read.
 * @returns the ordered actions, never empty.
 */
export function deriveActions(facts: PullRequestActionFacts): PullRequestAction[] {
  if (!facts.authenticated) return [{ kind: 'unknown', reason: 'needs-auth' }]

  const viewer = facts.viewer
  const pendingContainsViewer = reviewRequestedFrom(facts.pendingReviewers, viewer)
  const authorIsViewer = viewer !== null && sameLogin(facts.authorLogin, viewer)
  const checksFailed = facts.checksState === 'failure'
  const checksPending = facts.checksState === 'pending'

  if (facts.requestedFromViewer || (facts.reviewState === 'review-required' && pendingContainsViewer)) {
    return [{ kind: 'review', reason: 'review-requested' }]
  }
  if (facts.reviewState === 'changes-requested') {
    if (authorIsViewer) return [{ kind: 'address-feedback', reason: 'your-pr-has-feedback' }]
    return [{ kind: 'review', reason: 'changes-requested-by-others' }]
  }
  if (checksFailed) return [{ kind: 'fix-ci', reason: 'checks-failed' }]
  if (facts.mergeable === false) return [{ kind: 'fix-conflicts', reason: 'merge-conflict' }]
  if (facts.reviewState === 'approved' && facts.mergeable === true && !checksFailed && !checksPending) {
    return [{ kind: 'merge', reason: 'ready-to-merge' }]
  }
  return [{ kind: 'wait', reason: 'waiting' }]
}
