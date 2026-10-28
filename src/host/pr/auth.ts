/**
 * dsh-vcs-timeline — pull-request credential resolution.
 *
 * The Host never prompts and never uses `git credential fill`: the managed
 * subprocess service only supports `stdio.stdin: 'ignore'`, so a helper that
 * expects input on stdin can never run. The chain therefore reads, in order,
 * provider environment variables, then `~/.git-credentials`, then the
 * plugin-owned `<dataDir>/pr-auth.json`.
 *
 * A token is a bearer secret: it is handed straight to the provider request,
 * never logged, never put in an error message, and never part of a returned
 * object. Everything in this module that formats text goes through
 * {@link redact}.
 * @module dsh-vcs-timeline/host/pr/auth
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PullRequestProvider } from '../../shared/contracts.ts'
import { redactText } from '../security.ts'

/** Where a resolved token came from. */
export type AuthSource = 'env' | 'git-credentials' | 'auth-file' | 'none'

/** One resolved credential. `token` is null when the Host runs anonymously. */
export interface AuthToken {
  token: string | null
  source: AuthSource
}

/** Dependencies of {@link resolveAuthToken}. */
export interface AuthDeps {
  /** Plugin data directory (holds `pr-auth.json`). */
  dataDir: string
  /** Provider the token is for; a token is never reused across providers. */
  provider: PullRequestProvider
  /** Remote host the token will be sent to. */
  host: string
  /** Environment to read; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Home directory to read; defaults to `os.homedir()`. */
  homeDir?: string
}

/** Plugin-owned credential file name inside the data directory. */
export const AUTH_FILE_NAME = 'pr-auth.json'

/** Environment variables checked per provider, most specific first. */
const ENV_KEYS: Record<'github' | 'gitlab', readonly string[]> = {
  github: ['GITHUB_TOKEN', 'GH_TOKEN'],
  gitlab: ['GITLAB_TOKEN', 'GL_TOKEN'],
}

/** Largest credential file this module reads. */
const MAX_CREDENTIAL_FILE_BYTES = 64 * 1024

/**
 * One-line, bounded, credential-free provider text.
 *
 * Safe to put in an `ApiError.detail` or a warning: URLs lose their userinfo,
 * `token=…`-style pairs are masked, and private-key blocks are replaced.
 * @param raw - provider text (an error snippet, never a body).
 * @param maxLength - maximum characters kept.
 * @returns the redacted single line.
 */
export function redact(raw: string, maxLength = 300): string {
  const single = redactText(raw).replace(/\s+/g, ' ').trim()
  return single.length > maxLength ? `${single.slice(0, maxLength)}…` : single
}

/** Decode a URL-encoded credential fragment, leaving it alone when malformed. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Compare two hosts, ignoring a port on either side. */
export function sameHost(left: string, right: string): boolean {
  const strip = (host: string): string => host.toLowerCase().replace(/:\d+$/, '')
  return left.toLowerCase() === right.toLowerCase() || strip(left) === strip(right)
}

/**
 * Pick the password/token for one host out of `~/.git-credentials` text.
 *
 * Lines are `https://user:token@host[/path]`; the first line whose host
 * matches wins. A line without a password, a non-https line, or a host
 * mismatch is skipped.
 * @param text - the credentials file content.
 * @param host - remote host to match.
 * @returns the decoded token, or null.
 */
export function parseGitCredentials(text: string, host: string): string | null {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/.exec(line)
    if (scheme === null) continue
    if ((scheme[1] ?? '').toLowerCase() !== 'https') continue
    const authorityAndPath = scheme[2] ?? ''
    const at = authorityAndPath.lastIndexOf('@')
    if (at <= 0) continue
    const userinfo = authorityAndPath.slice(0, at)
    const hostAndPath = authorityAndPath.slice(at + 1)
    const slash = hostAndPath.indexOf('/')
    const entryHost = slash === -1 ? hostAndPath : hostAndPath.slice(0, slash)
    if (!sameHost(entryHost, host)) continue
    const colon = userinfo.indexOf(':')
    if (colon === -1) continue
    const token = safeDecode(userinfo.slice(colon + 1)).trim()
    if (token !== '') return token
  }
  return null
}

/** Read and parse the plugin-owned credential file. */
async function tokenFromAuthFile(path: string, provider: 'github' | 'gitlab'): Promise<string | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return null
  }
  if (text.length > MAX_CREDENTIAL_FILE_BYTES) text = text.slice(0, MAX_CREDENTIAL_FILE_BYTES)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const value = (parsed as Record<string, unknown>)[provider]
  if (typeof value !== 'string') return null
  const token = value.trim()
  return token === '' ? null : token
}

/** Read `~/.git-credentials` and pick a token for the host. */
async function tokenFromGitCredentials(path: string, host: string): Promise<string | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return null
  }
  if (text.length > MAX_CREDENTIAL_FILE_BYTES) text = text.slice(0, MAX_CREDENTIAL_FILE_BYTES)
  return parseGitCredentials(text, host)
}

/**
 * Resolve one provider token through the documented chain.
 *
 * Environment variables are provider-scoped: a GitHub token is never sent to a
 * GitLab host (and vice versa), because that would hand one provider's secret
 * to another. A missing or unreadable source is skipped silently; the result
 * is always `{ token: null, source: 'none' }` for anonymous access.
 * @param deps - data directory, provider, host and environment.
 * @returns the token and where it came from.
 */
export async function resolveAuthToken(deps: AuthDeps): Promise<AuthToken> {
  if (deps.provider !== 'github' && deps.provider !== 'gitlab') return { token: null, source: 'none' }
  const env = deps.env ?? process.env
  for (const key of ENV_KEYS[deps.provider]) {
    const value = env[key]
    if (typeof value === 'string' && value.trim() !== '') return { token: value.trim(), source: 'env' }
  }
  const credentialsToken = await tokenFromGitCredentials(
    join(deps.homeDir ?? homedir(), '.git-credentials'),
    deps.host,
  )
  if (credentialsToken !== null) return { token: credentialsToken, source: 'git-credentials' }
  const fileToken = await tokenFromAuthFile(join(deps.dataDir, AUTH_FILE_NAME), deps.provider)
  if (fileToken !== null) return { token: fileToken, source: 'auth-file' }
  return { token: null, source: 'none' }
}
