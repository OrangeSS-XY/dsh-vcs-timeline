/**
 * Local branch insight — pure argv builders, output parsers, and the action
 * table.
 *
 * Everything here is pure: no I/O, no subprocess, no clock. The service module
 * runs the commands; these parsers were written against git 2.45.1 on Windows
 * (record framing verified byte for byte, including the blank line that
 * separates `merge-tree`'s conflicted-file list from its informational
 * messages).
 * @module dsh-vcs-timeline/host/branch/compare
 */

import type { BranchCompareCommit, PullRequestAction } from '../../shared/contracts.ts'
import type { RunResult } from '../adapters/types.ts'
import { gitBase, isSafeBranchName } from '../adapters/git/commands.ts'
import { parseIsoTimestamp } from '../security.ts'

/** Largest commit list one comparison carries. */
export const MAX_COMPARE_COMMITS = 30

/** Deadline for one bounded git read of the comparison. */
export const COMPARE_TIMEOUT_MS = 8_000

/** Collected-output caps, per command. */
export const COMPARE_COUNT_CAP = 64 * 1024
export const COMPARE_LOG_CAP = 256 * 1024
export const COMPARE_SHORTSTAT_CAP = 64 * 1024
export const COMPARE_MERGE_TREE_CAP = 512 * 1024

/** Largest base-branch name the comparison accepts. */
export const MAX_BASE_BRANCH_LENGTH = 200

/** Field separator inside one commit record. */
const NUL = '\u0000'

/** `git rev-parse --abbrev-ref HEAD` (prints `HEAD` when detached). */
export function compareCurrentBranchArgs(): string[] {
  return [...gitBase(), 'rev-parse', '--abbrev-ref', 'HEAD']
}

/** `git rev-parse --verify --quiet <ref>^{commit}`: exit 0 only when it exists. */
export function verifyRefArgs(ref: string): string[] {
  return [...gitBase(), 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`]
}

/** `git rev-parse --abbrev-ref --symbolic-full-name '@{u}'` (fails without upstream). */
export function upstreamArgs(): string[] {
  return [...gitBase(), 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']
}

/** `git rev-list --left-right --count <left>...<right>`: `<left>\t<right>`. */
export function revListCountArgs(left: string, right: string): string[] {
  return [...gitBase(), 'rev-list', '--left-right', '--count', `${left}...${right}`]
}

/** One `git log` page of the commits the base branch does not contain. */
export function compareLogArgs(base: string): string[] {
  return [
    ...gitBase(),
    'log',
    '--no-color',
    '-z',
    '--date-order',
    `--max-count=${MAX_COMPARE_COMMITS}`,
    '--format=%H%x00%an%x00%aI%x00%s',
    `${base}..HEAD`,
  ]
}

/** `git diff --shortstat <base>...HEAD`. */
export function shortstatArgs(base: string): string[] {
  return [...gitBase(), 'diff', '--shortstat', `${base}...HEAD`]
}

/** `git merge-tree --write-tree --name-only <base> HEAD` (git 2.38+). */
export function mergeTreeArgs(base: string): string[] {
  return [...gitBase(), 'merge-tree', '--write-tree', '--name-only', base, 'HEAD']
}

/**
 * Whether a query value may be used as a base branch.
 *
 * It is appended to a revision expression, so it must pass the adapter's branch
 * name guard (no whitespace, no revision syntax, no option-like prefix) and may
 * not contain `@{`, which git would read as a reflog/upstream expression.
 * @param value - candidate from the query or the repository record.
 * @returns true when the name is safe to hand to git.
 */
export function isCompareBaseName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_BASE_BRANCH_LENGTH
    && isSafeBranchName(value)
    && !value.includes('@{')
}

/** One parsed `--left-right --count` pair. */
export interface RevListCounts {
  left: number
  right: number
}

/**
 * Parse `git rev-list --left-right --count A...B` output (`<left>\t<right>`).
 * @param text - raw stdout.
 * @returns the two counts, or null when the output is not exactly two numbers.
 */
export function parseRevListCounts(text: string): RevListCounts | null {
  const parts = text.trim().split(/\s+/).filter(part => part !== '')
  if (parts.length !== 2) return null
  const left = Number.parseInt(parts[0] ?? '', 10)
  const right = Number.parseInt(parts[1] ?? '', 10)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null
  return { left, right }
}

/**
 * Parse `git log -z --format=%H%x00%an%x00%aI%x00%s` output.
 *
 * Each commit is four NUL-terminated fields; `-z` terminates the record, so the
 * stream ends with a NUL. A trailing empty token is dropped, and any newline
 * git added between records is ignored. A malformed trailing group is dropped
 * rather than throwing.
 * @param text - raw stdout.
 * @returns the parsed commits, newest first.
 */
export function parseCompareLogZ(text: string): BranchCompareCommit[] {
  if (text === '') return []
  const tokens = text.split(NUL).map(token => token.replace(/^\r?\n+/, ''))
  // `-z` terminates the last record with a NUL, so at most one empty token is a
  // framing artifact; an empty *field* (an empty subject) must be preserved.
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop()
  const commits: BranchCompareCommit[] = []
  for (let index = 0; index + 3 < tokens.length; index += 4) {
    const hash = (tokens[index] ?? '').trim()
    if (hash === '') continue
    const author = tokens[index + 1] ?? ''
    const authorDate = tokens[index + 2] ?? ''
    const summary = tokens[index + 3] ?? ''
    commits.push({
      hash,
      summary,
      ...(author === '' ? {} : { author }),
      timestamp: parseIsoTimestamp(authorDate) ?? new Date(0).toISOString(),
    })
  }
  return commits
}

/** Aggregated `--shortstat` numbers. */
export interface ShortstatCounts {
  filesChanged: number
  additions: number
  deletions: number
}

/** `N file(s) changed` of a `--shortstat` line. */
const SHORTSTAT_FILES = /(\d+)\s+files?\s+changed/i
/** `N insertion(s)(+)` of a `--shortstat` line. */
const SHORTSTAT_ADDITIONS = /(\d+)\s+insertions?\(\+\)/i
/** `N deletion(s)(-)` of a `--shortstat` line. */
const SHORTSTAT_DELETIONS = /(\d+)\s+deletions?\(-\)/i

/**
 * Parse one `git diff --shortstat` line.
 *
 * git omits zero parts ("1 file changed, 2 insertions(+)"), so a missing part is
 * a true zero. An empty output (no changes at all) parses to all zeros; a line
 * that mentions no files at all is still tolerated as zero.
 * @param text - raw stdout.
 * @returns the aggregated numbers.
 */
export function parseShortstat(text: string): ShortstatCounts {
  const files = SHORTSTAT_FILES.exec(text)
  const additions = SHORTSTAT_ADDITIONS.exec(text)
  const deletions = SHORTSTAT_DELETIONS.exec(text)
  const value = (match: RegExpExecArray | null): number => {
    if (match === null) return 0
    const parsed = Number.parseInt(match[1] ?? '', 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  }
  return { filesChanged: value(files), additions: value(additions), deletions: value(deletions) }
}

/** Outcome of one `git merge-tree` conflict probe. */
export interface MergeTreeOutcome {
  /** Conflicted paths; `[]` only when git proved the merge is clean. */
  conflicts: string[] | null
  /** Why the conflict state is unknown, when it is. */
  unsupportedReason?: string
}

/**
 * Decode one git C-quoted path (`"\303\274.txt"`, `"a\tb"`).
 *
 * Quoting only happens for paths with a newline, tab, quote, or backslash; the
 * octal escapes are raw bytes, so they are collected and decoded as UTF-8.
 * @param body - the text between the surrounding quotes.
 * @returns the decoded path.
 */
function decodeGitQuoted(body: string): string {
  const bytes: number[] = []
  const pushText = (text: string): void => {
    for (const byte of Buffer.from(text, 'utf8')) bytes.push(byte)
  }
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? ''
    if (char !== '\\') {
      pushText(char)
      continue
    }
    const rest = body.slice(index + 1)
    const octal = /^[0-7]{1,3}/.exec(rest)
    if (octal !== null) {
      bytes.push(Number.parseInt(octal[0], 8) & 0xff)
      index += octal[0].length
      continue
    }
    const next = rest[0]
    if (next === undefined) {
      bytes.push(0x5c)
      break
    }
    index += 1
    switch (next) {
      case 'n': bytes.push(0x0a); break
      case 't': bytes.push(0x09); break
      case 'r': bytes.push(0x0d); break
      case 'a': bytes.push(0x07); break
      case 'b': bytes.push(0x08); break
      case 'f': bytes.push(0x0c); break
      case 'v': bytes.push(0x0b); break
      case '"': bytes.push(0x22); break
      case '\\': bytes.push(0x5c); break
      default: pushText(next)
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

/**
 * Normalize one path line of `merge-tree --name-only` output.
 * @param line - one raw output line.
 * @returns the path, or null for an empty line.
 */
function mergeTreePath(line: string): string | null {
  const value = line.replace(/\r$/, '')
  if (value === '') return null
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return decodeGitQuoted(value.slice(1, -1))
  }
  return value
}

/**
 * Read the conflicted path list out of `merge-tree --write-tree --name-only`.
 *
 * The output is: the toplevel tree OID, the conflicted files (one per line),
 * a blank line, then informational messages. Messages are never paths, so the
 * list stops at the first blank line. Exit code 0 means git proved the merge is
 * clean; exit code 1 means conflicts, and a list that cannot be parsed is
 * reported as unknown (`null`) instead of "no conflicts".
 * @param result - the finished command.
 * @returns the conflict state.
 */
export function parseMergeTree(result: RunResult): MergeTreeOutcome {
  if (result.spawnFailed === true) return { conflicts: null, unsupportedReason: 'git merge-tree could not run' }
  if (result.exitCode === 0) return { conflicts: [] }
  if (result.exitCode !== 1) {
    const fatal = result.stderr.trim().split(/\r?\n/)[0]?.trim() ?? ''
    const detail = fatal === '' ? '' : `: ${fatal.slice(0, 200)}`
    return {
      conflicts: null,
      unsupportedReason: `git merge-tree is unavailable or failed${detail}`,
    }
  }
  const lines = result.stdout.split(/\r?\n/)
  let start = 0
  while (start < lines.length && (lines[start] ?? '').trim() === '') start += 1
  // The first non-empty line is the merged tree OID; there is no path list
  // without it, so treat that as an unparseable answer.
  if (start >= lines.length) return { conflicts: null, unsupportedReason: 'the git merge-tree output could not be parsed' }
  const conflicts: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.replace(/\r$/, '') === '') break
    const path = mergeTreePath(line)
    if (path !== null && path !== '') conflicts.push(path)
  }
  if (conflicts.length === 0) return { conflicts: null, unsupportedReason: 'the git merge-tree output could not be parsed' }
  return { conflicts }
}

/** Every fact the local action table reads. */
export interface BranchActionFacts {
  /** Conflicted paths from the local merge probe; null when unknown. */
  conflicts: readonly string[] | null
  /** Commits on the current branch that the base branch does not contain. */
  ahead: number
  /** Commits on the base branch that the current branch does not contain. */
  behind: number
  /** Commits ahead of the configured upstream; null when there is no upstream. */
  unpushed: number | null
}

/**
 * Derive the suggested local next step.
 *
 * Exactly one action is emitted: the first matching row of the documented
 * decision table wins, so the result is never empty.
 * @param facts - the numbers the comparison computed.
 * @returns the ordered actions (always exactly one today).
 */
export function deriveBranchActions(facts: BranchActionFacts): PullRequestAction[] {
  if (facts.conflicts !== null && facts.conflicts.length > 0) {
    return [{ kind: 'fix-conflicts', reason: 'merge-conflict' }]
  }
  if (facts.unpushed === null && facts.ahead > 0) {
    return [{ kind: 'create-pr', reason: 'no-upstream' }]
  }
  if (facts.unpushed !== null && facts.unpushed > 0) {
    return [{ kind: 'push', reason: 'unpushed-commits' }]
  }
  if (facts.behind > 0) {
    return [{ kind: 'pull', reason: 'behind-base' }]
  }
  if (facts.ahead > 0) {
    return [{ kind: 'create-pr', reason: 'ahead-of-base' }]
  }
  return [{ kind: 'wait', reason: 'in-sync' }]
}
