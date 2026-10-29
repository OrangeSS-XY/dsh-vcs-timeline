/**
 * dsh-vcs-timeline — GitLab merge-request provider.
 *
 * GitLab speaks one REST dialect for both paths: `GET {webBase}/api/v4/projects/
 * {url-encoded project path}/merge_requests` with a `PRIVATE-TOKEN` header when
 * the Host authenticated, and without one for public projects. The history read
 * the analytics view opts into adds one call for `state=merged` and one for
 * `state=closed`, bounded by `updated_after` and the same page cap. The detail
 * page adds `/merge_requests/{iid}` (description, pipeline) and `/merge_requests/
 * {iid}/diffs` (changed files).
 *
 * GitLab's merge-request JSON carries no review verdict (approvals need a
 * separate, often licensed endpoint), so `reviewState` stays `none` rather
 * than inventing one. Assigned reviewers are treated as requested reviews,
 * which is what GitLab's UI shows too.
 * @module dsh-vcs-timeline/host/pr/gitlab
 */

import type {
  FileChangeStatus,
  PullRequest,
  PullRequestActor,
  PullRequestCheck,
  PullRequestChecksState,
  PullRequestFile,
  PullRequestReviewState,
  PullRequestState,
} from '../../shared/contracts.ts'
import {
  DEFAULT_PR_HISTORY_DAYS,
  MAX_CLOSED_PULL_REQUESTS,
  MAX_PR_HISTORY_DAYS,
  MAX_PULL_REQUESTS,
} from '../../shared/contracts.ts'
import { deriveActions, reviewRequestedFrom } from './actions.ts'
import {
  asArray,
  asOptionalIso,
  asRecord,
  pickArray,
  pickBoolean,
  pickIso,
  pickNumber,
  pickRecord,
  pickString,
} from './json.ts'
import type { RemoteInfo } from './remote.ts'
import type {
  FetchLike,
  ProviderDetailResult,
  ProviderFailure,
  ProviderListData,
} from './transport.ts'
import { requestJson, USER_AGENT } from './transport.ts'

/** Most changed files a detail page reads. */
export const MAX_DETAIL_FILES = 100

/** Headers every GitLab request carries (the token is added separately). */
const BASE_HEADERS: Record<string, string> = {
  accept: 'application/json',
  'user-agent': USER_AGENT,
}

/** Context shared by every mapping call. */
export interface GitLabMapContext {
  repositoryId: string
  /** ISO timestamp used when the provider sent no usable time. */
  fetchedAt: string
  authenticated: boolean
  viewer: string | null
}

/** One list read. */
export interface GitLabListInput {
  fetchImpl: FetchLike
  remote: RemoteInfo
  token: string | null
  repositoryId: string
  fetchedAt: string
  /**
   * Also read recently merged/closed merge requests. Off unless the caller
   * asks for it: the plain MR tab needs only the open page.
   */
  includeClosed?: boolean
  /** How far back the merged/closed read filters, in days. */
  windowDays?: number
}

/** One detail read. */
export interface GitLabDetailInput extends GitLabListInput {
  number: number
}

/** Normalized list payload plus the closed-history fact the service surfaces. */
export interface GitLabListData extends ProviderListData {
  /** True when the provider cap cut the merged/closed side of the list. */
  historyTruncated?: boolean
}

/** Result of one GitLab list read. */
export type GitLabListResult = { ok: true; value: GitLabListData } | { ok: false; error: ProviderFailure }

/** One mapped merge-request page plus what the mapper could not read. */
interface GitLabPage {
  pullRequests: PullRequest[]
  warnings: string[]
  /** Raw entries the provider returned before mapping. */
  returned: number
}

/** Result of one merge-request page mapping. */
type GitLabPageResult = { ok: true; value: GitLabPage } | { ok: false; error: ProviderFailure }

/** The API base of one GitLab host. */
export function gitlabApiBase(remote: RemoteInfo): string {
  return `${remote.webBase}/api/v4`
}

/** URL-encoded project path (`group/sub/project`). */
function projectPath(remote: RemoteInfo): string {
  return encodeURIComponent(remote.remotePath)
}

/** Headers for one GitLab call; the token never appears anywhere else. */
function gitlabHeaders(token: string | null): Record<string, string> {
  return token === null ? { ...BASE_HEADERS } : { ...BASE_HEADERS, 'private-token': token }
}

/** Map GitLab's merge-request state plus its draft flags. */
export function mapMergeRequestState(record: Record<string, unknown>): PullRequestState {
  const raw = (pickString(record, 'state') ?? '').toLowerCase()
  if (raw === 'merged') return 'merged'
  if (raw === 'closed') return 'closed'
  const draft = pickBoolean(record, 'draft') === true || pickBoolean(record, 'work_in_progress') === true
  return draft ? 'draft' : 'open'
}

/** Map one pipeline status to the contract check state. */
export function mapPipelineCheckState(status: string | undefined): PullRequestCheck['state'] {
  switch (status) {
    case 'success':
      return 'success'
    case 'failed':
      return 'failure'
    case 'running':
    case 'pending':
    case 'created':
    case 'preparing':
    case 'waiting_for_resource':
    case 'scheduled':
      return 'pending'
    default:
      return 'neutral'
  }
}

/** Map one pipeline status to the contract aggregate state. */
export function mapPipelineChecksState(status: string | undefined): PullRequestChecksState {
  switch (status) {
    case 'success':
      return 'success'
    case 'failed':
      return 'failure'
    case 'running':
    case 'pending':
    case 'created':
    case 'preparing':
    case 'waiting_for_resource':
    case 'scheduled':
      return 'pending'
    default:
      return 'none'
  }
}

/** Map a GitLab diff entry to the contract file status. */
function mapDiffStatus(record: Record<string, unknown>): FileChangeStatus {
  if (pickBoolean(record, 'new_file') === true) return 'added'
  if (pickBoolean(record, 'deleted_file') === true) return 'deleted'
  if (pickBoolean(record, 'renamed_file') === true) return 'renamed'
  return 'modified'
}

/** Mergeability of one merge request, from the fields the list already has. */
export function mapMergeRequestMergeable(record: Record<string, unknown>): boolean | null {
  if (pickBoolean(record, 'has_conflicts') === true) return false
  const detailed = (pickString(record, 'detailed_merge_status') ?? '').toLowerCase()
  const simple = (pickString(record, 'merge_status') ?? '').toLowerCase()
  if (detailed === 'mergeable' || simple === 'can_be_merged') return true
  if (detailed === 'conflict' || detailed === 'not_mergeable' || simple === 'cannot_be_merged') return false
  return null
}

/** Map the `reviewers` array to pending reviewers. */
function mapReviewers(record: Record<string, unknown>): PullRequestActor[] {
  const actors: PullRequestActor[] = []
  const seen = new Set<string>()
  for (const entry of pickArray(record, 'reviewers')) {
    const reviewer = asRecord(entry)
    if (reviewer === null) continue
    const login = pickString(reviewer, 'username') ?? pickString(reviewer, 'name')
    if (login === undefined) continue
    const key = login.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    actors.push({ login })
  }
  return actors
}

/** Read `changes_count`, which GitLab sometimes caps with a trailing `+`. */
function changedFileCount(record: Record<string, unknown>): number | undefined {
  const raw = pickString(record, 'changes_count')
  if (raw === undefined) return undefined
  const match = /^(\d+)/.exec(raw)
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

/** Map one merge-request node. */
export function mapMergeRequest(node: unknown, context: GitLabMapContext): PullRequest | null {
  const record = asRecord(node)
  if (record === null) return null
  const number = pickNumber(record, 'iid') ?? pickNumber(record, 'id')
  if (number === undefined || !Number.isInteger(number) || number <= 0) return null
  const title = pickString(record, 'title')
  if (title === undefined) return null
  const authorLogin = pickString(pickRecord(record, 'author'), 'username')
    ?? pickString(pickRecord(record, 'author'), 'name')
    ?? 'ghost'
  const pendingReviewers = mapReviewers(record)
  // No approvals endpoint is read, so no verdict is claimed.
  const reviewState: PullRequestReviewState = 'none'
  const pipeline = pickRecord(record, 'head_pipeline')
  const pipelineStatus = pickString(pipeline, 'status')
  const checksState = pipeline === null ? 'none' : mapPipelineChecksState(pipelineStatus)
  const checks: PullRequestCheck[] = pipeline === null
    ? []
    : [{
      name: 'pipeline',
      state: mapPipelineCheckState(pipelineStatus),
      ...(pickString(pipeline, 'web_url') === undefined ? {} : { url: pickString(pipeline, 'web_url') }),
    }]
  const mergeable = mapMergeRequestMergeable(record)
  const requestedFromViewer = reviewRequestedFrom(pendingReviewers, context.viewer)
  const actions = deriveActions({
    authenticated: context.authenticated,
    viewer: context.viewer,
    authorLogin,
    reviewState,
    checksState,
    mergeable,
    pendingReviewers,
    requestedFromViewer,
  })
  const labels: string[] = []
  for (const label of pickArray(record, 'labels')) {
    const name = typeof label === 'string' ? label.trim() : pickString(asRecord(label), 'name')
    if (name !== undefined && name !== '') labels.push(name)
  }
  const changedFiles = changedFileCount(record)
  const commentCount = pickNumber(record, 'user_notes_count')
  const mergedAt = asOptionalIso(record.merged_at)
  const closedAt = asOptionalIso(record.closed_at)
  return {
    schemaVersion: 1,
    id: `${context.repositoryId}!${number}`,
    repositoryId: context.repositoryId,
    provider: 'gitlab',
    number,
    title,
    url: pickString(record, 'web_url') ?? '',
    state: mapMergeRequestState(record),
    author: { login: authorLogin },
    branch: pickString(record, 'source_branch') ?? '',
    baseBranch: pickString(record, 'target_branch') ?? '',
    createdAt: pickIso(record, 'created_at', context.fetchedAt),
    updatedAt: pickIso(record, 'updated_at', context.fetchedAt),
    ...(mergedAt === undefined ? {} : { mergedAt }),
    ...(closedAt === undefined ? {} : { closedAt }),
    reviewState,
    checksState,
    mergeable,
    reviews: [],
    checks,
    pendingReviewers,
    requestedFromViewer,
    actions,
    ...(changedFiles === undefined ? {} : { changedFiles }),
    ...(commentCount === undefined ? {} : { commentCount }),
    ...(labels.length === 0 ? {} : { labels }),
  }
}

/** Map `/merge_requests/{iid}/diffs` to contract files. */
export function mapMergeRequestDiffs(payload: unknown): PullRequestFile[] {
  const files: PullRequestFile[] = []
  for (const entry of asArray(payload)) {
    const record = asRecord(entry)
    if (record === null) continue
    const path = pickString(record, 'new_path') ?? pickString(record, 'old_path')
    if (path === undefined) continue
    const oldPath = pickString(record, 'old_path')
    files.push({
      path,
      ...(oldPath === undefined || oldPath === path ? {} : { oldPath }),
      status: mapDiffStatus(record),
    })
  }
  return files
}

/** Read the viewer login for an authenticated GitLab token. */
async function fetchGitLabViewer(
  fetchImpl: FetchLike,
  remote: RemoteInfo,
  token: string,
): Promise<string | null> {
  const result = await requestJson(fetchImpl, {
    url: `${gitlabApiBase(remote)}/user`,
    headers: gitlabHeaders(token),
  })
  if (!result.ok) return null
  return pickString(asRecord(result.value), 'username') ?? null
}

/** Build one merge-request list URL with explicit query parameters. */
function mergeRequestsUrl(remote: RemoteInfo, params: Record<string, string>): string {
  const query = new URLSearchParams(params)
  return `${gitlabApiBase(remote)}/projects/${projectPath(remote)}/merge_requests?${query.toString()}`
}

/**
 * Map one merge-request page.
 *
 * An array that maps to nothing is a malformed payload, not an empty page;
 * unmappable individual entries are dropped with a warning.
 */
function mapMergeRequestPage(payload: unknown, context: GitLabMapContext, limit: number): GitLabPageResult {
  if (!Array.isArray(payload)) {
    return { ok: false, error: { kind: 'invalid-json', message: 'the provider returned an unexpected merge-request list' } }
  }
  const pullRequests: PullRequest[] = []
  for (const node of payload) {
    const mapped = mapMergeRequest(node, context)
    if (mapped !== null) pullRequests.push(mapped)
  }
  if (payload.length > 0 && pullRequests.length === 0) {
    return { ok: false, error: { kind: 'invalid-json', message: 'the provider returned merge requests this plugin could not read' } }
  }
  const warnings: string[] = []
  const dropped = payload.length - pullRequests.length
  if (dropped > 0) warnings.push(`${dropped} merge request(s) could not be read`)
  return {
    ok: true,
    value: { pullRequests: pullRequests.slice(0, limit), warnings, returned: payload.length },
  }
}

/** How many days of merged/closed history one read covers. */
function historyWindowDays(input: GitLabListInput): number {
  const requested = input.windowDays
  if (requested === undefined || !Number.isFinite(requested)) return DEFAULT_PR_HISTORY_DAYS
  return Math.max(1, Math.min(MAX_PR_HISTORY_DAYS, Math.trunc(requested)))
}

/** Oldest instant the merged/closed read keeps, in epoch milliseconds. */
function historyStartMs(fetchedAt: string, windowDays: number): number {
  const base = Date.parse(fetchedAt)
  const fetchedMs = Number.isNaN(base) ? Date.now() : base
  return fetchedMs - windowDays * 86_400_000
}

/** Whether one merged/closed merge request still belongs to the history window. */
function withinHistoryWindow(pullRequest: PullRequest, startMs: number): boolean {
  const raw = pullRequest.mergedAt ?? pullRequest.closedAt ?? pullRequest.updatedAt
  const at = Date.parse(raw)
  return !Number.isNaN(at) && at >= startMs
}

/**
 * Read the merge requests of one GitLab project.
 *
 * The open page is read exactly as before; when `includeClosed` is set, the
 * recently merged and recently closed pages are read concurrently, bounded by
 * `updated_after` and the history cap, then window-filtered and appended after
 * the open entries (open first, deduped by number). A failed history read never
 * fails the list: the open entries stay and a warning marks the partial view.
 * When a token is present the viewer is resolved concurrently; a failed viewer
 * lookup only costs the viewer login (with a warning).
 * @param input - transport seam, parsed remote, token, repository id and
 *   optional history flags.
 * @returns the normalized list or a provider failure.
 */
export async function fetchGitLabList(input: GitLabListInput): Promise<GitLabListResult> {
  const headers = gitlabHeaders(input.token)
  const warnings: string[] = []
  const openUrl = mergeRequestsUrl(input.remote, {
    state: 'opened',
    per_page: String(MAX_PULL_REQUESTS),
    order_by: 'updated_at',
    sort: 'desc',
  })
  if (input.includeClosed !== true) {
    let viewer: string | null = null
    let listResult: Awaited<ReturnType<typeof requestJson>>
    if (input.token === null) {
      listResult = await requestJson(input.fetchImpl, { url: openUrl, headers })
    } else {
      const [requests, viewerLogin] = await Promise.all([
        requestJson(input.fetchImpl, { url: openUrl, headers }),
        fetchGitLabViewer(input.fetchImpl, input.remote, input.token),
      ])
      listResult = requests
      viewer = viewerLogin
      if (viewer === null) warnings.push('the authenticated GitLab viewer could not be resolved')
    }
    if (!listResult.ok) return listResult
    const context: GitLabMapContext = {
      repositoryId: input.repositoryId,
      fetchedAt: input.fetchedAt,
      authenticated: input.token !== null,
      viewer,
    }
    const page = mapMergeRequestPage(listResult.value, context, MAX_PULL_REQUESTS)
    if (!page.ok) return page
    return {
      ok: true,
      value: {
        viewer,
        pullRequests: page.value.pullRequests,
        warnings: [...warnings, ...page.value.warnings],
      },
    }
  }

  const startMs = historyStartMs(input.fetchedAt, historyWindowDays(input))
  const historyParams = {
    per_page: String(MAX_CLOSED_PULL_REQUESTS),
    order_by: 'updated_at',
    sort: 'desc',
    updated_after: new Date(startMs).toISOString(),
  }
  const mergedUrl = mergeRequestsUrl(input.remote, { state: 'merged', ...historyParams })
  const closedUrl = mergeRequestsUrl(input.remote, { state: 'closed', ...historyParams })
  const viewerPromise: Promise<string | null> = input.token === null
    ? Promise.resolve(null)
    : fetchGitLabViewer(input.fetchImpl, input.remote, input.token)
  const [openResult, mergedResult, closedResult, viewerLogin] = await Promise.all([
    requestJson(input.fetchImpl, { url: openUrl, headers }),
    requestJson(input.fetchImpl, { url: mergedUrl, headers }),
    requestJson(input.fetchImpl, { url: closedUrl, headers }),
    viewerPromise,
  ])
  if (!openResult.ok) return openResult
  const viewer = viewerLogin
  if (input.token !== null && viewer === null) warnings.push('the authenticated GitLab viewer could not be resolved')
  const context: GitLabMapContext = {
    repositoryId: input.repositoryId,
    fetchedAt: input.fetchedAt,
    authenticated: input.token !== null,
    viewer,
  }
  const openPage = mapMergeRequestPage(openResult.value, context, MAX_PULL_REQUESTS)
  if (!openPage.ok) return openPage
  warnings.push(...openPage.value.warnings)
  const history: PullRequest[] = []
  let historyTruncated = false
  const historyReads: Array<{ label: string; result: Awaited<ReturnType<typeof requestJson>> }> = [
    { label: 'merged', result: mergedResult },
    { label: 'closed', result: closedResult },
  ]
  for (const read of historyReads) {
    const page = read.result.ok
      ? mapMergeRequestPage(read.result.value, context, MAX_CLOSED_PULL_REQUESTS)
      : read.result
    if (!page.ok) {
      warnings.push(`the recently ${read.label} merge requests could not be read`)
      continue
    }
    warnings.push(...page.value.warnings)
    if (page.value.returned >= MAX_CLOSED_PULL_REQUESTS) historyTruncated = true
    for (const pullRequest of page.value.pullRequests) {
      if (withinHistoryWindow(pullRequest, startMs)) history.push(pullRequest)
    }
  }
  history.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  // GitLab has no single "merged or closed" state filter, so two capped pages
  // are read; the combined history still honours the contract's single cap.
  const openNumbers = new Set(openPage.value.pullRequests.map(pullRequest => pullRequest.number))
  const freshHistory = history.filter(pullRequest => !openNumbers.has(pullRequest.number))
  const keptHistory = freshHistory.slice(0, MAX_CLOSED_PULL_REQUESTS)
  if (freshHistory.length > keptHistory.length) historyTruncated = true
  const value: GitLabListData = {
    viewer,
    pullRequests: [...openPage.value.pullRequests, ...keptHistory],
    warnings,
    ...(historyTruncated ? { historyTruncated } : {}),
  }
  return { ok: true, value }
}

/** Read one merge request plus its diffs. */
export async function fetchGitLabDetail(input: GitLabDetailInput): Promise<ProviderDetailResult> {
  const headers = gitlabHeaders(input.token)
  const base = `${gitlabApiBase(input.remote)}/projects/${projectPath(input.remote)}/merge_requests/${input.number}`
  const [mrResult, diffsResult] = await Promise.all([
    requestJson(input.fetchImpl, { url: base, headers }),
    requestJson(input.fetchImpl, { url: `${base}/diffs?per_page=${MAX_DETAIL_FILES}`, headers }),
  ])
  if (!mrResult.ok) return mrResult
  const record = asRecord(mrResult.value)
  if (record === null) {
    return { ok: false, error: { kind: 'invalid-json', message: 'the provider returned an unexpected merge request' } }
  }
  let viewer: string | null = null
  if (input.token !== null) viewer = await fetchGitLabViewer(input.fetchImpl, input.remote, input.token)
  const context: GitLabMapContext = {
    repositoryId: input.repositoryId,
    fetchedAt: input.fetchedAt,
    authenticated: input.token !== null,
    viewer,
  }
  const pullRequest = mapMergeRequest(record, context)
  if (pullRequest === null) {
    return { ok: false, error: { kind: 'invalid-json', message: 'the provider returned a merge request this plugin could not read' } }
  }
  const warnings: string[] = []
  let files: PullRequestFile[] = []
  if (diffsResult.ok) files = mapMergeRequestDiffs(diffsResult.value)
  else warnings.push('the changed files of this merge request could not be read')
  if (input.token !== null && viewer === null) warnings.push('the authenticated GitLab viewer could not be resolved')
  const body = pickString(record, 'description')
  return {
    ok: true,
    value: {
      pullRequest,
      files: files.slice(0, MAX_DETAIL_FILES),
      ...(body === undefined ? {} : { body }),
      warnings,
    },
  }
}
