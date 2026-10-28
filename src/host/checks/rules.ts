/**
 * Pure pre-commit rule engine over unified diff text.
 *
 * The caller supplies a real `git diff` (or worktree/staged diff) as plain
 * text; this module never reads a file, spawns a process or opens a network
 * connection, so its answer is a deterministic function of that text. Every
 * finding is scoped to a repository-relative path and — where a hunk header
 * makes it knowable — to the 1-based new-file line number.
 *
 * Secret values are never echoed: a `secret-pattern` finding carries only the
 * matched pattern names, never the credential itself.
 * @module dsh-vcs-timeline/host/checks/rules
 */

import type { CheckFinding, CheckSeverity } from '../../shared/contracts.ts'

/** Options accepted by {@link runCheckRules}. */
export interface CheckRulesOptions {
  /** Maximum findings returned after dedupe and sort; defaults to 50. */
  maxFindings?: number
}

/** Result of one rule pass over a diff. */
export interface CheckRulesResult {
  findings: CheckFinding[]
  filesChecked: number
  empty: boolean
}

/** Findings kept when the caller did not ask for a specific cap. */
const DEFAULT_MAX_FINDINGS = 50

/** A file with more added lines than this is reported as large. */
const LARGE_FILE_ADDED_LINES = 500

/** Added line that opens a private key block; the body never matters. */
const PRIVATE_KEY_PATTERN = /BEGIN (?:RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY/

/** Token patterns reported as `secret-pattern`, each with its machine name. */
const SECRET_PATTERNS: readonly { readonly name: string; readonly regex: RegExp }[] = [
  { name: 'aws-access-key-id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'github-token', regex: /\b(?:ghp|gho|ghs)_[A-Za-z0-9]{16,}\b/ },
  { name: 'github-fine-grained-token', regex: /\bgithub_pat_[A-Za-z0-9_]{16,}\b/ },
  { name: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/ },
  { name: 'openai-api-key', regex: /\bsk-[A-Za-z0-9]{20,}\b/ },
]

/** Conflict markers, anchored to the start of the file line. */
const CONFLICT_START = /^<{7}(?=[ \t]|$)/
const CONFLICT_MIDDLE = /^={7}(?=[ \t]|$)/
const CONFLICT_END = /^>{7}(?=[ \t]|$)/

/** Changed paths whose basename marks a generated lockfile. */
const LOCKFILE_BASENAMES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'go.sum',
  'Cargo.lock',
  'poetry.lock',
])

/** A path that lives in a test tree or looks like a test/spec file. */
const TEST_PATH_PATTERN = /(?:^|\/)(?:test|tests|__tests__|spec|specs)(?:\/|$)|\.(?:test|spec)\.[^/]+$/i

/** Binary markers Git emits instead of a hunk. */
const BINARY_DIFF_LINE = /^Binary files .* differ$/

/** Hunk header; only the new-file start line is needed. */
const HUNK_HEADER_PATTERN = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Order findings by severity first: blocking, warning, info. */
const SEVERITY_RANK: Readonly<Record<CheckSeverity, number>> = {
  blocking: 0,
  warning: 1,
  info: 2,
}

/** One added line with its new-file line number (0 when unknown). */
interface AddedLine {
  text: string
  line: number
}

/** One `diff --git` section of the parsed diff. */
interface DiffSection {
  oldPath: string | null
  newPath: string | null
  deleted: boolean
  binary: boolean
  added: AddedLine[]
}

/** File paths carried by one `diff --git` header. */
interface HeaderPaths {
  oldPath: string | null
  newPath: string | null
}

/**
 * Run every rule over one unified diff.
 *
 * This is the module's only entry point: it parses the text, reports findings
 * per file, deduplicates them by rule and path, sorts them blocking > warning
 * > info, and caps the list at `maxFindings`.
 */
export function runCheckRules(diffText: string, options: CheckRulesOptions = {}): CheckRulesResult {
  const empty = diffText.trim() === ''
  const sections = empty ? [] : parseDiffText(diffText)
  const collector = new FindingCollector()

  if (empty) {
    collector.add({ rule: 'no-changes', severity: 'info' })
  }

  for (const section of sections) collectSectionFindings(section, collector)

  return {
    findings: collector.finish(clampMaxFindings(options.maxFindings)),
    filesChecked: sections.length,
    empty,
  }
}

/** Clamp a caller-supplied cap; non-finite or absent input falls back. */
function clampMaxFindings(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_FINDINGS
  return Math.max(0, Math.trunc(value))
}

/** Collect one section's findings. */
function collectSectionFindings(section: DiffSection, collector: FindingCollector): void {
  const path = section.newPath ?? section.oldPath
  if (path === null) return

  collectConflictMarkers(section, path, collector)
  collectSecretMaterial(section, path, collector)

  if (LOCKFILE_BASENAMES.has(basenameOf(path))) {
    collector.add({ rule: 'lockfile', severity: 'warning', path, detail: basenameOf(path) })
  }

  if (section.deleted && TEST_PATH_PATTERN.test(path)) {
    collector.add({ rule: 'test-deleted', severity: 'warning', path })
  }

  if (section.binary) {
    collector.add({ rule: 'binary-file', severity: 'info', path })
  }

  if (section.added.length > LARGE_FILE_ADDED_LINES) {
    collector.add({ rule: 'large-file', severity: 'warning', path, count: section.added.length })
  }
}

/**
 * Report conflict markers in added lines.
 *
 * A lone `=======` is a plausible markdown separator, so it only counts when
 * the same file also adds `<<<<<<<` or `>>>>>>>` (or when it sits inside such
 * a block, which that condition already covers).
 */
function collectConflictMarkers(section: DiffSection, path: string, collector: FindingCollector): void {
  let startOrEnd = 0
  let middles = 0
  let line: number | undefined

  for (const added of section.added) {
    const text = added.text
    if (CONFLICT_START.test(text) || CONFLICT_END.test(text)) {
      startOrEnd += 1
      line ??= lineOrUndefined(added.line)
    } else if (CONFLICT_MIDDLE.test(text)) {
      middles += 1
    }
  }

  if (startOrEnd === 0) return

  const finding: CheckFinding = {
    rule: 'conflict-marker',
    severity: 'blocking',
    path,
    count: startOrEnd + middles,
  }
  if (line !== undefined) finding.line = line
  collector.add(finding)
}

/** Report private key headers and credential-like tokens in added lines. */
function collectSecretMaterial(section: DiffSection, path: string, collector: FindingCollector): void {
  const patternNames = new Set<string>()
  let keyCount = 0
  let keyLine: number | undefined
  let tokenCount = 0
  let tokenLine: number | undefined

  for (const added of section.added) {
    if (PRIVATE_KEY_PATTERN.test(added.text)) {
      keyCount += 1
      keyLine ??= lineOrUndefined(added.line)
    }
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.regex.test(added.text)) {
        patternNames.add(pattern.name)
        tokenCount += 1
        tokenLine ??= lineOrUndefined(added.line)
      }
    }
  }

  if (keyCount > 0) {
    const finding: CheckFinding = { rule: 'private-key', severity: 'blocking', path, count: keyCount }
    if (keyLine !== undefined) finding.line = keyLine
    collector.add(finding)
  }

  if (tokenCount > 0) {
    // Only the pattern names are emitted; the matched secret is never copied.
    const finding: CheckFinding = {
      rule: 'secret-pattern',
      severity: 'warning',
      path,
      count: tokenCount,
      detail: [...patternNames].join(', '),
    }
    if (tokenLine !== undefined) finding.line = tokenLine
    collector.add(finding)
  }
}

/** Parse a unified diff into one section per `diff --git` header. */
function parseDiffText(diffText: string): DiffSection[] {
  const sections: DiffSection[] = []
  const lines = diffText.split(/\r?\n/)
  let current: DiffSection | null = null
  let inHunk = false
  let newLine = 0

  const flush = (): void => {
    if (current !== null) sections.push(current)
    current = null
    inHunk = false
    newLine = 0
  }

  for (const rawLine of lines) {
    if (rawLine.startsWith('diff --git ')) {
      flush()
      const paths = parseDiffGitHeader(rawLine)
      current = { oldPath: paths.oldPath, newPath: paths.newPath, deleted: false, binary: false, added: [] }
      continue
    }

    const section = current
    if (section === null) continue

    // A binary section has no hunks; its base85 payload must not be parsed as
    // patch lines, so everything after the marker is ignored.
    if (section.binary) continue

    const hunkStart = parseHunkHeader(rawLine)
    if (hunkStart !== null) {
      inHunk = true
      newLine = hunkStart
      continue
    }

    if (!inHunk) {
      if (rawLine.startsWith('--- ')) {
        section.oldPath = parseFileMarker(rawLine.slice(4))
        continue
      }
      if (rawLine.startsWith('+++ ')) {
        section.newPath = parseFileMarker(rawLine.slice(4))
        continue
      }
      if (rawLine.startsWith('deleted file mode ')) {
        section.deleted = true
        continue
      }
      if (rawLine.startsWith('GIT binary patch') || BINARY_DIFF_LINE.test(rawLine)) {
        section.binary = true
        continue
      }
      continue
    }

    if (rawLine.startsWith('+')) {
      section.added.push({ text: rawLine.slice(1), line: newLine })
      newLine += 1
      continue
    }
    if (rawLine.startsWith(' ')) {
      newLine += 1
      continue
    }
    // Removed lines, "\ No newline at end of file" and trailing junk do not
    // advance the new-file line counter.
  }

  flush()
  return sections
}

/** Parse the new-file start line out of a hunk header; null when absent. */
function parseHunkHeader(line: string): number | null {
  const match = HUNK_HEADER_PATTERN.exec(line)
  if (match === null) return null
  const value = match[1]
  if (value === undefined) return null
  const start = Number.parseInt(value, 10)
  return Number.isFinite(start) ? start : null
}

/**
 * Parse the path out of a `---`/`+++` file marker.
 *
 * `a/` and `b/` prefixes are stripped, surrounding quotes are decoded and a
 * trailing SVN-style timestamp is dropped. `/dev/null` (the marker of an added
 * or deleted side) becomes null.
 */
function parseFileMarker(raw: string): string | null {
  let value = raw.trim()
  const tab = value.indexOf('\t')
  if (tab >= 0) value = value.slice(0, tab)
  value = unquotePath(value).trim()
  if (value === '' || value === '/dev/null') return null
  if (value.startsWith('a/') || value.startsWith('b/')) value = value.slice(2)
  while (value.startsWith('./')) value = value.slice(2)
  if (value === '') return null
  return value.replace(/\\/g, '/')
}

/** Parse the two paths out of a `diff --git` header. */
function parseDiffGitHeader(line: string): HeaderPaths {
  const rest = line.slice('diff --git '.length).trim()

  const quoted = /^"((?:\\.|[^"\\])*)" "((?:\\.|[^"\\])*)"$/.exec(rest)
  if (quoted !== null) {
    return {
      oldPath: parseFileMarker(quoted[1] ?? ''),
      newPath: parseFileMarker(quoted[2] ?? ''),
    }
  }

  // Unquoted headers are ambiguous when a path contains spaces; the exact
  // `---`/`+++` markers (when present) overwrite this best-effort guess.
  const unquoted = /^a\/(.+?) b\/(.+)$/.exec(rest)
  if (unquoted !== null) {
    const oldValue = unquoted[1] ?? ''
    const newValue = unquoted[2] ?? ''
    return {
      oldPath: oldValue.trim() === '' ? null : oldValue.trim().replace(/\\/g, '/'),
      newPath: newValue.trim() === '' ? null : newValue.trim().replace(/\\/g, '/'),
    }
  }

  return { oldPath: null, newPath: null }
}

/** Decode Git's C-style quoting around a path. */
function unquotePath(value: string): string {
  if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value
  const body = value.slice(1, -1)
  let result = ''
  for (let index = 0; index < body.length; index += 1) {
    const char = body.charAt(index)
    if (char !== '\\') {
      result += char
      continue
    }
    const next = body.charAt(index + 1)
    if (next === '') break
    if (next >= '0' && next <= '7') {
      let octal = ''
      let cursor = index + 1
      while (cursor < body.length && octal.length < 3) {
        const digit = body.charAt(cursor)
        if (digit < '0' || digit > '7') break
        octal += digit
        cursor += 1
      }
      result += String.fromCharCode(Number.parseInt(octal, 8))
      index = cursor - 1
      continue
    }
    result += decodeEscape(next)
    index += 1
  }
  return result
}

/** Decode one backslash escape from Git's quoted path form. */
function decodeEscape(char: string): string {
  switch (char) {
    case 'n': return '\n'
    case 't': return '\t'
    case 'r': return '\r'
    case 'b': return '\b'
    case 'f': return '\f'
    default: return char
  }
}

/** The last path segment of a `/`-separated repository path. */
function basenameOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash >= 0 ? path.slice(slash + 1) : path
}

/** A reportable line number, or undefined when the line is unknown. */
function lineOrUndefined(line: number): number | undefined {
  return line > 0 ? line : undefined
}

/**
 * Deduplicates findings by `rule + path` and sorts them by severity, path,
 * line and rule so the output is stable for the same input.
 */
class FindingCollector {
  private readonly findings = new Map<string, CheckFinding>()

  add(finding: CheckFinding): void {
    const key = `${finding.rule}\u0000${finding.path ?? ''}`
    const existing = this.findings.get(key)
    if (existing === undefined) {
      this.findings.set(key, finding)
      return
    }

    const merged: CheckFinding = { ...existing }
    if (finding.count !== undefined) merged.count = (existing.count ?? 0) + finding.count
    if (finding.line !== undefined && (existing.line === undefined || finding.line < existing.line)) {
      merged.line = finding.line
    }
    const detail = mergeDetail(existing.detail, finding.detail)
    if (detail !== undefined) merged.detail = detail
    this.findings.set(key, merged)
  }

  finish(maxFindings: number): CheckFinding[] {
    const ordered = [...this.findings.values()]
    ordered.sort(compareFindings)
    return ordered.slice(0, maxFindings)
  }
}

/** Combine two detail strings without dropping either side. */
function mergeDetail(left: string | undefined, right: string | undefined): string | undefined {
  if (right === undefined) return left
  if (left === undefined || left === right) return right
  return `${left}, ${right}`
}

/** Stable severity-then-location ordering for {@link FindingCollector.finish}. */
function compareFindings(left: CheckFinding, right: CheckFinding): number {
  const severity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
  if (severity !== 0) return severity
  const path = compareText(left.path ?? '', right.path ?? '')
  if (path !== 0) return path
  const line = (left.line ?? 0) - (right.line ?? 0)
  if (line !== 0) return line
  return compareText(left.rule, right.rule)
}

/** Locale-independent string comparison. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
