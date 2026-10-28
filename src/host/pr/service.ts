/**
 * dsh-vcs-timeline — pull-request read service.
 *
 * The service is the one seam between the `/vcs/pr/*` routes and the provider
 * modules: it resolves and gates the repository, reads the origin remote,
 * resolves a credential, performs the bounded provider read, maps failures to
 * stable API codes, and caches a list per repository for
 * {@link PULL_REQUEST_CACHE_MS}.
 *
 * A token never leaves the request headers: no returned value, warning, error
 * message, or cache entry contains it. Provider bodies are never echoed, only
 * this module's own bounded messages and redacted provider snippets.
 * @module dsh-vcs-timeline/host/pr/service
 */

import type {
  PullRequestDetail,
  PullRequestDetailQuery,
  PullRequestList,
  PullRequestQuery,
} from '../../shared/contracts.ts'
import { PULL_REQUEST_CACHE_MS } from '../../shared/contracts.ts'
import type { Runner } from '../adapters/types.ts'
import { truncateUtf8 } from '../security.ts'
import { ServiceError, type RepositoryResolver } from '../services/timeline-service.ts'
import { redact, resolveAuthToken } from './auth.ts'
import { fetchGitHubDetail, fetchGitHubList } from './github.ts'
import { fetchGitLabDetail, fetchGitLabList } from './gitlab.ts'
import { readOriginRemote, type RemoteInfo } from './remote.ts'
import {
  createLimiter,
  defaultFetch,
  MAX_CONCURRENT_REQUESTS,
  type FetchLike,
  type ProviderDetailResult,
  type ProviderFailure,
  type ProviderListResult,
} from './transport.ts'

/** Largest description/body the Host keeps from a detail read. */
export const MAX_BODY_BYTES = 8 * 1024

/** Dependencies of the pull-request service. */
export interface PullRequestServiceDeps {
  resolver: RepositoryResolver
  runner: Runner
  /** Plugin data directory (holds `pr-auth.json`). */
  dataDir: string
  fetchImpl?: FetchLike
  env?: NodeJS.ProcessEnv
  homeDir?: string
  now?: () => Date
  maxConcurrent?: number
}

/** Read surface used by the `/vcs/pr/*` routes. */
export interface PullRequestService {
  list(query: PullRequestQuery): Promise<PullRequestList>
  detail(query: PullRequestDetailQuery): Promise<PullRequestDetail>
}

/** One cached list plus the instant it stops being fresh. */
interface CacheEntry {
  value: PullRequestList
  expiresAt: number
}

/** Validate a pull-request number: a positive integer. */
function positiveNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (!Number.isInteger(value) || value <= 0 || value > 1_000_000_000) return null
  return value
}

/** Map a provider failure to a stable, secret-free service error. */
function providerFailure(failure: ProviderFailure, authenticated: boolean): ServiceError {
  switch (failure.kind) {
    case 'rate-limited': {
      const hint = failure.resetAt === undefined ? '' : `; the limit resets at ${failure.resetAt}`
      return new ServiceError({
        code: 'rate-limited',
        message: 'the provider rate limit was reached',
        detail: `${redact(failure.message)}${hint}`,
        retryable: true,
      })
    }
    case 'unauthorized':
      return new ServiceError({
        code: 'auth-required',
        message: 'the provider rejected the request credentials',
        detail: authenticated
          ? 'the configured token is invalid, expired, or lacks access to this repository'
          : 'no token is configured; set GITHUB_TOKEN, GH_TOKEN, GITLAB_TOKEN, GL_TOKEN, ~/.git-credentials, or <dataDir>/pr-auth.json',
      })
    case 'not-found':
      return authenticated
        ? new ServiceError({
          code: 'operation-failed',
          message: 'the provider did not find the repository or pull request',
          detail: 'check that the origin remote points at a repository the token can read',
        })
        : new ServiceError({
          code: 'auth-required',
          message: 'the repository is not readable anonymously; it may be private',
          detail: 'configure a token to read private repositories',
        })
    case 'unsupported-remote':
      return new ServiceError({ code: 'unsupported-remote', message: 'this repository has no supported origin remote' })
    case 'network':
      return new ServiceError({
        code: 'network-unknown',
        message: failure.timedOut
          ? 'the provider did not answer before the deadline'
          : 'the provider could not be reached',
        detail: redact(failure.message),
        retryable: true,
      })
    case 'http':
      return new ServiceError({
        code: 'operation-failed',
        message: failure.message,
        retryable: failure.status >= 500,
      })
    case 'invalid-json':
      return new ServiceError({ code: 'internal', message: failure.message })
    case 'too-large':
      return new ServiceError({
        code: 'output-too-large',
        message: failure.message,
        detail: 'configure a token so the compact GraphQL read is used instead of the verbose anonymous REST payload',
      })
  }
}

/** Narrow dependencies needed to resolve one repository and its remote. */
interface ResolveDeps {
  resolver: RepositoryResolver
  runner: Runner
}

/** Resolve and gate the repository, without reading its remote yet. */
async function resolveRepository(
  deps: ResolveDeps,
  repositoryId: unknown,
): Promise<{ repositoryId: string; root: string }> {
  const resolved = await deps.resolver.resolve(typeof repositoryId === 'string' ? repositoryId : '')
  if (!resolved.ok) throw new ServiceError(resolved.error)
  const { repository, root } = resolved.value
  if (repository.vcsType !== 'git') {
    throw new ServiceError({ code: 'unsupported-remote', message: 'pull requests are only supported for Git repositories' })
  }
  return { repositoryId: repository.id, root }
}

/** Read and classify the repository's origin remote. */
async function readProviderRemote(deps: ResolveDeps, root: string): Promise<RemoteInfo> {
  const remote = await readOriginRemote({ runner: deps.runner, root })
  if (!remote.ok) throw new ServiceError(remote.error)
  if (remote.value.provider === 'unknown') {
    throw new ServiceError({
      code: 'unsupported-remote',
      message: 'the origin remote host is not GitHub or GitLab',
      detail: `host: ${remote.value.host}`,
    })
  }
  return remote.value
}

/**
 * Create the pull-request read service.
 * @param deps - resolver, runner, data directory and test seams.
 * @returns the service.
 */
export function createPullRequestService(deps: PullRequestServiceDeps): PullRequestService {
  const now = deps.now ?? (() => new Date())
  const baseFetch = deps.fetchImpl ?? defaultFetch
  const limit = createLimiter(deps.maxConcurrent ?? MAX_CONCURRENT_REQUESTS)
  const fetchImpl: FetchLike = (url, init) => limit(() => baseFetch(url, init))
  const cache = new Map<string, CacheEntry>()
  const resolveDeps: ResolveDeps = { resolver: deps.resolver, runner: deps.runner }

  const resolveToken = async (remote: RemoteInfo): Promise<string | null> => {
    if (remote.provider !== 'github' && remote.provider !== 'gitlab') return null
    const auth = await resolveAuthToken({
      dataDir: deps.dataDir,
      provider: remote.provider,
      host: remote.host,
      ...(deps.env === undefined ? {} : { env: deps.env }),
      ...(deps.homeDir === undefined ? {} : { homeDir: deps.homeDir }),
    })
    return auth.token
  }

  const readList = async (
    remote: RemoteInfo,
    repositoryId: string,
    token: string | null,
    fetchedAt: string,
  ): Promise<ProviderListResult> => {
    const input = {
      fetchImpl,
      remote,
      token,
      repositoryId,
      fetchedAt,
    }
    return remote.provider === 'github' ? fetchGitHubList(input) : fetchGitLabList(input)
  }

  const readDetail = async (
    remote: RemoteInfo,
    repositoryId: string,
    token: string | null,
    fetchedAt: string,
    number: number,
  ): Promise<ProviderDetailResult> => {
    const input = {
      fetchImpl,
      remote,
      token,
      repositoryId,
      fetchedAt,
      number,
    }
    return remote.provider === 'github' ? fetchGitHubDetail(input) : fetchGitLabDetail(input)
  }

  return {
    async list(query) {
      if (typeof query !== 'object' || query === null) {
        throw new ServiceError({ code: 'invalid-request', message: 'query is required' })
      }
      const resolved = await resolveRepository(resolveDeps, query.repositoryId)
      const currentMs = now().getTime()
      const cached = cache.get(resolved.repositoryId)
      if (query.refresh !== true && cached !== undefined && currentMs < cached.expiresAt) return cached.value

      const remote = await readProviderRemote(resolveDeps, resolved.root)
      const token = await resolveToken(remote)
      const fetchedAt = now().toISOString()
      const result = await readList(remote, resolved.repositoryId, token, fetchedAt)
      if (!result.ok) throw providerFailure(result.error, token !== null)
      const value: PullRequestList = {
        repositoryId: resolved.repositoryId,
        provider: remote.provider,
        host: remote.host,
        remotePath: remote.remotePath,
        viewer: result.value.viewer,
        authenticated: token !== null,
        pullRequests: result.value.pullRequests,
        ...(result.value.warnings.length === 0
          ? {}
          : { warnings: result.value.warnings, partial: true }),
        fetchedAt,
      }
      cache.set(resolved.repositoryId, { value, expiresAt: currentMs + PULL_REQUEST_CACHE_MS })
      return value
    },

    async detail(query) {
      if (typeof query !== 'object' || query === null) {
        throw new ServiceError({ code: 'invalid-request', message: 'query is required' })
      }
      const number = positiveNumber(query.number)
      if (number === null) {
        throw new ServiceError({ code: 'invalid-request', message: 'number must be a positive integer' })
      }
      const resolved = await resolveRepository(resolveDeps, query.repositoryId)
      const remote = await readProviderRemote(resolveDeps, resolved.root)
      const token = await resolveToken(remote)
      const fetchedAt = now().toISOString()
      const result = await readDetail(remote, resolved.repositoryId, token, fetchedAt, number)
      if (!result.ok) throw providerFailure(result.error, token !== null)
      const warnings = [...result.value.warnings]
      let body: string | undefined
      let truncated = false
      if (result.value.body !== undefined) {
        const limited = truncateUtf8(result.value.body, MAX_BODY_BYTES)
        body = limited.text
        truncated = limited.truncated
        if (truncated) warnings.push('the pull-request description was truncated')
      }
      return {
        pullRequest: result.value.pullRequest,
        files: result.value.files,
        ...(body === undefined ? {} : { body }),
        ...(truncated ? { truncated } : {}),
        ...(warnings.length === 0 ? {} : { warnings }),
      }
    },
  }
}
