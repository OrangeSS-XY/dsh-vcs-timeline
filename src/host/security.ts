/**
 * Security primitives shared by the Host services and both adapters:
 * credential redaction, repository-relative path validation, cursor codec,
 * bounded numbers, and safe error text.
 *
 * The rules encoded here are the plugin's threat model in code: no shell
 * strings, no path escapes, no credentials in anything persisted or shown.
 * @module dsh-vcs-timeline/host/security
 */

import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Credential-bearing query parameters masked in URLs and free text. */
const SECRET_QUERY_KEYS = [
  'access_token', 'auth', 'key', 'password', 'passwd', 'pwd', 'secret',
  'sig', 'signature', 'token', 'apikey', 'api_key', 'private_token',
  'client_secret', 'session', 'credential',
]

/** Redact userinfo and token-like query values from one URL. */
export function redactUrl(raw: string): string {
  let value = raw.trim()
  // userinfo: scheme://user[:password]@host
  value = value.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]+@/, '$1')
  // token-like query parameters: ?token=...&password=...
  value = value.replace(/([?&])([A-Za-z0-9_.-]+)=([^&#\s]*)/g, (match, prefix: string, key: string, rawValue: string) => {
    return SECRET_QUERY_KEYS.includes(key.toLowerCase()) ? `${prefix}${key}=***` : match
  })
  return value
}

/** Redact credentials from free text (error messages, command output summaries). */
export function redactText(raw: string): string {
  let value = raw
  // scheme://user:pass@host
  value = value.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]+@/g, '$1***@')
  // key=value / key: value for known secret keys
  for (const key of SECRET_QUERY_KEYS) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    value = value.replace(new RegExp(`(${escaped}\\s*[=:]\\s*)([^\\s&,'"]+)`, 'gi'), '$1***')
  }
  // Bearer / Basic authorization headers
  value = value.replace(/(authorization\s*:\s*)(bearer|basic|token)\s+[^\s]+/gi, '$1$2 ***')
  // PEM private key blocks
  value = value.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '***private key redacted***')
  return value
}

/** One-line, bounded, credential-free error text. */
export function safeErrorMessage(error: unknown, maxLength = 500): string {
  const raw = error instanceof Error ? error.message : String(error)
  const redacted = redactText(raw).replace(/\s+/g, ' ').trim()
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted
}

/** The plugin data directory under the DSH home. */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const raw = env.DSH_HOME
  if (raw !== undefined && raw.trim() !== '') {
    const expanded = raw.trim()
    if (expanded === '~') return home
    if (expanded.startsWith('~/') || expanded.startsWith('~\\')) return join(home, expanded.slice(2))
    return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded)
  }
  return join(home, '.dsh')
}

/** Resolve the plugin's data directory. */
export function resolveDataDir(override?: string): string {
  if (override !== undefined && override.trim() !== '') return resolve(override.trim())
  return join(resolveDshHome(), 'storages', 'dsh-vcs-timeline')
}

/**
 * Normalize a repository-relative path from user input or command output.
 *
 * Returns null for absolute paths, drive letters, `..` escapes, empty paths,
 * and NUL bytes. The result always uses `/` and never starts with `./`.
 */
export function normalizeRepoRelativePath(raw: string): string | null {
  if (typeof raw !== 'string' || raw === '' || raw.includes('\0')) return null
  let value = raw.replace(/\\/g, '/').trim()
  if (value === '') return null
  if (value.startsWith('/')) return null
  if (/^[a-zA-Z]:/.test(value)) return null
  while (value.startsWith('./')) value = value.slice(2)
  const segments = value.split('/')
  if (segments.some(segment => segment === '..')) return null
  const cleaned = segments.filter(segment => segment !== '' && segment !== '.')
  if (cleaned.length === 0) return null
  return cleaned.join('/')
}

/** Whether `candidate` resolves inside `root` (defense in depth for writes). */
export function isInside(root: string, candidate: string): boolean {
  const rootResolved = resolve(root)
  const candidateResolved = resolve(candidate)
  const rel = relative(rootResolved, candidateResolved)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Join a validated repository-relative path onto a canonical root. */
export function joinRepoPath(root: string, relativePath: string): string | null {
  const normalized = normalizeRepoRelativePath(relativePath)
  if (normalized === null) return null
  const joined = resolve(root, ...normalized.split('/'))
  if (!isInside(root, joined)) return null
  return joined
}

/** Clamp an integer into [min, max], falling back to `fallback` when absent. */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** Parse an ISO 8601 timestamp; returns null when invalid. */
export function parseIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

/** Encode an opaque pagination cursor. */
export function encodeCursor(payload: Record<string, string | number | null>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

/** Decode a pagination cursor; null when malformed. */
export function decodeCursor(value: unknown): Record<string, string | number | null> | null {
  if (typeof value !== 'string' || value === '') return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const record: Record<string, string | number | null> = {}
    for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof entry === 'string' || typeof entry === 'number' || entry === null) record[key] = entry
    }
    return record
  } catch {
    return null
  }
}

/** Quote one argv element for a read-only display string (never executed). */
export function displayArgv(argv: readonly string[]): string[] {
  return argv.map(arg => (/\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg))
}

/** Stable id for a repository from its canonical path and VCS type. */
export function repositoryId(vcsType: 'git' | 'svn', canonicalRoot: string): string {
  const normalized = canonicalRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const lower = process.platform === 'win32' ? normalized.toLowerCase() : normalized
  return `${vcsType}:${lower}`
}

/** Split a unified diff into lines without normalizing content. */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/)
}

/** Keep the leading `max` UTF-8 bytes of `text` on a code-point boundary. */
export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= maxBytes) return { text, truncated: false }
  const buffer = Buffer.from(text, 'utf8')
  let end = Math.max(0, maxBytes)
  // Do not split a multi-byte sequence: back off continuation bytes.
  while (end > 0 && (buffer[end]! & 0xc0) === 0x80) end -= 1
  return { text: buffer.subarray(0, end).toString('utf8'), truncated: true }
}

/** Platform separator used for path display. */
export const PATH_SEPARATOR = sep
