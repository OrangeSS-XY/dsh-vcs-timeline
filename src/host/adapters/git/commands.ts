/**
 * Git argv builders and machine-readable parsers.
 *
 * Everything here is pure: no I/O, no subprocess. The formats were verified
 * against git 2.45.1 on Windows with real repositories, including renames,
 * binary files, unicode/space paths, empty commit bodies, and an unborn HEAD.
 * @module dsh-vcs-timeline/host/adapters/git/commands
 */

import { basename } from 'node:path'
import type { ChangedFile, ChangeSet, Repository, VcsEvent, WorkingTreeEntry, WorkingTreeStatus } from '../../../shared/contracts.ts'
import { SCHEMA_VERSION } from '../../../shared/contracts.ts'
import { normalizeRepoRelativePath, parseIsoTimestamp, redactUrl } from '../../security.ts'

/** Field separator inside one commit record. */
const NUL = '\u0000'

/** Start-of-header marker that prefixes each commit hash in the stats stream. */
const SOH = '\u0001'

/** Log format: eight NUL-separated fields per commit, records NUL-terminated by `-z`. */
export const LOG_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%s%x00%b'

/** Git base argv: never a shell, never a pager, no path quoting, UTF-8 output. */
export function gitBase(): string[] {
  return ['git', '--no-pager', '-c', 'core.quotepath=false', '-c', 'i18n.logOutputEncoding=UTF-8']
}

/** `git -C <dir> rev-parse --show-toplevel`. */
export function detectArgs(path: string): string[] {
  return ['git', '-C', path, 'rev-parse', '--show-toplevel']
}

/** Current branch name (`HEAD` when detached). */
export function branchArgs(): string[] {
  return [...gitBase(), 'rev-parse', '--abbrev-ref', 'HEAD']
}

/** Current commit hash. */
export function headArgs(): string[] {
  return [...gitBase(), 'rev-parse', 'HEAD']
}

/** All remotes with their fetch/push URLs. */
export function remoteArgs(): string[] {
  return [...gitBase(), 'remote', '-v']
}

/** Remote default branch symbolic ref. */
export function originHeadArgs(): string[] {
  return [...gitBase(), 'symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']
}

/** Configured default branch name. */
export function configDefaultBranchArgs(): string[] {
  return [...gitBase(), 'config', '--get', 'init.defaultBranch']
}

/** Local branch names. */
export function branchListArgs(): string[] {
  return [...gitBase(), 'branch', '--format=%(refname:short)']
}

/** Commits ahead/behind the upstream. */
export function aheadBehindArgs(): string[] {
  return [...gitBase(), 'rev-list', '--left-right', '--count', '@{upstream}...HEAD']
}

/** History page input after validation. */
export interface LogArgsInput {
  skip: number
  limit: number
  author?: string
  text?: string
  since?: string
  until?: string
}

/** History filters shared by the history and the per-commit stats invocations. */
function logFilterArgs(input: LogArgsInput): string[] {
  const args: string[] = []
  if (input.author !== undefined && input.author !== '') {
    // --fixed-strings keeps the author a literal substring, so a value such as
    // "[" is a search term and never an invalid regular expression.
    args.push('--fixed-strings', `--author=${input.author}`)
  }
  if (input.text !== undefined && input.text !== '') {
    args.push('--regexp-ignore-case', '--fixed-strings', `--grep=${input.text}`)
  }
  if (input.since !== undefined) args.push(`--since=${input.since}`)
  if (input.until !== undefined) args.push(`--until=${input.until}`)
  return args
}

/** One `git log` page argv. */
export function logArgs(input: LogArgsInput): string[] {
  return [
    ...gitBase(),
    'log',
    '--no-color',
    '-z',
    '--date-order',
    `--max-count=${Math.max(1, input.limit)}`,
    `--skip=${Math.max(0, input.skip)}`,
    `--format=${LOG_FORMAT}`,
    ...logFilterArgs(input),
  ]
}

/**
 * One `git log` page argv carrying numstat lines, used to build per-commit
 * change statistics. Filters, skip and limit are identical to {@link logArgs}
 * so both invocations describe the same commits.
 */
export function logStatsArgs(input: LogArgsInput): string[] {
  return [
    ...gitBase(),
    'log',
    '--no-color',
    '-z',
    '--numstat',
    '--date-order',
    `--max-count=${Math.max(1, input.limit)}`,
    `--skip=${Math.max(0, input.skip)}`,
    `--format=${SOH}%H`,
    ...logFilterArgs(input),
  ]
}

/** A commit hash: 7..64 hex digits (a full or unambiguous abbreviation), never option-like. */
export function isCommitHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{7,64}$/i.test(value)
}

/** `git show -s --format=...` for one commit's metadata. */
export function commitMetaArgs(revision: string): string[] {
  return [...gitBase(), 'show', '-s', '--no-color', '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%B', revision]
}

/** Name/status list of one commit (`-z`, rename-aware). */
export function commitNameStatusArgs(revision: string): string[] {
  return [...gitBase(), 'show', '--no-color', '--format=', '--name-status', '-z', '--find-renames', revision]
}

/** Numstat list of one commit (`-z`, rename-aware). */
export function commitNumstatArgs(revision: string): string[] {
  return [...gitBase(), 'show', '--no-color', '--format=', '--numstat', '-z', '--find-renames', revision]
}

/** Single-commit diff argv. */
export function showDiffArgs(revision: string, contextLines: number, filePath?: string): string[] {
  const argv = [
    ...gitBase(),
    'show',
    '--no-color',
    '--format=',
    '--find-renames',
    `-U${contextLines}`,
    revision,
  ]
  if (filePath !== undefined) argv.push('--', filePath)
  return argv
}

/** Range diff argv. */
export function rangeDiffArgs(revisionA: string, revisionB: string, contextLines: number, filePath?: string): string[] {
  const argv = [
    ...gitBase(),
    'diff',
    '--no-color',
    '--find-renames',
    `-U${contextLines}`,
    revisionA,
    revisionB,
  ]
  if (filePath !== undefined) argv.push('--', filePath)
  return argv
}

/** Porcelain v2 status argv. */
export function statusArgs(): string[] {
  return [...gitBase(), 'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all']
}

/** Porcelain v1 status argv, used when v2 is unavailable. */
export function statusV1Args(): string[] {
  return [...gitBase(), 'status', '--porcelain', '-z', '--untracked-files=all']
}

/** Staged paths argv. */
export function stagedNamesArgs(): string[] {
  return [...gitBase(), 'diff', '--cached', '--name-only', '-z']
}

/** Remote names only. */
export function remoteNamesArgs(): string[] {
  return [...gitBase(), 'remote']
}

/** Current branch name only. */
export function currentBranchArgs(): string[] {
  return [...gitBase(), 'branch', '--show-current']
}

/** Fetch argv (no prune, no --all). */
export function fetchArgs(): string[] {
  return [...gitBase(), 'fetch']
}

/** Fast-forward-only pull argv. */
export function pullArgs(): string[] {
  return [...gitBase(), 'pull', '--ff-only']
}

/** Commit staged changes argv. */
export function commitArgs(message: string): string[] {
  return [...gitBase(), 'commit', '-m', message]
}

/** Push explicit remote+branch argv. */
export function pushArgs(remote: string, branch: string): string[] {
  return [...gitBase(), 'push', '--porcelain', remote, branch]
}

/** A safe remote name: no leading dash, no whitespace or shell metacharacters. */
export function isSafeRemoteName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 255
    && !value.startsWith('-')
    && !/[\s~^:?*[\\"'`$&|;<>]/.test(value)
}

/** A safe branch name: no leading dash, no whitespace, no revision syntax. */
export function isSafeBranchName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 255
    && !value.startsWith('-')
    && !value.startsWith('/')
    && !value.endsWith('/')
    && !value.includes('..')
    && !/[\s~^:?*[\\"'`$&|;<>]/.test(value)
}

/** One parsed commit record. */
export interface ParsedCommit {
  hash: string
  parents: string[]
  author: string
  authorEmail: string
  authorDate: string
  decorations: string
  subject: string
  body: string
}

/**
 * Parse `git log -z --format=LOG_FORMAT` output.
 *
 * Eight NUL-separated fields per commit; `-z` terminates each record with NUL
 * as well, and an empty body yields two consecutive NULs.
 */
export function parseLogOutput(text: string): ParsedCommit[] {
  if (text === '') return []
  const tokens = text.split(NUL)
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop()
  const commits: ParsedCommit[] = []
  for (let index = 0; index + 7 < tokens.length; index += 8) {
    commits.push({
      hash: tokens[index] ?? '',
      parents: (tokens[index + 1] ?? '').split(' ').filter(value => value !== ''),
      author: tokens[index + 2] ?? '',
      authorEmail: tokens[index + 3] ?? '',
      authorDate: tokens[index + 4] ?? '',
      decorations: tokens[index + 5] ?? '',
      subject: tokens[index + 6] ?? '',
      body: (tokens[index + 7] ?? '').replace(/\n+$/, ''),
    })
  }
  return commits
}

/** Per-commit change statistics derived from `git log --numstat`. */
export interface CommitStats {
  filesChanged: number
  additions: number
  deletions: number
  binaryFiles: number
}

/** A textual numstat line: `additions\tdeletions\tpath` (path may be empty for renames). */
const NUMSTAT_LINE = /^(\d+)\t(\d+)\t(.*)$/

/** A binary numstat line: `-\t-\tpath` (path may be empty for renames). */
const NUMSTAT_BINARY_LINE = /^-\t-\t(.*)$/

/**
 * Parse `git log -z --numstat --format=<SOH>%H` output into per-commit stats.
 *
 * The stream starts each commit with a `\x01<hash>` token, then carries one
 * numstat token per changed file. A rename/copy line with an empty path defers
 * its two paths to the following NUL tokens. Numeric and binary lines count one
 * changed file each; only numeric lines contribute additions/deletions. Blank
 * and unexpected tokens are ignored, so a malformed stream never throws.
 * @param text - raw stdout of the stats command.
 * @returns stats keyed by full commit hash.
 */
export function parseLogStatsZ(text: string): Map<string, CommitStats> {
  const stats = new Map<string, CommitStats>()
  if (text === '') return stats
  const tokens = text.split(NUL)
  let current: CommitStats | undefined
  let index = 0
  while (index < tokens.length) {
    const raw = tokens[index] ?? ''
    index += 1
    // git separates the format output from the first numstat line with a
    // newline, so the newline rides on the following token.
    const token = raw.replace(/^\n+/, '')
    if (token === '') continue
    if (token.startsWith(SOH)) {
      const hash = token.slice(1).replace(/^\n+/, '').trim()
      if (hash === '') {
        current = undefined
        continue
      }
      const existing = stats.get(hash)
      if (existing !== undefined) {
        current = existing
      } else {
        current = { filesChanged: 0, additions: 0, deletions: 0, binaryFiles: 0 }
        stats.set(hash, current)
      }
      continue
    }
    if (current === undefined) continue
    const numeric = NUMSTAT_LINE.exec(token)
    if (numeric !== null) {
      const additions = Number.parseInt(numeric[1] ?? '', 10)
      const deletions = Number.parseInt(numeric[2] ?? '', 10)
      current.filesChanged += 1
      current.additions += Number.isFinite(additions) ? additions : 0
      current.deletions += Number.isFinite(deletions) ? deletions : 0
      // An empty path means the rename/copy paths are the next two tokens.
      if ((numeric[3] ?? '') === '') index += 2
      continue
    }
    const binary = NUMSTAT_BINARY_LINE.exec(token)
    if (binary !== null) {
      current.filesChanged += 1
      current.binaryFiles += 1
      if ((binary[1] ?? '') === '') index += 2
      continue
    }
    // Unexpected token: the stream is untrusted, so ignore it instead of throwing.
  }
  return stats
}

/** Whether a git stderr means the repository has no commits yet. */
export function isEmptyRepositoryError(stderr: string): boolean {
  return /does not have any commits yet|bad revision|unknown revision|ambiguous argument 'HEAD'|your current branch .* does not have any commits/i.test(stderr)
}

/** The branch named by a decoration string, when one is decorated. */
export function branchFromDecoration(decorations: string): string | undefined {
  if (decorations === '') return undefined
  const head = /HEAD -> ([^,]+)/.exec(decorations)
  if (head !== null) return head[1]?.trim()
  for (const entry of decorations.split(',')) {
    const name = entry.trim()
    if (name === '' || name.startsWith('tag:') || name.includes('/')) continue
    return name
  }
  return undefined
}

/** Convert one parsed commit into a repository-history event. */
export function commitToEvent(commit: ParsedCommit, repositoryId: string, fallbackBranch?: string): VcsEvent {
  const timestamp = parseIsoTimestamp(commit.authorDate) ?? new Date(0).toISOString()
  const branch = branchFromDecoration(commit.decorations) ?? fallbackBranch
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `commit:${repositoryId}:${commit.hash}`,
    repositoryId,
    vcsType: 'git',
    eventType: 'commit',
    source: 'repository',
    timestamp,
    ...(commit.author === '' ? {} : { actor: commit.author }),
    summary: commit.subject,
    commitHash: commit.hash,
    ...(commit.parents.length === 0 ? {} : { parentHashes: commit.parents }),
    ...(branch === undefined ? {} : { branch }),
    changeSetId: `${repositoryId}:${commit.hash}`,
    metadata: {
      authorEmail: commit.authorEmail,
      parentCount: commit.parents.length,
      ...(commit.decorations === '' ? {} : { decorations: commit.decorations.slice(0, 500) }),
    },
  }
}

/** One name/status record. */
export interface NameStatusEntry {
  status: string
  path: string
  oldPath?: string
}

/** Parse `git show --name-status -z` output. */
export function parseNameStatusZ(text: string): NameStatusEntry[] {
  const tokens = text.split(NUL).filter(token => token !== '')
  const entries: NameStatusEntry[] = []
  let index = 0
  while (index < tokens.length) {
    const code = tokens[index] ?? ''
    index += 1
    if (code === '') continue
    const letter = code[0]?.toUpperCase() ?? '?'
    if (letter === 'R' || letter === 'C') {
      const oldPath = tokens[index] ?? ''
      const newPath = tokens[index + 1] ?? ''
      index += 2
      entries.push({ status: code, path: newPath, oldPath })
    } else {
      const path = tokens[index] ?? ''
      index += 1
      entries.push({ status: code, path })
    }
  }
  return entries
}

/** One numstat record. */
export interface NumstatEntry {
  path: string
  oldPath?: string
  additions?: number
  deletions?: number
  binary: boolean
}

/** Parse `git show --numstat -z` output. */
export function parseNumstatZ(text: string): NumstatEntry[] {
  const tokens = text.split(NUL)
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop()
  const entries: NumstatEntry[] = []
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index] ?? ''
    index += 1
    if (token === '') continue
    const parts = token.split('\t')
    if (parts.length < 3) continue
    const additionsRaw = parts[0] ?? ''
    const deletionsRaw = parts[1] ?? ''
    let path = parts[2] ?? ''
    let oldPath: string | undefined
    if (path === '') {
      // A rename/copy record defers both paths to the following NUL fields.
      oldPath = tokens[index]
      path = tokens[index + 1] ?? ''
      index += 2
    }
    const binary = additionsRaw === '-' || deletionsRaw === '-'
    entries.push({
      path,
      ...(oldPath === undefined ? {} : { oldPath }),
      ...(binary ? {} : { additions: Number.parseInt(additionsRaw, 10) || 0, deletions: Number.parseInt(deletionsRaw, 10) || 0 }),
      binary,
    })
  }
  return entries
}

/** Map a git status letter to a {@link ChangedFile} status. */
export function statusLetterToChangeStatus(code: string): ChangedFile['status'] {
  const letter = code[0]?.toUpperCase() ?? '?'
  switch (letter) {
    case 'A': return 'added'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'T': return 'type-changed'
    default: return 'unknown'
  }
}

/**
 * Merge name-status and numstat records into one changed-file list.
 * A rename keeps `oldPath`; a binary entry omits line counts.
 */
export function mergeChangedFiles(nameStatus: NameStatusEntry[], numstat: NumstatEntry[], maxFiles: number): { files: ChangedFile[]; truncated: boolean } {
  const stats = new Map<string, NumstatEntry>()
  for (const entry of numstat) {
    stats.set(`${entry.oldPath ?? ''}\u0000${entry.path}`, entry)
    if (!stats.has(`\u0000${entry.path}`)) stats.set(`\u0000${entry.path}`, entry)
  }
  const files: ChangedFile[] = []
  for (const entry of nameStatus) {
    const stat = stats.get(`${entry.oldPath ?? ''}\u0000${entry.path}`) ?? stats.get(`\u0000${entry.path}`)
    const status = statusLetterToChangeStatus(entry.status)
    files.push({
      path: entry.path,
      ...(entry.oldPath === undefined ? {} : { oldPath: entry.oldPath }),
      status,
      ...(stat?.binary === true ? { binary: true } : {}),
      ...(stat?.additions === undefined ? {} : { additions: stat.additions }),
      ...(stat?.deletions === undefined ? {} : { deletions: stat.deletions }),
    })
    if (files.length >= maxFiles) break
  }
  return { files, truncated: nameStatus.length > files.length }
}

/** Parse `git show -s --format=...` metadata for one commit. */
export function parseCommitMeta(text: string): { hash: string; parents: string[]; author: string; authorEmail: string; authorDate: string; commitDate: string; message: string } {
  const tokens = text.split(NUL)
  return {
    hash: tokens[0] ?? '',
    parents: (tokens[1] ?? '').split(' ').filter(value => value !== ''),
    author: tokens[2] ?? '',
    authorEmail: tokens[3] ?? '',
    authorDate: tokens[4] ?? '',
    commitDate: tokens[5] ?? '',
    message: tokens[6] ?? '',
  }
}

/** Build a change set from parsed git data. */
export function buildChangeSet(input: {
  repositoryId: string
  revision: string
  meta: ReturnType<typeof parseCommitMeta>
  nameStatus: NameStatusEntry[]
  numstat: NumstatEntry[]
  maxFiles: number
  now: string
}): ChangeSet {
  const merged = mergeChangedFiles(input.nameStatus, input.numstat, input.maxFiles)
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `${input.repositoryId}:${input.revision}`,
    repositoryId: input.repositoryId,
    vcsType: 'git',
    revision: input.revision,
    ...(input.meta.parents[0] === undefined ? {} : { parentRevision: input.meta.parents[0] }),
    createdAt: parseIsoTimestamp(input.meta.commitDate) ?? parseIsoTimestamp(input.meta.authorDate) ?? input.now,
    files: merged.files,
    ...(merged.truncated ? { truncated: true, truncationReason: `file list capped at ${input.maxFiles} entries` } : {}),
  }
}

/** A working-tree entry parsed from porcelain output. */
export interface ParsedStatus {
  branch?: string
  head?: string
  ahead: number
  behind: number
  entries: WorkingTreeEntry[]
  conflicts: string[]
  clean: boolean
  truncated: boolean
}

/** Parse porcelain v2 `-z` output. */
export function parseStatusV2(text: string, maxEntries = 2000): ParsedStatus {
  const tokens = text.split(NUL)
  const entries: WorkingTreeEntry[] = []
  const conflicts: string[] = []
  let branch: string | undefined
  let head: string | undefined
  let ahead = 0
  let behind = 0
  let truncated = false
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index] ?? ''
    index += 1
    if (token === '') continue
    if (token.startsWith('# ')) {
      const branchHead = /^# branch\.head (.+)$/.exec(token)
      if (branchHead !== null) branch = branchHead[1] === '(detached)' ? undefined : branchHead[1]
      const oid = /^# branch\.oid (.+)$/.exec(token)
      if (oid !== null && oid[1] !== '(initial)') head = oid[1]
      const ab = /^# branch\.ab \+(\d+) -(\d+)$/.exec(token)
      if (ab !== null) {
        ahead = Number.parseInt(ab[1] ?? '0', 10)
        behind = Number.parseInt(ab[2] ?? '0', 10)
      }
      continue
    }
    if (token.startsWith('1 ')) {
      const match = /^1 ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.+)$/.exec(token)
      if (match === null) continue
      if (entries.length >= maxEntries) { truncated = true; continue }
      const xy = match[1] ?? ''
      const path = normalizeRepoRelativePath(match[8] ?? '') ?? (match[8] ?? '')
      // A worktree-only change has "." in the index column; the letter the UI
      // shows must describe the change, so fall back to the worktree column.
      const contentStatus = xy[0] !== undefined && xy[0] !== '.' ? xy[0] : xy[1]
      entries.push({ path, status: contentStatus ?? '?', worktreeStatus: xy[1] ?? '?', staged: xy[0] !== '.' })
      continue
    }
    if (token.startsWith('2 ')) {
      const match = /^2 ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.+)$/.exec(token)
      const original = tokens[index]
      index += 1
      if (match === null) continue
      if (entries.length >= maxEntries) { truncated = true; continue }
      const xy = match[1] ?? ''
      const path = normalizeRepoRelativePath(match[9] ?? '') ?? (match[9] ?? '')
      void original
      entries.push({ path, status: xy[0] ?? 'R', worktreeStatus: xy[1] ?? 'R', staged: true })
      continue
    }
    if (token.startsWith('u ')) {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const match = /^u ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.+)$/.exec(token)
      if (match === null) continue
      const path = normalizeRepoRelativePath(match[10] ?? '') ?? (match[10] ?? '')
      conflicts.push(path)
      entries.push({ path, status: 'U', worktreeStatus: 'U' })
      continue
    }
    if (token.startsWith('? ')) {
      if (entries.length >= maxEntries) { truncated = true; continue }
      const path = normalizeRepoRelativePath(token.slice(2)) ?? token.slice(2)
      entries.push({ path, status: '?' })
      continue
    }
    if (token.startsWith('! ')) continue
  }
  const meaningful = entries.filter(entry => entry.status !== '?' || true)
  return {
    ...(branch === undefined ? {} : { branch }),
    ...(head === undefined ? {} : { head }),
    ahead,
    behind,
    entries,
    conflicts,
    clean: meaningful.filter(entry => entry.status !== '?').length === 0 && conflicts.length === 0,
    truncated,
  }
}

/** Parse porcelain v1 `-z` output as a fallback. */
export function parseStatusV1(text: string, maxEntries = 2000): ParsedStatus {
  const tokens = text.split(NUL).filter(token => token !== '')
  const entries: WorkingTreeEntry[] = []
  const conflicts: string[] = []
  let truncated = false
  for (const token of tokens) {
    if (token.length < 4) continue
    const xy = token.slice(0, 2)
    const path = normalizeRepoRelativePath(token.slice(3)) ?? token.slice(3)
    if (entries.length >= maxEntries) { truncated = true; continue }
    if (xy === 'UU' || xy === 'AA' || xy === 'DD' || xy === 'AU' || xy === 'UA' || xy === 'DU' || xy === 'UD') {
      conflicts.push(path)
    }
    entries.push({ path, status: xy[0] ?? '?', worktreeStatus: xy[1] ?? '?', staged: (xy[0] ?? ' ') !== ' ' })
  }
  return {
    ahead: 0,
    behind: 0,
    entries,
    conflicts,
    clean: entries.filter(entry => entry.status !== '?').length === 0 && conflicts.length === 0,
    truncated,
  }
}

/** Build a working-tree status record. */
export function buildStatus(repositoryId: string, parsed: ParsedStatus, warnings?: string[]): WorkingTreeStatus {
  return {
    repositoryId,
    vcsType: 'git',
    clean: parsed.clean && parsed.entries.length === 0,
    ...(parsed.branch === undefined ? {} : { branch: parsed.branch }),
    ...(parsed.head === undefined ? {} : { head: parsed.head }),
    entries: parsed.entries,
    conflicts: parsed.conflicts,
    ...(parsed.truncated ? { truncated: true } : {}),
    ...(warnings === undefined ? {} : { warnings }),
  }
}

/** Parse `git remote -v` into unique, credential-free URLs. */
export function parseRemotes(text: string): string[] {
  const urls = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^\S+\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim())
    if (match === null) continue
    const url = match[1] ?? ''
    if (url !== '') urls.add(redactUrl(url))
  }
  return [...urls]
}

/** Parse `git remote` into remote names. */
export function parseRemoteNames(text: string): string[] {
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
}

/** Build the repository record from its parts. */
export function buildRepository(input: {
  rootPath: string
  branch?: string
  head?: string
  remotes: string[]
  defaultBranch?: string
  now: string
}): Repository {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: '',
    vcsType: 'git',
    rootPath: input.rootPath,
    displayName: basename(input.rootPath),
    ...(input.remotes.length === 0 ? {} : { remoteUrls: input.remotes }),
    ...(input.defaultBranch === undefined ? {} : { defaultBranch: input.defaultBranch }),
    ...(input.branch === undefined ? {} : { currentBranch: input.branch }),
    ...(input.head === undefined ? {} : { currentRevision: input.head }),
    detectedAt: input.now,
    lastSeenAt: input.now,
  }
}

/** The commit whose diff a single-revision request describes. */
export function hasBinaryHeader(text: string): boolean {
  return /^Binary files .* differ$/m.test(text)
}

/** Whether a diff has no textual changes at all. */
export function isEmptyDiff(text: string): boolean {
  return text.trim() === ''
}
