/**
 * dsh-vcs-timeline — origin remote resolution and URL parsing.
 *
 * Reading the origin URL happens *inside* the gated repository root: the
 * managed subprocess service runs `git config --get remote.origin.url` with the
 * canonical root as its working directory, and a plain read of
 * `<root>/.git/config` is the fallback. Parsing is pure and never echoes
 * credentials, so a remote like `https://user:token@host/owner/repo.git`
 * becomes `{ provider, host, remotePath, webBase }` with the userinfo gone.
 * @module dsh-vcs-timeline/host/pr/remote
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ApiError, PullRequestProvider } from '../../shared/contracts.ts'
import type { Runner } from '../adapters/types.ts'

/** One parsed origin remote. */
export interface RemoteInfo {
  provider: PullRequestProvider
  /** Lower-case host, including a non-default port when the URL had one. */
  host: string
  /** Host-side repository path (`owner/repo`, or `group/sub/repo`). */
  remotePath: string
  /** Base for provider web pages; always an `https://` URL. */
  webBase: string
}

/** Result of reading the origin remote. */
export type RemoteLookup =
  | { ok: true; value: RemoteInfo }
  | { ok: false; error: ApiError }

/** Wall-clock deadline for the origin read. */
const REMOTE_READ_TIMEOUT_MS = 10_000

/** Collected-output cap for the origin read. */
const REMOTE_READ_OUTPUT_CAP = 64 * 1024

/** Largest `.git/config` this module reads as a fallback. */
const MAX_CONFIG_BYTES = 256 * 1024

/**
 * Classify a host as a known provider.
 * @param host - host name, with or without port.
 * @returns the provider, or `unknown` when neither GitHub nor GitLab.
 */
export function providerForHost(host: string): PullRequestProvider {
  const lower = host.toLowerCase()
  if (lower.includes('github')) return 'github'
  if (lower.includes('gitlab')) return 'gitlab'
  return 'unknown'
}

/** Strip any `user[:password]@` prefix from an authority. */
function stripUserinfo(authority: string): string {
  const at = authority.lastIndexOf('@')
  return (at === -1 ? authority : authority.slice(at + 1)).trim()
}

/** Normalize a host (no credentials, no trailing slash) to lower case. */
function cleanHost(raw: string): string | null {
  const bare = stripUserinfo(raw).replace(/\/+$/, '')
  if (bare === '') return null
  if (!/^[A-Za-z0-9.-]+(?::\d+)?$/.test(bare)) return null
  return bare.toLowerCase()
}

/** Normalize a host-side repository path: no query, no `.git`, no escapes. */
function cleanPath(raw: string): string | null {
  let value = raw.replace(/\\/g, '/').trim()
  const cut = value.search(/[?#]/)
  if (cut >= 0) value = value.slice(0, cut)
  value = value.replace(/^\/+/, '').replace(/\/+$/, '')
  if (value.toLowerCase().endsWith('.git')) value = value.slice(0, -4)
  value = value.replace(/\/+$/, '')
  if (value === '') return null
  const segments = value.split('/')
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') return null
  }
  return segments.join('/')
}

/** Assemble a {@link RemoteInfo} from a normalized host and path. */
function buildRemote(host: string | null, remotePath: string | null): RemoteInfo | null {
  if (host === null || remotePath === null) return null
  if (remotePath.split('/').length < 2) return null
  return {
    provider: providerForHost(host),
    host,
    remotePath,
    webBase: `https://${host}`,
  }
}

/**
 * Parse one remote URL into provider facts.
 *
 * Accepts `https://host/owner/repo(.git)`, `git@host:owner/repo.git` (SCP
 * form), and `ssh://git@host/owner/repo.git` (also `git://` and `http://`).
 * Local paths, `file://` URLs, single-segment paths and credential-only URLs
 * return null. Embedded credentials are dropped with the rest of the
 * authority's userinfo and are never part of the result.
 * @param raw - the configured remote URL.
 * @returns the parsed remote, or null when it is not usable.
 */
export function parseRemoteUrl(raw: string): RemoteInfo | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null

  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.*)$/.exec(trimmed)
  if (scheme !== null) {
    const protocol = (scheme[1] ?? '').toLowerCase()
    if (protocol !== 'http' && protocol !== 'https' && protocol !== 'ssh' && protocol !== 'git') return null
    const rest = scheme[2] ?? ''
    const slash = rest.indexOf('/')
    const authority = slash === -1 ? rest : rest.slice(0, slash)
    const rawPath = slash === -1 ? '' : rest.slice(slash + 1)
    return buildRemote(cleanHost(authority), cleanPath(rawPath))
  }

  // SCP-style `[user@]host:path`. Requiring a dot in the host keeps a Windows
  // path such as `C:\repo` from being mistaken for a remote.
  const scp = /^(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9._-]+\.[A-Za-z0-9._-]+):(.+)$/.exec(trimmed)
  if (scp !== null) {
    return buildRemote(cleanHost(scp[1] ?? ''), cleanPath(scp[2] ?? ''))
  }
  return null
}

/**
 * Read `<remote "origin"> url` out of a `.git/config` text.
 * @param text - the config file content.
 * @param remoteName - section to read (default `origin`).
 * @returns the configured URL, or null.
 */
export function parseGitConfigOriginUrl(text: string, remoteName = 'origin'): string | null {
  let inSection = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      const section = /^\[remote\s+"([^"]+)"\]$/i.exec(line)
      inSection = section !== null && section[1] === remoteName
      continue
    }
    if (!inSection) continue
    const url = /^url\s*=\s*(.+)$/i.exec(line)
    if (url !== null) {
      const value = (url[1] ?? '').trim()
      return value === '' ? null : value
    }
  }
  return null
}

/**
 * Fallback origin read straight out of `<root>/.git/config`.
 * @param root - canonical repository root.
 * @returns the configured origin URL, or null.
 */
export async function readOriginFromConfigFile(root: string): Promise<string | null> {
  let text: string
  try {
    text = await readFile(join(root, '.git', 'config'), 'utf8')
  } catch {
    return null
  }
  if (text.length > MAX_CONFIG_BYTES) text = text.slice(0, MAX_CONFIG_BYTES)
  return parseGitConfigOriginUrl(text)
}

/** Dependencies of {@link readOriginRemote}. */
export interface OriginRemoteDeps {
  runner: Runner
  /** Canonical repository root, inside the trust gate. */
  root: string
  signal?: AbortSignal
}

/** Run `git config --get remote.origin.url` inside the gated root. */
async function readConfiguredOrigin(deps: OriginRemoteDeps): Promise<string | null> {
  try {
    const result = await deps.runner.run(
      ['git', 'config', '--get', 'remote.origin.url'],
      deps.root,
      {
        timeoutMs: REMOTE_READ_TIMEOUT_MS,
        maxBytes: REMOTE_READ_OUTPUT_CAP,
        ...(deps.signal === undefined ? {} : { signal: deps.signal }),
      },
    )
    if (result.spawnFailed === true || result.exitCode !== 0) return null
    const first = (result.stdout.split(/\r?\n/)[0] ?? '').trim()
    return first === '' ? null : first
  } catch {
    return null
  }
}

/**
 * Read and parse the repository's origin remote.
 *
 * The command runs first; the config-file read is the fallback for machines
 * where the subprocess is unavailable. Neither path echoes the raw URL on
 * failure, so a credential-bearing remote stays private.
 * @param deps - runner, canonical root, optional signal.
 * @returns the parsed remote, or an `unsupported-remote` error.
 */
export async function readOriginRemote(deps: OriginRemoteDeps): Promise<RemoteLookup> {
  const candidates: string[] = []
  const configured = await readConfiguredOrigin(deps)
  if (configured !== null) candidates.push(configured)
  const fromFile = await readOriginFromConfigFile(deps.root)
  if (fromFile !== null && !candidates.includes(fromFile)) candidates.push(fromFile)
  for (const candidate of candidates) {
    const parsed = parseRemoteUrl(candidate)
    if (parsed !== null) return { ok: true, value: parsed }
  }
  return {
    ok: false,
    error: {
      code: 'unsupported-remote',
      message: 'this repository has no supported GitHub or GitLab origin remote',
    },
  }
}
