/**
 * dsh-vcs-timeline — GitHub pull-request provider.
 *
 * Two read paths, both bounded by the transport:
 * - authenticated: ONE GraphQL POST for the list (viewer, review decision,
 *   rollup, requested reviewers, counts, labels) plus, when the analytics
 *   view asks for it, a second GraphQL POST for recently merged/closed pull
 *   requests; one GraphQL POST plus one REST files call for the detail;
 * - anonymous: the public REST list and detail endpoints, which carry no
 *   review or CI facts, so those fields stay honestly empty/none and the
 *   actions become `unknown`/`needs-auth`; opting into history adds one more
 *   REST list call with `state=closed`.
 *
 * Mapping is pure: payload tests feed recorded JSON and never touch the
 * network. Provider text quoted in an error is redacted and bounded.
 * @module dsh-vcs-timeline/host/pr/github
 */

import type {
  FileChangeStatus,
  PullRequest,
  PullRequestActor,
  PullRequestChecksState,
  PullRequestFile,
  PullRequestReview,
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
import { redact } from './auth.ts'
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
  ProviderListResult,
} from './transport.ts'
import { requestJson, USER_AGENT } from './transport.ts'

/** REST base URL. */
export const GITHUB_API_BASE = 'https://api.github.com'
/** GraphQL endpoint. */
export const GITHUB_GRAPHQL_URL = `${GITHUB_API_BASE}/graphql`

/** Most changed files a detail page reads. */
export const MAX_DETAIL_FILES = 100

/** Headers every GitHub request carries (no credentials here). */
const BASE_HEADERS: Record<string, string> = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': USER_AGENT,
}

/** Fields every mapped list node needs; kept identical to the contract facts. */
function pullRequestFields(includeTeams: boolean): string {
  return `
  number
  title
  url
  isDraft
  createdAt
  updatedAt
  author { login }
  headRefName
  baseRefName
  reviewDecision
  mergeable
  reviewRequests(first: 20) {
    nodes { requestedReviewer { ... on User { login }${includeTeams ? ' ... on Team { name }' : ''} } }
  }
  latestReviews(first: 20) {
    nodes { author { login } state submittedAt }
  }
  commits { totalCount }
  comments { totalCount }
  additions
  deletions
  changedFiles
  statusCheckRollup { state }
  labels(first: 10) { nodes { name } }
`
}

/** Full field set: user and team review requests. */
const PULL_REQUEST_FIELDS = pullRequestFields(true)
/**
 * Same facts without team reviewer names.
 *
 * `Team.name` requires the `read:org` (or `read:discussion`) scope, which a
 * classic token scoped to `repo` does not have. Team *review requests* are a
 * nice-to-have fact: dropping just that selection keeps private-repository PR
 * reading working instead of failing the whole query.
 */
const PULL_REQUEST_FIELDS_REDUCED = pullRequestFields(false)

/** Lifecycle facts the history read and the detail read ask for. */
const PULL_REQUEST_LIFECYCLE_FIELDS = `
  state
  mergedAt
  closedAt
`

/** Build one list query with the given field set. */
function listQuery(fields: string): string {
  return `query TimelinePullRequests($owner: String!, $name: String!, $first: Int!) {
  rateLimit { remaining resetAt }
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequests(first: $first, states: [OPEN], orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {${fields}}
    }
  }
}`
}

/** Build one merged/closed history query with the given field set. */
function closedQuery(fields: string): string {
  return `query TimelineClosedPullRequests($owner: String!, $name: String!, $first: Int!) {
  rateLimit { remaining resetAt }
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequests(first: $first, states: [MERGED, CLOSED], orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {${fields}${PULL_REQUEST_LIFECYCLE_FIELDS}}
    }
  }
}`
}

/** Build one detail query with the given field set. */
function detailQuery(fields: string): string {
  return `query TimelinePullRequestDetail($owner: String!, $name: String!, $number: Int!) {
  rateLimit { remaining resetAt }
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      ${fields}
      ${PULL_REQUEST_LIFECYCLE_FIELDS}
      body
    }
  }
}`
}

/** List query: open pull requests, newest activity first. */
export const GITHUB_LIST_QUERY = listQuery(PULL_REQUEST_FIELDS)
/** Reduced-scope variant of {@link GITHUB_LIST_QUERY}. */
const GITHUB_LIST_QUERY_REDUCED = listQuery(PULL_REQUEST_FIELDS_REDUCED)

/**
 * History query: recently merged/closed pull requests, newest activity first.
 *
 * It reuses {@link PULL_REQUEST_FIELDS} so the mapped contract facts stay
 * identical to the open read, and adds the lifecycle facts (`state`,
 * `mergedAt`, `closedAt`) the analytics view reports.
 */
export const GITHUB_CLOSED_QUERY = closedQuery(PULL_REQUEST_FIELDS)
/** Reduced-scope variant of {@link GITHUB_CLOSED_QUERY}. */
const GITHUB_CLOSED_QUERY_REDUCED = closedQuery(PULL_REQUEST_FIELDS_REDUCED)

/** Detail query: one pull request with its lifecycle state and description. */
export const GITHUB_DETAIL_QUERY = detailQuery(PULL_REQUEST_FIELDS)
/** Reduced-scope variant of {@link GITHUB_DETAIL_QUERY}. */
const GITHUB_DETAIL_QUERY_REDUCED = detailQuery(PULL_REQUEST_FIELDS_REDUCED)

/** Context shared by every mapping call. */
export interface GitHubMapContext {
  repositoryId: string
  /** ISO timestamp used when the provider sent no usable time. */
  fetchedAt: string
  authenticated: boolean
  viewer: string | null
  /** Map mergeability from a REST payload (detail reads report it). */
  includeMergeable?: boolean
}

/** One list read: transport seam, parsed remote and auth token. */
export interface GitHubListInput {
  fetchImpl: FetchLike
  remote: RemoteInfo
  token: string | null
  repositoryId: string
  fetchedAt: string
  /**
   * Also read recently merged/closed pull requests. Off unless the caller asks
   * for it: the plain PR tab needs only the open page, and the history read
   * costs one more provider request.
   */
  includeClosed?: boolean
  /** How far back the merged/closed read filters, in days. */
  windowDays?: number
}

/** One detail read. */
export interface GitHubDetailInput extends GitHubListInput {
  number: number
}

/** Normalized list payload plus the closed-history fact the service surfaces. */
export interface GitHubListData extends ProviderListData {
  /** True when the provider cap cut the merged/closed side of the list. */
  historyTruncated?: boolean
}

/** Result of one GitHub list read. */
export type GitHubListResult = { ok: true; value: GitHubListData } | { ok: false; error: ProviderFailure }

/** Mapped merged/closed page plus what the mapper could not read. */
interface GitHubClosedPage {
  pullRequests: PullRequest[]
  warnings: string[]
  /** True when the provider filled the history cap, so older entries exist. */
  truncated: boolean
}

/** Result of one merged/closed history read. */
type GitHubClosedResult = { ok: true; value: GitHubClosedPage } | { ok: false; error: ProviderFailure }

/** A GitHub owner/repository pair, or null when the remote is not one. */
export function githubTarget(remote: RemoteInfo): { owner: string; name: string } | null {
  const segments = remote.remotePath.split('/')
  if (segments.length !== 2) return null
  const owner = segments[0] ?? ''
  const name = segments[1] ?? ''
  if (owner === '' || name === '') return null
  return { owner, name }
}

/** Map GitHub's review decision to the contract enum. */
export function mapReviewDecision(value: string | undefined): PullRequestReviewState {
  switch (value) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes-requested'
    case 'REVIEW_REQUIRED':
      return 'review-required'
    default:
      return 'none'
  }
}

/**
 * Map `statusCheckRollup.state` to the contract enum.
 *
 * `ERROR` is a failed check; `EXPECTED` means required checks have not reported
 * yet, which blocks a merge exactly like `PENDING` does.
 */
export function mapRollupState(value: string | undefined): PullRequestChecksState {
  switch (value) {
    case 'SUCCESS':
      return 'success'
    case 'FAILURE':
    case 'ERROR':
      return 'failure'
    case 'PENDING':
    case 'EXPECTED':
      return 'pending'
    default:
      return 'none'
  }
}

/** Map GraphQL's `MergeableState`; null when it did not report one. */
export function mapMergeable(value: string | undefined): boolean | null {
  if (value === 'MERGEABLE') return true
  if (value === 'CONFLICTING') return false
  return null
}

/** Map one GraphQL review verdict; unknown verdicts are dropped, not guessed. */
function mapReviewVerdict(value: string | undefined): PullRequestReview['state'] | null {
  switch (value) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes-requested'
    case 'COMMENTED':
      return 'commented'
    case 'PENDING':
      return 'pending'
    case 'DISMISSED':
      return 'dismissed'
    default:
      return null
  }
}

/** Map a GraphQL lifecycle state (detail only) plus the draft flag. */
function mapLifecycleState(record: Record<string, unknown>): PullRequestState {
  const raw = (pickString(record, 'state') ?? '').toUpperCase()
  if (raw === 'MERGED') return 'merged'
  if (raw === 'CLOSED') return 'closed'
  return pickBoolean(record, 'isDraft') === true ? 'draft' : 'open'
}

/** Map one REST `state` + `draft` + `merged_at` triple. */
function mapRestLifecycleState(record: Record<string, unknown>): PullRequestState {
  if (pickString(record, 'merged_at') !== undefined) return 'merged'
  const raw = (pickString(record, 'state') ?? '').toLowerCase()
  if (raw === 'merged') return 'merged'
  if (raw === 'closed') return 'closed'
  return pickBoolean(record, 'draft') === true ? 'draft' : 'open'
}

/** Map REST file status to the contract enum. */
export function mapRestFileStatus(value: string | undefined): FileChangeStatus {
  switch (value) {
    case 'added':
      return 'added'
    case 'removed':
      return 'deleted'
    case 'modified':
    case 'changed':
      return 'modified'
    case 'renamed':
      return 'renamed'
    case 'copied':
      return 'copied'
    default:
      return 'unknown'
  }
}

/** Build one mapped {@link PullRequestReview} from a GraphQL node. */
function mapGraphQLReview(value: unknown): PullRequestReview | null {
  const record = asRecord(value)
  if (record === null) return null
  const state = mapReviewVerdict(pickString(record, 'state'))
  if (state === null) return null
  const login = pickString(pickRecord(record, 'author'), 'login')
  if (login === undefined) return null
  const submittedAt = asOptionalIso(record.submittedAt)
  return {
    author: { login },
    state,
    ...(submittedAt === undefined ? {} : { submittedAt }),
  }
}

/** Build the pending-reviewer list from `reviewRequests`. */
function mapGraphQLRequestedReviewers(record: Record<string, unknown>): PullRequestActor[] {
  const connection = pickRecord(record, 'reviewRequests')
  const actors: PullRequestActor[] = []
  const seen = new Set<string>()
  for (const entry of pickArray(connection, 'nodes')) {
    const requested = pickRecord(asRecord(entry), 'requestedReviewer')
    const login = pickString(requested, 'login') ?? pickString(requested, 'name')
    if (login === undefined) continue
    const key = login.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    actors.push({ login })
  }
  return actors
}

/**
 * Map one GraphQL pull-request node.
 *
 * Returns null when the node lacks the identity facts the contract requires
 * (a positive number and a title); the caller then drops it and reports a
 * warning instead of inventing values.
 */
export function mapGraphQLPullRequest(node: unknown, context: GitHubMapContext): PullRequest | null {
  const record = asRecord(node)
  if (record === null) return null
  const number = pickNumber(record, 'number')
  if (number === undefined || !Number.isInteger(number) || number <= 0) return null
  const title = pickString(record, 'title')
  if (title === undefined) return null
  const authorLogin = pickString(pickRecord(record, 'author'), 'login') ?? 'ghost'
  const pendingReviewers = mapGraphQLRequestedReviewers(record)
  const reviewState = mapReviewDecision(pickString(record, 'reviewDecision'))
  const checksState = mapRollupState(pickString(pickRecord(record, 'statusCheckRollup'), 'state'))
  const mergeable = mapMergeable(pickString(record, 'mergeable'))
  const requestedFromViewer = reviewRequestedFrom(pendingReviewers, context.viewer)
  const author: PullRequestActor = { login: authorLogin }
  const reviews: PullRequestReview[] = []
  for (const reviewNode of pickArray(pickRecord(record, 'latestReviews'), 'nodes')) {
    const review = mapGraphQLReview(reviewNode)
    if (review !== null) reviews.push(review)
  }
  const labels: string[] = []
  for (const labelNode of pickArray(pickRecord(record, 'labels'), 'nodes')) {
    const name = pickString(asRecord(labelNode), 'name')
    if (name !== undefined) labels.push(name)
  }
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
  const mergedAt = asOptionalIso(record.mergedAt)
  const closedAt = asOptionalIso(record.closedAt)
  const pullRequest: PullRequest = {
    schemaVersion: 1,
    id: `${context.repositoryId}#${number}`,
    repositoryId: context.repositoryId,
    provider: 'github',
    number,
    title,
    url: pickString(record, 'url') ?? '',
    state: mapLifecycleState(record),
    author,
    branch: pickString(record, 'headRefName') ?? '',
    baseBranch: pickString(record, 'baseRefName') ?? '',
    createdAt: pickIso(record, 'createdAt', context.fetchedAt),
    updatedAt: pickIso(record, 'updatedAt', context.fetchedAt),
    ...(mergedAt === undefined ? {} : { mergedAt }),
    ...(closedAt === undefined ? {} : { closedAt }),
    reviewState,
    checksState,
    mergeable,
    reviews,
    checks: [],
    pendingReviewers,
    requestedFromViewer,
    actions,
    ...(pickNumber(record, 'changedFiles') === undefined ? {} : { changedFiles: pickNumber(record, 'changedFiles') }),
    ...(pickNumber(record, 'additions') === undefined ? {} : { additions: pickNumber(record, 'additions') }),
    ...(pickNumber(record, 'deletions') === undefined ? {} : { deletions: pickNumber(record, 'deletions') }),
    ...(pickNumber(pickRecord(record, 'commits'), 'totalCount') === undefined
      ? {}
      : { commitCount: pickNumber(pickRecord(record, 'commits'), 'totalCount') }),
    ...(pickNumber(pickRecord(record, 'comments'), 'totalCount') === undefined
      ? {}
      : { commentCount: pickNumber(pickRecord(record, 'comments'), 'totalCount') }),
    ...(labels.length === 0 ? {} : { labels }),
  }
  return pullRequest
}

/** Map one anonymous REST pull-request object (no review or CI facts). */
export function mapRestPullRequest(node: unknown, context: GitHubMapContext): PullRequest | null {
  const record = asRecord(node)
  if (record === null) return null
  const number = pickNumber(record, 'number')
  if (number === undefined || !Number.isInteger(number) || number <= 0) return null
  const title = pickString(record, 'title')
  if (title === undefined) return null
  const authorLogin = pickString(pickRecord(record, 'user'), 'login') ?? 'ghost'
  const reviewState: PullRequestReviewState = 'none'
  const checksState: PullRequestChecksState = 'none'
  const mergeable = context.includeMergeable === true
    ? (pickBoolean(record, 'mergeable') ?? null)
    : null
  const pendingReviewers: PullRequestActor[] = []
  const requestedFromViewer = false
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
    const name = pickString(asRecord(label), 'name')
    if (name !== undefined) labels.push(name)
  }
  const changedFiles = pickNumber(record, 'changed_files')
  const additions = pickNumber(record, 'additions')
  const deletions = pickNumber(record, 'deletions')
  const commentCount = pickNumber(record, 'comments')
  const commitCount = pickNumber(record, 'commits')
  const mergedAt = asOptionalIso(record.merged_at)
  const closedAt = asOptionalIso(record.closed_at)
  return {
    schemaVersion: 1,
    id: `${context.repositoryId}#${number}`,
    repositoryId: context.repositoryId,
    provider: 'github',
    number,
    title,
    url: pickString(record, 'html_url') ?? '',
    state: mapRestLifecycleState(record),
    author: { login: authorLogin },
    branch: pickString(pickRecord(record, 'head'), 'ref') ?? '',
    baseBranch: pickString(pickRecord(record, 'base'), 'ref') ?? '',
    createdAt: pickIso(record, 'created_at', context.fetchedAt),
    updatedAt: pickIso(record, 'updated_at', context.fetchedAt),
    ...(mergedAt === undefined ? {} : { mergedAt }),
    ...(closedAt === undefined ? {} : { closedAt }),
    reviewState,
    checksState,
    mergeable,
    reviews: [],
    checks: [],
    pendingReviewers,
    requestedFromViewer,
    actions,
    ...(changedFiles === undefined ? {} : { changedFiles }),
    ...(additions === undefined ? {} : { additions }),
    ...(deletions === undefined ? {} : { deletions }),
    ...(commitCount === undefined ? {} : { commitCount }),
    ...(commentCount === undefined ? {} : { commentCount }),
    ...(labels.length === 0 ? {} : { labels }),
  }
}

/** Map a REST `/pulls/{n}/files` payload to contract files. */
export function mapRestFiles(payload: unknown): PullRequestFile[] {
  const files: PullRequestFile[] = []
  for (const entry of asArray(payload)) {
    const record = asRecord(entry)
    if (record === null) continue
    const path = pickString(record, 'filename')
    if (path === undefined) continue
    const oldPath = pickString(record, 'previous_filename')
    const additions = pickNumber(record, 'additions')
    const deletions = pickNumber(record, 'deletions')
    files.push({
      path,
      ...(oldPath === undefined ? {} : { oldPath }),
      status: mapRestFileStatus(pickString(record, 'status')),
      ...(additions === undefined ? {} : { additions }),
      ...(deletions === undefined ? {} : { deletions }),
    })
  }
  return files
}

/** Extract `data.viewer.login` from a GraphQL payload. */
function graphqlViewer(payload: unknown): string | null {
  const data = pickRecord(asRecord(payload), 'data')
  return pickString(pickRecord(data, 'viewer'), 'login') ?? null
}

/** Read the GraphQL rate-limit reset hint when the payload carries one. */
function graphqlResetAt(payload: unknown): string | undefined {
  const data = pickRecord(asRecord(payload), 'data')
  const resetAt = pickString(pickRecord(data, 'rateLimit'), 'resetAt')
  if (resetAt === undefined) return undefined
  const date = new Date(resetAt)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/**
 * Warning appended when a query had to drop team-reviewer names.
 *
 * The list is still complete for open/closed facts; only "requested team
 * reviewers" is not reported, so the UI says so instead of pretending the set
 * of pending reviewers is complete.
 */
const REDUCED_SCOPE_WARNING = 'team review requests were omitted: the token lacks the read:org scope'

/** Whether a GraphQL payload failed only because the token lacks a scope. */
function isInsufficientScopes(payload: unknown): boolean {
  const root = asRecord(payload)
  if (root === null) return false
  for (const entry of asArray(root.errors)) {
    const record = asRecord(entry)
    if (record === null) continue
    const type = (pickString(record, 'type') ?? '').toUpperCase()
    if (type === 'INSUFFICIENT_SCOPES') return true
    const message = pickString(record, 'message') ?? ''
    if (/required scopes|read:org|read:discussion/i.test(message)) return true
  }
  return false
}

/** One GraphQL POST; the token only ever travels in the authorization header. */
function postGraphQL(
  fetchImpl: FetchLike,
  token: string | null,
  query: string,
  variables: Record<string, unknown>,
): ReturnType<typeof requestJson> {
  const headers: Record<string, string> = { ...BASE_HEADERS, 'content-type': 'application/json' }
  if (token !== null && token !== '') headers.authorization = `bearer ${token}`
  return requestJson(fetchImpl, {
    url: GITHUB_GRAPHQL_URL,
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  })
}

/** One GraphQL attempt plus whether the reduced-scope query was needed. */
interface ScopedGraphQLResult {
  result: Awaited<ReturnType<typeof requestJson>>
  reduced: boolean
}

/**
 * Run one authenticated GraphQL query, retrying once without team fields when
 * GitHub rejects the first attempt for missing `read:org`.
 *
 * Only the scope rejection is retried: a rate limit, a bad credential or a
 * malformed payload must surface as the real failure instead of being masked by
 * a second request. Tokens that do have the scope keep the richer query.
 */
async function postGraphQLWithScopeFallback(
  fetchImpl: FetchLike,
  token: string | null,
  fullQuery: string,
  reducedQuery: string,
  variables: Record<string, unknown>,
): Promise<ScopedGraphQLResult> {
  const first = await postGraphQL(fetchImpl, token, fullQuery, variables)
  if (!first.ok || !isInsufficientScopes(first.value)) return { result: first, reduced: false }
  const second = await postGraphQL(fetchImpl, token, reducedQuery, variables)
  return { result: second, reduced: true }
}

/**
 * Map GraphQL `errors` to a provider failure, or null when there are none.
 *
 * Rate limiting is its own failure so the service can surface the reset hint;
 * auth-shaped errors become `unauthorized` so the service reports
 * `auth-required`. The provider's own message is redacted and bounded.
 */
function graphqlFailure(payload: unknown): ProviderFailure | null {
  const root = asRecord(payload)
  if (root === null) {
    return { kind: 'invalid-json', message: 'the provider returned an unexpected payload' }
  }
  const errors = asArray(root.errors)
  if (errors.length === 0) return null
  const first = asRecord(errors[0])
  const type = (pickString(first, 'type') ?? '').toUpperCase()
  const message = pickString(first, 'message')
  const detail = message === undefined ? '' : `: ${redact(message, 200)}`
  if (type === 'RATE_LIMITED') {
    const resetAt = graphqlResetAt(payload)
    return {
      kind: 'rate-limited',
      message: `the provider rate limit was reached${detail}`,
      ...(resetAt === undefined ? {} : { resetAt }),
    }
  }
  if (type === 'FORBIDDEN' || type === 'UNAUTHORIZED' || type === 'BAD_CREDENTIALS') {
    return { kind: 'unauthorized', status: 403, message: `the provider rejected the query${detail}` }
  }
  if (type === 'NOT_FOUND') {
    return { kind: 'not-found', message: `the provider reported that the resource does not exist${detail}` }
  }
  return { kind: 'http', status: 200, message: `the provider rejected the query${detail}` }
}

/**
 * Map a node list, dropping unusable nodes and reporting the loss instead of
 * silently shrinking the list (an all-unreadable page is a malformed payload,
 * not an empty result).
 */
function mapGraphQLNodes(
  nodes: unknown[],
  context: GitHubMapContext,
  limit: number = MAX_PULL_REQUESTS,
): { pullRequests: PullRequest[]; warnings: string[] } {
  const pullRequests: PullRequest[] = []
  for (const node of nodes) {
    const mapped = mapGraphQLPullRequest(node, context)
    if (mapped !== null) pullRequests.push(mapped)
  }
  const warnings: string[] = []
  const dropped = nodes.length - pullRequests.length
  if (dropped > 0) {
    warnings.push(
      pullRequests.length === 0
        ? 'the provider returned pull requests this plugin could not read'
        : `${dropped} pull request(s) could not be read`,
    )
  }
  return { pullRequests: pullRequests.slice(0, limit), warnings }
}

/** Authenticated list: one GraphQL call (with a scope-safe retry). */
async function authenticatedList(input: GitHubListInput, owner: string, name: string): Promise<ProviderListResult> {
  const scoped = await postGraphQLWithScopeFallback(
    input.fetchImpl,
    input.token,
    GITHUB_LIST_QUERY,
    GITHUB_LIST_QUERY_REDUCED,
    { owner, name, first: MAX_PULL_REQUESTS },
  )
  const result = scoped.result
  if (!result.ok) return result
  const failure = graphqlFailure(result.value)
  if (failure !== null) return { ok: false, error: failure }
  const data = pickRecord(asRecord(result.value), 'data')
  const repository = pickRecord(data, 'repository')
  if (repository === null) {
    return {
      ok: false,
      error: { kind: 'unauthorized', status: 403, message: 'the provider did not return the repository' },
    }
  }
  const viewer = graphqlViewer(result.value)
  const connection = pickRecord(repository, 'pullRequests')
  const mapped = mapGraphQLNodes(pickArray(connection, 'nodes'), {
    repositoryId: input.repositoryId,
    fetchedAt: input.fetchedAt,
    authenticated: true,
    viewer,
  })
  const warnings = scoped.reduced ? [...mapped.warnings, REDUCED_SCOPE_WARNING] : mapped.warnings
  const value: ProviderListData = { viewer, pullRequests: mapped.pullRequests, warnings }
  return { ok: true, value }
}

/** Anonymous list: the public REST endpoint, no credentials. */
async function anonymousList(input: GitHubListInput, owner: string, name: string): Promise<ProviderListResult> {
  const query = new URLSearchParams({
    state: 'open',
    per_page: String(MAX_PULL_REQUESTS),
    sort: 'updated',
    direction: 'desc',
  })
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?${query.toString()}`
  const result = await requestJson(input.fetchImpl, { url, headers: BASE_HEADERS })
  if (!result.ok) return result
  const nodes = asArray(result.value)
  if (!Array.isArray(result.value)) {
    return { ok: false, error: { kind: 'invalid-json', message: 'the provider returned an unexpected pull-request list' } }
  }
  const context: GitHubMapContext = {
    repositoryId: input.repositoryId,
    fetchedAt: input.fetchedAt,
    authenticated: false,
    viewer: null,
  }
  const pullRequests: PullRequest[] = []
  for (const node of nodes) {
    const mapped = mapRestPullRequest(node, context)
    if (mapped !== null) pullRequests.push(mapped)
  }
  if (nodes.length > 0 && pullRequests.length === 0) {
    return { ok: false, error: { kind: 'invalid-json', message: 'the provider returned an unexpected pull-request list' } }
  }
  const warnings: string[] = []
  const dropped = nodes.length - pullRequests.length
  if (dropped > 0) warnings.push(`${dropped} pull request(s) could not be read`)
  return {
    ok: true,
    value: {
      viewer: null,
      pullRequests: pullRequests.slice(0, MAX_PULL_REQUESTS),
      warnings,
    },
  }
}

/** Authenticated history: one GraphQL call for merged/closed pull requests. */
async function authenticatedClosedList(
  input: GitHubListInput,
  owner: string,
  name: string,
): Promise<GitHubClosedResult> {
  const scoped = await postGraphQLWithScopeFallback(
    input.fetchImpl,
    input.token,
    GITHUB_CLOSED_QUERY,
    GITHUB_CLOSED_QUERY_REDUCED,
    { owner, name, first: MAX_CLOSED_PULL_REQUESTS },
  )
  const result = scoped.result
  if (!result.ok) return result
  const failure = graphqlFailure(result.value)
  if (failure !== null) return { ok: false, error: failure }
  const repository = pickRecord(pickRecord(asRecord(result.value), 'data'), 'repository')
  if (repository === null) {
    return {
      ok: false,
      error: { kind: 'unauthorized', status: 403, message: 'the provider did not return the repository' },
    }
  }
  const viewer = graphqlViewer(result.value)
  const nodes = pickArray(pickRecord(repository, 'pullRequests'), 'nodes')
  const mapped = mapGraphQLNodes(
    nodes,
    {
      repositoryId: input.repositoryId,
      fetchedAt: input.fetchedAt,
      authenticated: true,
      viewer,
    },
    MAX_CLOSED_PULL_REQUESTS,
  )
  return {
    ok: true,
    value: {
      pullRequests: mapped.pullRequests,
      warnings: scoped.reduced ? [...mapped.warnings, REDUCED_SCOPE_WARNING] : mapped.warnings,
      truncated: nodes.length >= MAX_CLOSED_PULL_REQUESTS,
    },
  }
}

/** Anonymous history: the public REST endpoint with `state=closed`. */
async function anonymousClosedList(
  input: GitHubListInput,
  owner: string,
  name: string,
): Promise<GitHubClosedResult> {
  const query = new URLSearchParams({
    state: 'closed',
    per_page: String(MAX_CLOSED_PULL_REQUESTS),
    sort: 'updated',
    direction: 'desc',
  })
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls?${query.toString()}`
  const result = await requestJson(input.fetchImpl, { url, headers: BASE_HEADERS })
  if (!result.ok) return result
  if (!Array.isArray(result.value)) {
    return { ok: false, error: { kind: 'invalid-json', message: 'the provider returned an unexpected pull-request list' } }
  }
  const context: GitHubMapContext = {
    repositoryId: input.repositoryId,
    fetchedAt: input.fetchedAt,
    authenticated: false,
    viewer: null,
  }
  const nodes = asArray(result.value)
  const pullRequests: PullRequest[] = []
  for (const node of nodes) {
    const mapped = mapRestPullRequest(node, context)
    if (mapped !== null) pullRequests.push(mapped)
  }
  if (nodes.length > 0 && pullRequests.length === 0) {
    return { ok: false, error: { kind: 'invalid-json', message: 'the provider returned an unexpected pull-request list' } }
  }
  const warnings: string[] = []
  const dropped = nodes.length - pullRequests.length
  if (dropped > 0) warnings.push(`${dropped} pull request(s) could not be read`)
  return {
    ok: true,
    value: {
      pullRequests: pullRequests.slice(0, MAX_CLOSED_PULL_REQUESTS),
      warnings,
      truncated: nodes.length >= MAX_CLOSED_PULL_REQUESTS,
    },
  }
}

/** How many days of merged/closed history one read covers. */
function historyWindowDays(input: GitHubListInput): number {
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

/**
 * Whether one merged/closed pull request still belongs to the history window.
 *
 * The lifecycle timestamp is preferred over `updatedAt`, so an old merge that
 * merely received a late comment is still reported as history rather than as
 * a fresh merge.
 */
function withinHistoryWindow(pullRequest: PullRequest, startMs: number): boolean {
  const raw = pullRequest.mergedAt ?? pullRequest.closedAt ?? pullRequest.updatedAt
  const at = Date.parse(raw)
  return !Number.isNaN(at) && at >= startMs
}

/** Append closed-history entries after the open page, one entry per number. */
function withClosedHistory(open: PullRequest[], closed: PullRequest[]): PullRequest[] {
  const seen = new Set(open.map(pullRequest => pullRequest.number))
  const combined = [...open]
  for (const pullRequest of closed) {
    if (seen.has(pullRequest.number)) continue
    seen.add(pullRequest.number)
    combined.push(pullRequest)
  }
  return combined
}

/**
 * Read the pull requests of one GitHub repository.
 *
 * The open page is read exactly as before; when `includeClosed` is set, the
 * recently merged/closed page is read concurrently, window-filtered, appended
 * after the open entries (open first, deduped by number) and its cap reported
 * as `historyTruncated`. A failed history read never fails the list: the open
 * entries stay and a warning marks the partial view.
 * @param input - transport seam, parsed remote, token, repository id and
 *   optional history flags.
 * @returns the normalized list or a provider failure.
 */
export async function fetchGitHubList(input: GitHubListInput): Promise<GitHubListResult> {
  const target = githubTarget(input.remote)
  if (target === null) {
    return {
      ok: false,
      error: { kind: 'unsupported-remote', message: 'this GitHub remote path is not an owner/repository pair' },
    }
  }
  const authenticated = input.token !== null
  const readOpen = async (): Promise<ProviderListResult> => authenticated
    ? authenticatedList(input, target.owner, target.name)
    : anonymousList(input, target.owner, target.name)
  if (input.includeClosed !== true) {
    const open = await readOpen()
    if (!open.ok) return open
    return {
      ok: true,
      value: { viewer: open.value.viewer, pullRequests: open.value.pullRequests, warnings: open.value.warnings },
    }
  }
  const startMs = historyStartMs(input.fetchedAt, historyWindowDays(input))
  const [open, closed] = await Promise.all([
    readOpen(),
    authenticated
      ? authenticatedClosedList(input, target.owner, target.name)
      : anonymousClosedList(input, target.owner, target.name),
  ])
  if (!open.ok) return open
  const warnings = [...open.value.warnings]
  let history: PullRequest[] = []
  let historyTruncated = false
  if (closed.ok) {
    warnings.push(...closed.value.warnings)
    history = closed.value.pullRequests.filter(pullRequest => withinHistoryWindow(pullRequest, startMs))
    historyTruncated = closed.value.truncated
  } else {
    warnings.push('the recently merged/closed pull requests could not be read')
  }
  const value: GitHubListData = {
    viewer: open.value.viewer,
    pullRequests: withClosedHistory(open.value.pullRequests, history),
    warnings,
    ...(historyTruncated ? { historyTruncated } : {}),
  }
  return { ok: true, value }
}

/** Read the changed-file list of one pull request over REST. */
async function fetchFiles(
  fetchImpl: FetchLike,
  token: string | null,
  owner: string,
  name: string,
  number: number,
): Promise<{ ok: true; files: PullRequestFile[] } | { ok: false; error: ProviderFailure }> {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number}/files?per_page=${MAX_DETAIL_FILES}`
  const headers: Record<string, string> = { ...BASE_HEADERS }
  if (token !== null) headers.authorization = `bearer ${token}`
  const result = await requestJson(fetchImpl, { url, headers })
  if (!result.ok) return result
  if (!Array.isArray(result.value)) {
    return { ok: false, error: { kind: 'invalid-json', message: 'the provider returned an unexpected file list' } }
  }
  return { ok: true, files: mapRestFiles(result.value) }
}

/** Authenticated detail: one GraphQL call plus one REST files call. */
async function authenticatedDetail(input: GitHubDetailInput, owner: string, name: string): Promise<ProviderDetailResult> {
  const [scoped, filesResult] = await Promise.all([
    postGraphQLWithScopeFallback(
      input.fetchImpl,
      input.token,
      GITHUB_DETAIL_QUERY,
      GITHUB_DETAIL_QUERY_REDUCED,
      { owner, name, number: input.number },
    ),
    fetchFiles(input.fetchImpl, input.token, owner, name, input.number),
  ])
  const graphqlResult = scoped.result
  if (!graphqlResult.ok) return graphqlResult
  const failure = graphqlFailure(graphqlResult.value)
  if (failure !== null) return { ok: false, error: failure }
  const data = pickRecord(asRecord(graphqlResult.value), 'data')
  const repository = pickRecord(data, 'repository')
  const node = pickRecord(repository, 'pullRequest')
  if (node === null) {
    return { ok: false, error: { kind: 'not-found', message: 'the provider did not return the pull request' } }
  }
  const viewer = graphqlViewer(graphqlResult.value)
  const context: GitHubMapContext = {
    repositoryId: input.repositoryId,
    fetchedAt: input.fetchedAt,
    authenticated: true,
    viewer,
    includeMergeable: true,
  }
  const pullRequest = mapGraphQLPullRequest(node, context)
  if (pullRequest === null) {
    return { ok: false, error: { kind: 'invalid-json', message: 'the provider returned a pull request this plugin could not read' } }
  }
  const warnings: string[] = []
  if (scoped.reduced) warnings.push(REDUCED_SCOPE_WARNING)
  let files: PullRequestFile[] = []
  if (filesResult.ok) files = filesResult.files
  else warnings.push('the changed files of this pull request could not be read')
  const body = pickString(node, 'body')
  const value = {
    pullRequest,
    files,
    ...(body === undefined ? {} : { body }),
    warnings,
  }
  return { ok: true, value }
}

/** Anonymous detail: the public pull-request endpoint plus its files. */
async function anonymousDetail(input: GitHubDetailInput, owner: string, name: string): Promise<ProviderDetailResult> {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${input.number}`
  const [prResult, filesResult] = await Promise.all([
    requestJson(input.fetchImpl, { url, headers: BASE_HEADERS }),
    fetchFiles(input.fetchImpl, null, owner, name, input.number),
  ])
  if (!prResult.ok) return prResult
  const record = asRecord(prResult.value)
  if (record === null) {
    return { ok: false, error: { kind: 'invalid-json', message: 'the provider returned an unexpected pull request' } }
  }
  const context: GitHubMapContext = {
    repositoryId: input.repositoryId,
    fetchedAt: input.fetchedAt,
    authenticated: false,
    viewer: null,
    includeMergeable: true,
  }
  const pullRequest = mapRestPullRequest(record, context)
  if (pullRequest === null) {
    return { ok: false, error: { kind: 'invalid-json', message: 'the provider returned a pull request this plugin could not read' } }
  }
  const warnings: string[] = []
  let files: PullRequestFile[] = []
  if (filesResult.ok) files = filesResult.files
  else warnings.push('the changed files of this pull request could not be read')
  const body = pickString(record, 'body')
  return {
    ok: true,
    value: {
      pullRequest,
      files,
      ...(body === undefined ? {} : { body }),
      warnings,
    },
  }
}

/**
 * Read one GitHub pull request with its changed files and description.
 * @param input - transport seam, parsed remote, token, repository id and number.
 * @returns the normalized detail or a provider failure.
 */
export async function fetchGitHubDetail(input: GitHubDetailInput): Promise<ProviderDetailResult> {
  const target = githubTarget(input.remote)
  if (target === null) {
    return {
      ok: false,
      error: { kind: 'unsupported-remote', message: 'this GitHub remote path is not an owner/repository pair' },
    }
  }
  if (input.token !== null) return authenticatedDetail(input, target.owner, target.name)
  return anonymousDetail(input, target.owner, target.name)
}
