/**
 * Pure SVN command builders and output parsers.
 *
 * Everything in this module is free of I/O so the whole SVN surface that can
 * be tested without a Subversion client lives here: argv construction (always
 * arrays, never shell strings), revision validation that rejects option
 * injection, and parsers for `svn --xml`, `svn diff --summarize` and
 * `svn diff` text. The adapter in `adapter.ts` only adds process execution,
 * filesystem facts and error mapping.
 * @module dsh-vcs-timeline/host/adapters/svn/commands
 */

import { normalizeRepoRelativePath } from '../../security.ts'
import {
  attributeText,
  childElements,
  childText,
  firstChild,
  parseXml,
  rootElement,
  XmlParseError,
} from './xml.ts'
import type { XmlNode } from './xml.ts'

/** Largest revision number accepted (12 digits). */
export const MAX_SVN_REVISION_DIGITS = 12

/** Largest commit message length accepted. */
export const MAX_COMMIT_MESSAGE_LENGTH = 4000

/** Hard cap on the file list of one changeset. */
export const MAX_CHANGESET_FILES = 2000

/** Default page size for history when the caller passes none. */
export const DEFAULT_HISTORY_LIMIT = 30

/** Largest page size the adapter will request. */
export const MAX_HISTORY_LIMIT = 100

/** The `--non-interactive` flag every command carries. */
const NON_INTERACTIVE = '--non-interactive'

// ---------------------------------------------------------------------------
// Revision and date validation
// ---------------------------------------------------------------------------

/**
 * Validate and canonicalize one SVN revision string.
 *
 * SVN revisions are decimal integers. Anything containing `-`, `:`, `^`,
 * whitespace or another character is rejected so a revision can never become
 * an option or a range the caller did not build.
 * @param value - candidate revision.
 * @returns the canonical decimal string (`"007"` becomes `"7"`), or null.
 */
export function parseRevision(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // Reject control characters (newline, tab, NUL, ...): only plain digits with
  // optional surrounding spaces form a revision, and trimming must never turn
  // a multi-line injection attempt into a bare number.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  const trimmed = value.trim()
  if (!new RegExp(`^[0-9]{1,${MAX_SVN_REVISION_DIGITS}}$`).test(trimmed)) return null
  const number = Number(trimmed)
  if (!Number.isSafeInteger(number) || number < 0) return null
  return String(number)
}

/** Whether `value` is a safe revision string. */
export function isValidRevision(value: unknown): boolean {
  return parseRevision(value) !== null
}

/**
 * Validate a revision as a non-negative safe integer for range building.
 * @param value - candidate revision number.
 * @returns the number, or null.
 */
export function parseRevisionNumber(value: unknown): number | null {
  const revision = parseRevision(value)
  if (revision === null) return null
  const number = Number(revision)
  return Number.isSafeInteger(number) ? number : null
}

/**
 * Normalize one SVN timestamp (`2024-05-01T12:00:00.123456Z`) to ISO 8601.
 *
 * V8 happens to parse six-digit fractions, but the fraction is truncated to
 * milliseconds here so the value is valid regardless of parser tolerance.
 * @param raw - timestamp text from `svn --xml`.
 * @returns ISO 8601 UTC string, or undefined when unparseable.
 */
export function parseSvnDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(trimmed)
  const candidate = match === null
    ? trimmed
    : `${match[1]}.${(match[2] ?? '').padEnd(3, '0').slice(0, 3)}${match[3] ?? 'Z'}`
  const milliseconds = Date.parse(candidate)
  if (Number.isNaN(milliseconds)) return undefined
  return new Date(milliseconds).toISOString()
}

// ---------------------------------------------------------------------------
// argv builders (pure, argv arrays only)
// ---------------------------------------------------------------------------

/** Guard: a command target must be a non-empty string. */
function requireTarget(target: unknown): string {
  if (typeof target !== 'string' || target.trim() === '') throw new Error('svn target is required')
  return target
}

/** Guard: an executable name must be a non-empty string. */
function requireExecutable(executable: unknown): string {
  if (typeof executable !== 'string' || executable.trim() === '') throw new Error('svn executable is required')
  return executable
}

/** Guard: a revision used inside argv must be a canonical decimal string. */
function requireRevision(value: unknown): string {
  const revision = parseRevision(value)
  if (revision === null) throw new Error('invalid svn revision')
  return revision
}

/** Guard: a revision used inside argv must be a non-negative integer. */
function requireRevisionNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('invalid svn revision number')
  return value
}

/**
 * Build the client detection argv (`svn --version --quiet`).
 * @param executable - svn executable.
 * @returns argv array.
 */
export function buildVersionProbeArgs(executable: string): string[] {
  return [requireExecutable(executable), '--version', '--quiet']
}

/**
 * Build `svn info --xml` for one working copy path.
 * @param executable - svn executable.
 * @param target - absolute working copy path.
 * @returns argv array.
 */
export function buildInfoArgs(executable: string, target: string): string[] {
  return [requireExecutable(executable), 'info', '--xml', NON_INTERACTIVE, '--', requireTarget(target)]
}

/** Options for {@link buildLogArgs}. */
export interface LogArgsOptions {
  /** Revision range such as `HEAD:1` or `4:1`. */
  revisionRange: string
  /** Page size (`-l`), omitted for an unbounded read. */
  limit?: number
  /** Include changed paths (`-v`); defaults to true. */
  verbose?: boolean
}

/**
 * Build `svn log --xml`.
 * @param executable - svn executable.
 * @param target - working copy path.
 * @param options - range, limit and verbosity.
 * @returns argv array.
 */
export function buildLogArgs(executable: string, target: string, options: LogArgsOptions): string[] {
  const range = options.revisionRange.trim()
  if (!/^(?:HEAD|[0-9]{1,12})(?::(?:HEAD|[0-9]{1,12}))?$/.test(range)) throw new Error('invalid svn revision range')
  const argv = [requireExecutable(executable), 'log', '--xml', NON_INTERACTIVE]
  if (options.verbose !== false) argv.push('-v')
  argv.push('-r', range)
  if (options.limit !== undefined) {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1) throw new Error('invalid svn log limit')
    argv.push('-l', String(options.limit))
  }
  argv.push('--', requireTarget(target))
  return argv
}

/**
 * Build `svn status --xml` for one working copy path.
 * @param executable - svn executable.
 * @param target - absolute working copy path.
 * @returns argv array.
 */
export function buildStatusArgs(executable: string, target: string): string[] {
  return [requireExecutable(executable), 'status', '--xml', NON_INTERACTIVE, '--', requireTarget(target)]
}

/** Options for {@link buildDiffArgs}; exactly one of the two is required. */
export interface DiffArgsOptions {
  /** Single revision (`-c REV`). */
  revision?: string
  /** Revision range (`-r FROM:TO`). */
  range?: { from: number; to: number }
}

/**
 * Build `svn diff` for a revision or a revision range.
 * @param executable - svn executable.
 * @param target - working copy path or one file inside it.
 * @param options - single revision or range.
 * @returns argv array.
 */
export function buildDiffArgs(executable: string, target: string, options: DiffArgsOptions): string[] {
  const hasRevision = options.revision !== undefined
  const hasRange = options.range !== undefined
  if (hasRevision === hasRange) throw new Error('svn diff requires exactly one revision or one range')
  const argv = [requireExecutable(executable), 'diff', NON_INTERACTIVE]
  if (options.range !== undefined) {
    argv.push('-r', `${requireRevisionNumber(options.range.from)}:${requireRevisionNumber(options.range.to)}`)
  } else {
    argv.push('-c', requireRevision(options.revision))
  }
  argv.push('--', requireTarget(target))
  return argv
}

/**
 * Build `svn diff --summarize` for one revision.
 * @param executable - svn executable.
 * @param target - working copy path.
 * @param revision - revision to summarize.
 * @returns argv array.
 */
export function buildDiffSummarizeArgs(executable: string, target: string, revision: string): string[] {
  return [
    requireExecutable(executable),
    'diff',
    '--summarize',
    NON_INTERACTIVE,
    '-c',
    requireRevision(revision),
    '--',
    requireTarget(target),
  ]
}

/**
 * Build `svn update` with conflicts postponed rather than prompted for.
 * @param executable - svn executable.
 * @param target - working copy path.
 * @returns argv array.
 */
export function buildUpdateArgs(executable: string, target: string): string[] {
  return [
    requireExecutable(executable),
    'update',
    NON_INTERACTIVE,
    '--accept',
    'postpone',
    '--',
    requireTarget(target),
  ]
}

/**
 * Build `svn commit` for a message and zero or more absolute targets.
 *
 * `--` always separates options from targets so a path can never be parsed as
 * a flag.
 * @param executable - svn executable.
 * @param message - already validated commit message.
 * @param targets - absolute paths inside the working copy.
 * @returns argv array.
 */
export function buildCommitArgs(executable: string, message: string, targets: readonly string[]): string[] {
  if (typeof message !== 'string' || message.trim() === '') throw new Error('svn commit message is required')
  const argv = [requireExecutable(executable), 'commit', NON_INTERACTIVE, '-m', message, '--']
  for (const target of targets) argv.push(requireTarget(target))
  return argv
}

// ---------------------------------------------------------------------------
// `svn log --xml` parsing
// ---------------------------------------------------------------------------

/** One changed path inside a log entry. */
export interface SvnLogPath {
  /** `A`, `M`, `D` or `R` (upper-cased). */
  action: string
  /** `file` or `dir`, when emitted. */
  kind?: string
  /** Repository-absolute path as emitted by `svn log -v` (`/trunk/a.txt`). */
  path: string
  /** Repository-absolute copy source path, when this path was copied. */
  copyFromPath?: string
  /** Copy source revision, when this path was copied. */
  copyFromRevision?: string
  /** Whether properties changed. */
  propMods?: boolean
  /** Whether file content changed. */
  textMods?: boolean
}

/** One parsed `logentry`. */
export interface SvnLogEntry {
  /** Canonical decimal revision string. */
  revision: string
  author?: string
  /** ISO 8601 UTC timestamp. */
  date?: string
  /** Raw message text, preserving newlines; `''` for an empty message. */
  message: string
  paths: SvnLogPath[]
}

/** Parse a boolean-ish XML attribute (`true`/`false`). */
function parseBooleanAttribute(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined
  const value = raw.trim().toLowerCase()
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

/**
 * Parse the output of `svn log --xml -v`.
 * @param xml - complete document text.
 * @returns entries in document order (newest first for `HEAD:1`).
 * @throws {XmlParseError} when the document is malformed or a revision is not numeric.
 */
export function parseLogXml(xml: string): SvnLogEntry[] {
  const document = parseXml(xml)
  const log = rootElement(document, 'log')
  const entries: SvnLogEntry[] = []
  for (const entryNode of childElements(log, 'logentry')) {
    const revision = parseRevision(attributeText(entryNode, 'revision'))
    if (revision === null) throw new XmlParseError('svn log entry has no numeric revision')
    const author = childText(entryNode, 'author')
    const date = parseSvnDate(childText(entryNode, 'date'))
    const messageNode = firstChild(entryNode, 'msg')
    const message = messageNode === undefined ? '' : messageNode.text
    const paths: SvnLogPath[] = []
    const pathsNode = firstChild(entryNode, 'paths')
    if (pathsNode !== undefined) {
      for (const pathNode of childElements(pathsNode, 'path')) {
        const rawPath = pathNode.text.trim()
        const action = (attributeText(pathNode, 'action') ?? '').toUpperCase()
        if (rawPath === '' || action === '') continue
        const path: SvnLogPath = {
          action,
          path: rawPath,
          ...(attributeText(pathNode, 'kind') === undefined ? {} : { kind: attributeText(pathNode, 'kind') }),
          ...(attributeText(pathNode, 'copyfrom-path') === undefined
            ? {}
            : { copyFromPath: attributeText(pathNode, 'copyfrom-path') }),
          ...(parseRevision(attributeText(pathNode, 'copyfrom-rev')) === null
            ? {}
            : { copyFromRevision: parseRevision(attributeText(pathNode, 'copyfrom-rev')) as string }),
          ...(parseBooleanAttribute(attributeText(pathNode, 'prop-mods')) === undefined
            ? {}
            : { propMods: parseBooleanAttribute(attributeText(pathNode, 'prop-mods')) }),
          ...(parseBooleanAttribute(attributeText(pathNode, 'text-mods')) === undefined
            ? {}
            : { textMods: parseBooleanAttribute(attributeText(pathNode, 'text-mods')) }),
        }
        paths.push(path)
      }
    }
    entries.push({
      revision,
      ...(author === undefined ? {} : { author }),
      ...(date === undefined ? {} : { date }),
      message,
      paths,
    })
  }
  return entries
}

// ---------------------------------------------------------------------------
// `svn info --xml` parsing
// ---------------------------------------------------------------------------

/** Parsed `svn info --xml` facts. URLs are raw here; redact them when shown. */
export interface SvnInfo {
  /** `<entry path="...">` attribute, as emitted. */
  entryPath?: string
  kind?: string
  /** Working copy base revision. */
  revision?: string
  /** Absolute repository URL of the working copy root. */
  url?: string
  /** Repository-relative URL such as `^/trunk`. */
  relativeUrl?: string
  /** Repository root URL. */
  repositoryRoot?: string
  repositoryUuid?: string
  /** Absolute path of the working copy root. */
  wcRootPath?: string
  schedule?: string
  depth?: string
  /** Last-changed revision of the working copy root. */
  lastChangedRevision?: string
  lastChangedAuthor?: string
  /** ISO 8601 UTC last-changed timestamp. */
  lastChangedDate?: string
}

/**
 * Parse the output of `svn info --xml`.
 * @param xml - complete document text.
 * @returns the first entry's facts.
 * @throws {XmlParseError} when the document is malformed or has no entry.
 */
export function parseInfoXml(xml: string): SvnInfo {
  const document = parseXml(xml)
  const info = rootElement(document, 'info')
  const entry = firstChild(info, 'entry')
  if (entry === undefined) throw new XmlParseError('svn info output has no entry')
  const repository = firstChild(entry, 'repository')
  const wcInfo = firstChild(entry, 'wc-info')
  const commit = firstChild(entry, 'commit')
  const revision = parseRevision(attributeText(entry, 'revision'))
  const lastChangedRevision = parseRevision(commit === undefined ? undefined : attributeText(commit, 'revision'))
  const lastChangedDate = commit === undefined ? undefined : parseSvnDate(childText(commit, 'date'))
  return {
    ...(attributeText(entry, 'path') === undefined ? {} : { entryPath: attributeText(entry, 'path') }),
    ...(attributeText(entry, 'kind') === undefined ? {} : { kind: attributeText(entry, 'kind') }),
    ...(revision === null ? {} : { revision }),
    ...(childText(entry, 'url') === undefined ? {} : { url: childText(entry, 'url') }),
    ...(childText(entry, 'relative-url') === undefined ? {} : { relativeUrl: childText(entry, 'relative-url') }),
    ...(repository === undefined || childText(repository, 'root') === undefined
      ? {}
      : { repositoryRoot: childText(repository, 'root') }),
    ...(repository === undefined || childText(repository, 'uuid') === undefined
      ? {}
      : { repositoryUuid: childText(repository, 'uuid') }),
    ...(wcInfo === undefined || childText(wcInfo, 'wcroot-abspath') === undefined
      ? {}
      : { wcRootPath: childText(wcInfo, 'wcroot-abspath') }),
    ...(wcInfo === undefined || childText(wcInfo, 'schedule') === undefined
      ? {}
      : { schedule: childText(wcInfo, 'schedule') }),
    ...(wcInfo === undefined || childText(wcInfo, 'depth') === undefined
      ? {}
      : { depth: childText(wcInfo, 'depth') }),
    ...(lastChangedRevision === null ? {} : { lastChangedRevision }),
    ...(commit === undefined || childText(commit, 'author') === undefined
      ? {}
      : { lastChangedAuthor: childText(commit, 'author') }),
    ...(lastChangedDate === undefined ? {} : { lastChangedDate }),
  }
}

// ---------------------------------------------------------------------------
// `svn status --xml` parsing
// ---------------------------------------------------------------------------

/** Verbose SVN item statuses emitted by `svn status --xml`. */
const STATUS_ITEMS = new Set([
  'added', 'conflicted', 'deleted', 'external', 'ignored', 'incomplete', 'merged',
  'missing', 'modified', 'none', 'normal', 'obstructed', 'replaced', 'unversioned',
])

/** Single-letter aliases accepted defensively. */
const STATUS_LETTERS: Readonly<Record<string, string>> = {
  '?': 'unversioned',
  '!': 'missing',
  a: 'added',
  c: 'conflicted',
  d: 'deleted',
  i: 'ignored',
  m: 'modified',
  r: 'replaced',
  x: 'external',
  '~': 'obstructed',
}

/**
 * Normalize one status item token to a verbose SVN status.
 * @param raw - XML item or a single status letter.
 * @returns the normalized status; `unknown` for unrecognized tokens.
 */
export function normalizeStatusItem(raw: string): string {
  const value = raw.trim().toLowerCase()
  if (value === '') return 'none'
  const letter = STATUS_LETTERS[value]
  if (letter !== undefined) return letter
  return STATUS_ITEMS.has(value) ? value : 'unknown'
}

/** One parsed status entry. */
export interface SvnStatusEntry {
  /** Path exactly as emitted (relative to the target, or absolute). */
  path: string
  /** Normalized item status (`modified`, `deleted`, `conflicted`, ...). */
  item: string
  /** Normalized property status. */
  props: string
  /** Base revision attribute, when emitted. */
  revision?: string
  /** True for a tree conflict (`tree-conflicted="true"`). */
  treeConflicted?: boolean
}

/**
 * Parse the output of `svn status --xml`.
 * @param xml - complete document text.
 * @returns every entry of every target, in document order.
 * @throws {XmlParseError} when the document is malformed.
 */
export function parseStatusXml(xml: string): SvnStatusEntry[] {
  const document = parseXml(xml)
  const status = rootElement(document, 'status')
  const entries: SvnStatusEntry[] = []
  for (const target of childElements(status, 'target')) {
    for (const entry of childElements(target, 'entry')) {
      const rawPath = (attributeText(entry, 'path') ?? '').trim()
      if (rawPath === '') continue
      const wcStatus = firstChild(entry, 'wc-status')
      const item = normalizeStatusItem(wcStatus === undefined ? 'none' : (attributeText(wcStatus, 'item') ?? 'none'))
      const props = wcStatus === undefined
        ? 'none'
        : normalizeStatusItem(attributeText(wcStatus, 'props') ?? 'none')
      const revision = parseRevision(wcStatus === undefined ? undefined : attributeText(wcStatus, 'revision'))
      const treeConflicted = parseBooleanAttribute(
        wcStatus === undefined ? undefined : attributeText(wcStatus, 'tree-conflicted'),
      )
      entries.push({
        path: rawPath,
        item,
        props,
        ...(revision === null ? {} : { revision }),
        ...(treeConflicted === undefined || treeConflicted === false ? {} : { treeConflicted: true }),
      })
    }
  }
  return entries
}

// ---------------------------------------------------------------------------
// `svn diff --summarize` parsing
// ---------------------------------------------------------------------------

/** One parsed `svn diff --summarize` line. */
export interface SvnSummarizeEntry {
  /** `A`, `M`, `D`, `R` (upper-cased). */
  action: string
  /** Path as emitted by svn. */
  path: string
  copyFromPath?: string
  copyFromRevision?: string
}

/**
 * Parse `svn diff --summarize` text.
 *
 * The format is status-like: a content-change column, optional property /
 * lock / copy markers, then the path, optionally followed by
 * `(from /repo/path:REV)`. It is parsed leniently because svn versions and
 * locales pad the columns slightly differently.
 * @param text - command stdout.
 * @returns parsed entries in output order.
 */
export function parseDiffSummarize(text: string): SvnSummarizeEntry[] {
  const entries: SvnSummarizeEntry[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '')
    if (line.trim() === '') continue
    const match = /^\s*([A-Za-z?~!])\s+(?:\+\s+)?(.*)$/.exec(line)
    if (match === null) continue
    const action = (match[1] as string).toUpperCase()
    let pathPart = (match[2] as string).trim()
    if (pathPart === '') continue
    let copyFromPath: string | undefined
    let copyFromRevision: string | undefined
    const copyMatch = /^(.*?)\s+\(from (.+?):([0-9]{1,12})\)$/.exec(pathPart)
    if (copyMatch !== null) {
      pathPart = (copyMatch[1] as string).trim()
      copyFromPath = (copyMatch[2] as string).trim()
      copyFromRevision = parseRevision(copyMatch[3]) ?? undefined
    }
    if (pathPart === '') continue
    entries.push({
      action,
      path: pathPart,
      ...(copyFromPath === undefined ? {} : { copyFromPath }),
      ...(copyFromRevision === undefined ? {} : { copyFromRevision }),
    })
  }
  return entries
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/**
 * Percent-decode one repository URL path segment-by-segment.
 * Failed or boundary-changing decodes are left verbatim.
 * @param raw - URL path (no leading slash required).
 * @returns decoded path.
 */
export function decodeUriPath(raw: string): string {
  return raw
    .split('/')
    .map(segment => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')
}

/**
 * Derive the repository path prefix that corresponds to the working copy
 * root, from `svn info` facts.
 * @param info - parsed info.
 * @returns prefix without leading/trailing `/` (possibly `''`).
 */
export function svnPrefixFromInfo(info: SvnInfo): string {
  const relative = info.relativeUrl?.trim()
  if (relative !== undefined && relative !== '') {
    if (relative === '^' || relative === '^/') return ''
    const withoutCaret = relative.startsWith('^/') ? relative.slice(2) : relative
    return decodeUriPath(withoutCaret).replace(/^\/+|\/+$/g, '')
  }
  if (info.url !== undefined && info.repositoryRoot !== undefined) {
    const url = info.url.trim().replace(/\/+$/, '')
    const rootUrl = info.repositoryRoot.trim().replace(/\/+$/, '')
    if (url === rootUrl) return ''
    if (url.startsWith(`${rootUrl}/`)) {
      return decodeUriPath(url.slice(rootUrl.length + 1)).replace(/^\/+|\/+$/g, '')
    }
  }
  return ''
}

/**
 * Map a repository-absolute path from `svn log -v` to the working copy
 * relative path, stripping the working copy's repository prefix.
 *
 * Paths outside the working copy subtree keep their repository-relative form
 * (documented limitation: SVN logs may mention paths the local copy does not
 * contain).
 * @param rawPath - path as emitted by svn (`/trunk/a.txt` or `trunk/a.txt`).
 * @param wcPrefix - repository prefix of the working copy root (`trunk`).
 * @returns normalized `/`-separated relative path, or null.
 */
export function repoPathToRelative(rawPath: string, wcPrefix: string): string | null {
  if (typeof rawPath !== 'string') return null
  let path = rawPath.trim().replace(/\\/g, '/')
  if (path === '') return null
  if (path.startsWith('^/')) path = path.slice(1)
  if (path.startsWith('/')) path = path.slice(1)
  const prefix = wcPrefix.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (prefix !== '') {
    if (path === prefix) return null
    if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length + 1)
  }
  return normalizeRepoRelativePath(path)
}

/** Compare two `/`-separated paths, case-insensitively on Windows. */
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Whether `path` starts with `root + '/'`, case-insensitively on Windows. */
function pathStartsWithRoot(path: string, root: string): boolean {
  if (root === '') return false
  const normalizedPath = process.platform === 'win32' ? path.toLowerCase() : path
  const normalizedRoot = process.platform === 'win32' ? root.toLowerCase() : root
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

/**
 * Normalize a path emitted relative to a working copy target (status XML,
 * `diff --summarize`, `diff`) to a working copy relative path.
 * @param rawPath - path as emitted by svn.
 * @param wcRoot - absolute working copy root.
 * @returns normalized relative path, or null for the target itself/invalid input.
 */
export function targetPathToRelative(rawPath: string, wcRoot: string): string | null {
  if (typeof rawPath !== 'string') return null
  let path = rawPath.trim().replace(/\\/g, '/')
  if (path === '' || path === '.') return null
  const root = wcRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (root !== '' && pathStartsWithRoot(path, root)) path = path.slice(root.length)
  if (path.startsWith('^/')) path = path.slice(1)
  if (path.startsWith('/')) path = path.slice(1)
  if (samePath(path, root)) return null
  return normalizeRepoRelativePath(path)
}
