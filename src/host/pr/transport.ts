/**
 * dsh-vcs-timeline — bounded HTTP transport shared by the pull-request
 * providers.
 *
 * One request is a plain `fetch` (no shell, no SDK) with a wall-clock deadline,
 * a hard byte cap on the response body, and a provider failure mapped to a
 * stable discriminator. Provider text never reaches the Client: this module
 * only ever produces its own short messages, so an HTML error page or a
 * credential echo in a provider body can never leak through.
 * @module dsh-vcs-timeline/host/pr/transport
 */

import type { PullRequest, PullRequestFile } from '../../shared/contracts.ts'
import { redactText } from '../security.ts'

/** Structural response face this module needs from `fetch`. */
export interface FetchResponseLike {
  readonly ok: boolean
  readonly status: number
  readonly headers: { get(name: string): string | null }
  text(): Promise<string>
}

/** Structural request init passed to {@link FetchLike}. */
export interface FetchInitLike {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

/** Minimal fetch seam: production passes the global `fetch`, tests a fake. */
export type FetchLike = (url: string, init?: FetchInitLike) => Promise<FetchResponseLike>

/** Wall-clock deadline for one provider request. */
export const PROVIDER_TIMEOUT_MS = 10_000

/** Largest provider response body this plugin reads, in bytes. */
export const PROVIDER_MAX_BYTES = 1024 * 1024

/** Most provider requests in flight at once. */
export const MAX_CONCURRENT_REQUESTS = 2

/** User agent every provider request carries. */
export const USER_AGENT = 'dsh-vcs-timeline'

/** Production fetch: the runtime's global implementation. */
export const defaultFetch: FetchLike = (url, init) => fetch(url, init)

/** Why one provider call failed, as the service maps it to an API error. */
export type ProviderFailure =
  | { kind: 'rate-limited'; message: string; resetAt?: string }
  | { kind: 'unauthorized'; status: number; message: string }
  | { kind: 'not-found'; message: string }
  | { kind: 'unsupported-remote'; message: string }
  | { kind: 'http'; status: number; message: string }
  | { kind: 'network'; message: string; timedOut: boolean }
  | { kind: 'invalid-json'; message: string }
  | { kind: 'too-large'; message: string }

/** Normalized list payload every provider returns. */
export interface ProviderListData {
  viewer: string | null
  pullRequests: PullRequest[]
  warnings: string[]
}

/** Normalized detail payload every provider returns. */
export interface ProviderDetailData {
  pullRequest: PullRequest
  files: PullRequestFile[]
  body?: string
  warnings: string[]
}

/** Result of one provider list call. */
export type ProviderListResult = { ok: true; value: ProviderListData } | { ok: false; error: ProviderFailure }

/** Result of one provider detail call. */
export type ProviderDetailResult = { ok: true; value: ProviderDetailData } | { ok: false; error: ProviderFailure }

/** Result of one transport call. */
type TransportResult = { ok: true; value: unknown } | { ok: false; error: ProviderFailure }

/** One request the transport performs. */
export interface ProviderRequest {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
}

/** One-line, bounded, secret-free provider failure text. */
function failureText(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const redacted = redactText(raw).replace(/\s+/g, ' ').trim()
  return redacted.length > 200 ? `${redacted.slice(0, 200)}…` : redacted
}

/** Whether a thrown fetch error is this request's own deadline. */
function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.name === 'TimeoutError' || error.name === 'AbortError'
}

/** Map a thrown fetch error to a network failure. */
function networkFailure(error: unknown): ProviderFailure {
  return {
    kind: 'network',
    message: failureText(error),
    timedOut: isTimeout(error),
  }
}

/** Parse a rate-limit reset hint (epoch seconds, seconds from now, or HTTP date). */
function rateLimitResetAt(response: FetchResponseLike): string | undefined {
  const epoch = response.headers.get('x-ratelimit-reset') ?? response.headers.get('ratelimit-reset')
  if (epoch !== null) {
    const seconds = Number(epoch)
    if (Number.isFinite(seconds) && seconds > 0) {
      const date = new Date(seconds * 1000)
      if (!Number.isNaN(date.getTime())) return date.toISOString()
    }
  }
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter !== null) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return new Date(Date.now() + seconds * 1000).toISOString()
    const date = new Date(retryAfter)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return undefined
}

/** Map a non-2xx response to a provider failure, without reading its body. */
function httpFailure(response: FetchResponseLike): ProviderFailure {
  const status = response.status
  const remaining = response.headers.get('x-ratelimit-remaining') ?? response.headers.get('ratelimit-remaining')
  const retryAfter = response.headers.get('retry-after')
  // GitHub sends `x-ratelimit-reset` on every response, so a 403 is only a
  // rate limit when the quota is actually exhausted or the provider asks us to
  // retry later. Any other 403 is an authorization failure.
  const rateLimited = status === 429 || remaining === '0' || (status === 403 && retryAfter !== null)
  if (rateLimited) {
    const resetAt = rateLimitResetAt(response)
    return {
      kind: 'rate-limited',
      message: 'the provider rate limit was reached',
      ...(resetAt === undefined ? {} : { resetAt }),
    }
  }
  if (status === 401 || status === 403) {
    return { kind: 'unauthorized', status, message: 'the provider rejected the request credentials' }
  }
  if (status === 404) {
    return { kind: 'not-found', message: 'the provider reported that the resource does not exist' }
  }
  return { kind: 'http', status, message: `the provider answered HTTP ${status}` }
}

/**
 * Perform one JSON request under the transport limits.
 *
 * The response body is read once, capped at {@link PROVIDER_MAX_BYTES}, and
 * parsed; an error status is mapped without reading provider text, so no
 * provider body or header can be echoed onward.
 * @param fetchImpl - structural fetch seam.
 * @param request - URL, method, headers and body.
 * @returns the parsed JSON or a stable provider failure.
 */
export async function requestJson(fetchImpl: FetchLike, request: ProviderRequest): Promise<TransportResult> {
  const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  let response: FetchResponseLike
  try {
    response = await fetchImpl(request.url, {
      method: request.method ?? 'GET',
      ...(request.headers === undefined ? {} : { headers: request.headers }),
      ...(request.body === undefined ? {} : { body: request.body }),
      signal,
    })
  } catch (error: unknown) {
    return { ok: false, error: networkFailure(error) }
  }
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > PROVIDER_MAX_BYTES) {
    return { ok: false, error: { kind: 'too-large', message: 'the provider response exceeded the size limit' } }
  }
  let text: string
  try {
    text = await response.text()
  } catch (error: unknown) {
    return { ok: false, error: networkFailure(error) }
  }
  if (Buffer.byteLength(text, 'utf8') > PROVIDER_MAX_BYTES) {
    return { ok: false, error: { kind: 'too-large', message: 'the provider response exceeded the size limit' } }
  }
  if (!response.ok) return { ok: false, error: httpFailure(response) }
  if (text.trim() === '') {
    return { ok: false, error: { kind: 'invalid-json', message: 'the provider returned an empty response' } }
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, error: { kind: 'invalid-json', message: 'the provider returned a malformed JSON response' } }
  }
}

/** A function that runs a task inside a bounded-concurrency window. */
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>

/**
 * Bound how many tasks run at once.
 *
 * A released slot is handed directly to the oldest waiter and stays counted,
 * so a caller arriving between the hand-off and the waiter resuming cannot
 * push the active count above `max`.
 * @param max - largest number of concurrent tasks.
 * @returns the limiter.
 */
export function createLimiter(max: number = MAX_CONCURRENT_REQUESTS): Limiter {
  const limit = Math.max(1, Math.trunc(max))
  let active = 0
  const waiters: Array<() => void> = []
  const acquire = async (): Promise<void> => {
    if (active < limit) {
      active += 1
      return
    }
    await new Promise<void>(resolve => waiters.push(resolve))
  }
  const release = (): void => {
    const next = waiters.shift()
    if (next === undefined) active -= 1
    else next()
  }
  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire()
    try {
      return await task()
    } finally {
      release()
    }
  }
}
