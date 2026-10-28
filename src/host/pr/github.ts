/**
 * dsh-vcs-timeline — GitHub pull-request provider.
 *
 * Two read paths, both bounded by the transport:
 * - authenticated: ONE GraphQL POST for the list (viewer, review decision,
 *   rollup, requested reviewers, counts, labels) and one GraphQL POST plus one
 *   REST files call for the detail;
 * - anonymous: the public REST list and detail endpoints, which carry no
 *   review or CI facts, so those fields stay honestly empty/none and the
 *   actions become `unknown`/`needs-auth`.
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
import { MAX_PULL_REQUESTS } from '../../shared/contracts.ts'
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
const PULL_REQUEST_FIELDS = `
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
    nodes { requestedReviewer { ... on User { login } ... on Team { name } } }
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

/** List query: open pull requests, newest activity first. */
export const GITHUB_LIST_QUERY = `query TimelinePullRequests($owner: String!, $name: String!, $first: Int!) {
  rateLimit { remaining resetAt }
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequests(first: $first, states: [OPEN], orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {${PULL_REQUEST_FIELDS}}
    }
  }
}`

/** Detail query: one pull request with its lifecycle state and description. */
export const GITHUB_DETAIL_QUERY = `query TimelinePullRequestDetail($owner: String!, $name: String!, $number: Int!) {
  rateLimit { remaining resetAt }
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      ${PULL_REQUEST_FIELDS}
      state
      body
    }
  }
}`

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
}

/** One detail read. */
export interface GitHubDetailInput extends GitHubListInput {
  number: number
}

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
function mapGraphQLNodes(nodes: unknown[], context: GitHubMapContext): { pullRequests: PullRequest[]; warnings: string[] } {
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
  return { pullRequests: pullRequests.slice(0, MAX_PULL_REQUESTS), warnings }
}

/** Authenticated list: one GraphQL call. */
async function authenticatedList(input: GitHubListInput, owner: string, name: string): Promise<ProviderListResult> {
  const result = await requestJson(input.fetchImpl, {
    url: GITHUB_GRAPHQL_URL,
    method: 'POST',
    headers: {
      ...BASE_HEADERS,
      'content-type': 'application/json',
      authorization: `bearer ${input.token ?? ''}`,
    },
    body: JSON.stringify({
      query: GITHUB_LIST_QUERY,
      variables: { owner, name, first: MAX_PULL_REQUESTS },
    }),
  })
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
  const value: ProviderListData = { viewer, pullRequests: mapped.pullRequests, warnings: mapped.warnings }
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

/**
 * Read the open pull requests of one GitHub repository.
 * @param input - transport seam, parsed remote, token and repository id.
 * @returns the normalized list or a provider failure.
 */
export async function fetchGitHubList(input: GitHubListInput): Promise<ProviderListResult> {
  const target = githubTarget(input.remote)
  if (target === null) {
    return {
      ok: false,
      error: { kind: 'unsupported-remote', message: 'this GitHub remote path is not an owner/repository pair' },
    }
  }
  if (input.token !== null) return authenticatedList(input, target.owner, target.name)
  return anonymousList(input, target.owner, target.name)
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
  const token = input.token ?? ''
  const [graphqlResult, filesResult] = await Promise.all([
    requestJson(input.fetchImpl, {
      url: GITHUB_GRAPHQL_URL,
      method: 'POST',
      headers: {
        ...BASE_HEADERS,
        'content-type': 'application/json',
        authorization: `bearer ${token}`,
      },
      body: JSON.stringify({ query: GITHUB_DETAIL_QUERY, variables: { owner, name, number: input.number } }),
    }),
    fetchFiles(input.fetchImpl, input.token, owner, name, input.number),
  ])
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
