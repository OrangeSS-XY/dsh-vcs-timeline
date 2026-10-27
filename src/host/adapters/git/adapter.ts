/**
 * Git adapter: every Git fact the plugin exposes, over the managed subprocess
 * service. No shell, no pager, no interactive prompt; argv arrays only.
 * @module dsh-vcs-timeline/host/adapters/git/adapter
 */

import { realpath } from 'node:fs/promises'
import type { ApiError, ChangeSet, DiffResult, Repository, WorkingTreeStatus } from '../../../shared/contracts.ts'
import { DEFAULT_PAGE_SIZE, HARD_DIFF_MAX_BYTES, MAX_PAGE_SIZE } from '../../../shared/contracts.ts'
import { clampInt, decodeCursor, encodeCursor, normalizeRepoRelativePath, repositoryId, safeErrorMessage, truncateUtf8 } from '../../security.ts'
import type {
  AdapterResult,
  AdapterDiffQuery,
  HistoryPage,
  HistoryQuery,
  OperationBeforeState,
  OperationParams,
  OperationPlan,
  OperationType,
  RunResult,
  Runner,
  VcsAdapter,
} from '../types.ts'
import {
  aheadBehindArgs,
  branchArgs,
  buildChangeSet,
  buildRepository,
  buildStatus,
  commitArgs,
  commitMetaArgs,
  commitNameStatusArgs,
  commitNumstatArgs,
  configDefaultBranchArgs,
  currentBranchArgs,
  detectArgs,
  fetchArgs,
  hasBinaryHeader,
  headArgs,
  isCommitHash,
  isSafeBranchName,
  isSafeRemoteName,
  isEmptyRepositoryError,
  logArgs,
  originHeadArgs,
  parseCommitMeta,
  parseLogOutput,
  parseNameStatusZ,
  parseNumstatZ,
  parseRemoteNames,
  parseRemotes,
  parseStatusV1,
  parseStatusV2,
  parseRemotes as parseRemotesForState,
  pullArgs,
  pushArgs,
  rangeDiffArgs,
  remoteArgs,
  remoteNamesArgs,
  showDiffArgs,
  stagedNamesArgs,
  statusArgs,
  statusV1Args,
  commitToEvent,
} from './commands.ts'

/** Default timeout for one read command. */
const READ_TIMEOUT_MS = 20_000
/** Timeout for a changeset (three git invocations). */
const CHANGESET_TIMEOUT_MS = 30_000
/** Timeout for a working-tree status probe. */
const STATUS_TIMEOUT_MS = 15_000
/** Collected output cap for reads. */
const READ_OUTPUT_CAP = 8 * 1024 * 1024
/** File-count cap for one changeset. */
export const MAX_CHANGED_FILES = 5_000
/** Entry cap for one status snapshot. */
export const MAX_STATUS_ENTRIES = 2_000

/** Build a stable adapter error. */
function failure(code: ApiError['code'], message: string, detail?: string): AdapterResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(detail === undefined ? {} : { detail: detail.slice(0, 500) }),
    },
  }
}

/** Map a failed run to an adapter error. */
function runFailure(result: RunResult, what: string): AdapterResult<never> {
  if (result.spawnFailed === true) {
    return failure('vcs-not-installed', 'git is not available on this machine', safeErrorMessage(result.failureMessage ?? 'spawn failed'))
  }
  if (result.timedOut === true) {
    return failure('timeout', `${what} timed out`, safeErrorMessage(result.stderr, 300))
  }
  const stderr = safeErrorMessage(result.stderr.trim() === '' ? 'git exited with an error' : result.stderr, 500)
  return failure('operation-failed', `${what} failed`, stderr)
}

/** Trim a single-line command output. */
function firstLine(text: string): string {
  return (text.split(/\r?\n/)[0] ?? '').trim()
}

/** Split NUL-separated output. */
function nulTokens(text: string): string[] {
  return text.split('\u0000').filter(token => token !== '')
}

/** Warnings shared by the write-operation plans. */
function stateWarnings(before: OperationBeforeState): string[] {
  const warnings: string[] = []
  if (before.clean === false) warnings.push('the working tree has uncommitted changes')
  if (before.branch === undefined) warnings.push('HEAD is detached; no branch is checked out')
  if ((before.remoteUrls ?? []).length === 0) warnings.push('this repository has no configured remote')
  if (typeof before.behind === 'number' && before.behind > 0) warnings.push(`the branch is ${before.behind} commit(s) behind its upstream`)
  if (typeof before.ahead === 'number' && before.ahead > 0) warnings.push(`the branch is ${before.ahead} commit(s) ahead of its upstream`)
  return warnings
}

/**
 * Create the Git adapter.
 * @param runner - managed subprocess seam.
 * @returns the adapter.
 */
export function createGitAdapter(runner: Runner): VcsAdapter {
  const run = async (
    argv: string[],
    cwd: string,
    signal: AbortSignal | undefined,
    timeoutMs: number,
    maxBytes = READ_OUTPUT_CAP,
  ): Promise<RunResult> => runner.run(argv, cwd, { ...(signal === undefined ? {} : { signal }), timeoutMs, maxBytes })

  const adapter: VcsAdapter = {
    vcsType: 'git',

    async detect(path) {
      const result = await run(detectArgs(path), process.cwd(), undefined, 10_000, 64 * 1024)
      if (result.spawnFailed === true) return runFailure(result, 'git detection')
      if (result.exitCode !== 0) return { ok: true, value: null }
      const rootPath = firstLine(result.stdout)
      if (rootPath === '') return { ok: true, value: null }
      // Git prints forward slashes; the registry compares canonical paths, so
      // resolve the real path here.
      let canonical = rootPath
      try {
        canonical = await realpath(rootPath)
      } catch {
        canonical = rootPath
      }
      return { ok: true, value: { rootPath: canonical } }
    },

    async info(root, signal) {
      const [branch, head, remotes, originHead, defaultBranchConfig] = await Promise.all([
        run(branchArgs(), root, signal, READ_TIMEOUT_MS, 64 * 1024),
        run(headArgs(), root, signal, READ_TIMEOUT_MS, 64 * 1024),
        run(remoteArgs(), root, signal, READ_TIMEOUT_MS, 256 * 1024),
        run(originHeadArgs(), root, signal, READ_TIMEOUT_MS, 64 * 1024),
        run(configDefaultBranchArgs(), root, signal, READ_TIMEOUT_MS, 64 * 1024),
      ])
      if (branch.spawnFailed === true && head.spawnFailed === true) {
        return runFailure(head, 'reading repository information')
      }
      const branchName = branch.exitCode === 0 ? firstLine(branch.stdout) : ''
      const headHash = head.exitCode === 0 ? firstLine(head.stdout) : ''
      const remoteUrls = remotes.exitCode === 0 ? parseRemotes(remotes.stdout) : []
      let defaultBranch: string | undefined
      if (originHead.exitCode === 0) {
        const match = /refs\/remotes\/[^/]+\/(.+)$/.exec(firstLine(originHead.stdout))
        if (match !== null) defaultBranch = match[1]
      }
      if (defaultBranch === undefined && defaultBranchConfig.exitCode === 0) {
        const configured = firstLine(defaultBranchConfig.stdout)
        if (configured !== '') defaultBranch = configured
      }
      const now = new Date().toISOString()
      const repository: Repository = buildRepository({
        rootPath: root,
        ...(branchName === '' || branchName === 'HEAD' ? {} : { branch: branchName }),
        ...(headHash === '' ? {} : { head: headHash }),
        remotes: remoteUrls,
        ...(defaultBranch === undefined ? {} : { defaultBranch }),
        now,
      })
      return { ok: true, value: { ...repository, id: repositoryId('git', root) } }
    },

    async history(root, repositoryIdValue, query: HistoryQuery, signal): Promise<AdapterResult<HistoryPage>> {
      const limit = clampInt(query.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)
      const cursor = decodeCursor(query.cursor ?? null)
      const offset = cursor !== null && typeof cursor.o === 'number' && cursor.o >= 0 ? Math.trunc(cursor.o) : 0
      const argv = logArgs({
        skip: offset,
        limit: limit + 1,
        ...(query.author === undefined ? {} : { author: query.author }),
        ...(query.text === undefined ? {} : { text: query.text }),
        ...(query.since === undefined ? {} : { since: query.since }),
        ...(query.until === undefined ? {} : { until: query.until }),
      })
      const result = await run(argv, root, signal, READ_TIMEOUT_MS)
      if (result.exitCode !== 0) {
        if (isEmptyRepositoryError(result.stderr)) {
          return { ok: true, value: { events: [], nextCursor: null, hasMore: false, warnings: ['this repository has no commits yet'] } }
        }
        return runFailure(result, 'reading git history')
      }
      const parsed = parseLogOutput(result.stdout)
      const hasMore = parsed.length > limit
      const page = hasMore ? parsed.slice(0, limit) : parsed
      const events = page.map(commit => commitToEvent(commit, repositoryIdValue))
      const nextCursor = hasMore ? encodeCursor({ o: offset + limit }) : null
      return {
        ok: true,
        value: {
          events,
          nextCursor,
          hasMore,
          ...(parsed.length === 0 && offset === 0 ? {} : {}),
        },
      }
    },

    async changeSet(root, repositoryIdValue, revision, signal): Promise<AdapterResult<ChangeSet>> {
      if (!isCommitHash(revision)) {
        return failure('invalid-request', 'a full commit hash is required')
      }
      const collect = async (argv: string[], timeout: number) => run(argv, root, signal, timeout)
      const metaResult = await collect(commitMetaArgs(revision), CHANGESET_TIMEOUT_MS)
      if (metaResult.exitCode !== 0) return runFailure(metaResult, 'reading commit metadata')
      const [namesResult, numstatResult] = await Promise.all([
        collect(commitNameStatusArgs(revision), CHANGESET_TIMEOUT_MS),
        collect(commitNumstatArgs(revision), CHANGESET_TIMEOUT_MS),
      ])
      if (namesResult.exitCode !== 0) return runFailure(namesResult, 'reading changed files')
      const meta = parseCommitMeta(metaResult.stdout)
      const changeSet = buildChangeSet({
        repositoryId: repositoryIdValue,
        revision,
        meta,
        nameStatus: parseNameStatusZ(namesResult.stdout),
        numstat: numstatResult.exitCode === 0 ? parseNumstatZ(numstatResult.stdout) : [],
        maxFiles: MAX_CHANGED_FILES,
        now: new Date().toISOString(),
      })
      return { ok: true, value: changeSet }
    },

    async diff(root, repositoryIdValue, query: AdapterDiffQuery, signal): Promise<AdapterResult<DiffResult>> {
      const revisionA = query.revisionA ?? (query.revisionB === undefined ? undefined : undefined)
      const revisionB = query.revisionB
      const older = query.revisionA
      for (const candidate of [older, revisionB]) {
        if (candidate !== undefined && !isCommitHash(candidate)) {
          return failure('invalid-request', 'a commit hash is required for a diff')
        }
      }
      if (older === undefined && revisionB === undefined) {
        return failure('invalid-request', 'a commit hash or a revision range is required')
      }
      let filePath: string | undefined
      if (query.filePath !== undefined && query.filePath !== '') {
        const normalized = normalizeRepoRelativePath(query.filePath)
        if (normalized === null) return failure('invalid-request', 'the file path must stay inside the repository')
        filePath = normalized
      }
      const contextLines = clampInt(query.contextLines, 0, 32, 3)
      const argv = older !== undefined && revisionB !== undefined
        ? rangeDiffArgs(older, revisionB, contextLines, filePath)
        : showDiffArgs(revisionB as string, contextLines, filePath)
      const maxBytes = clampInt(query.maxBytes, 1_024, HARD_DIFF_MAX_BYTES, 256 * 1024)
      const result = await run(argv, root, signal, CHANGESET_TIMEOUT_MS, Math.min(HARD_DIFF_MAX_BYTES * 2, Math.max(maxBytes * 2, 1 << 20)))
      if (result.exitCode !== 0) return runFailure(result, 'reading a diff')
      void revisionA
      const binary = hasBinaryHeader(result.stdout)
      if (binary) {
        return {
          ok: true,
          value: {
            repositoryId: repositoryIdValue,
            revisionA: older ?? null,
            revisionB: revisionB ?? null,
            ...(filePath === undefined ? {} : { filePath }),
            text: '',
            truncated: false,
            binary: true,
            bytes: 0,
          },
        }
      }
      const capped = truncateUtf8(result.stdout, maxBytes)
      return {
        ok: true,
        value: {
          repositoryId: repositoryIdValue,
          revisionA: older ?? null,
          revisionB: revisionB ?? null,
          ...(filePath === undefined ? {} : { filePath }),
          text: capped.text,
          truncated: capped.truncated,
          ...(capped.truncated ? { truncationReason: `diff capped at ${maxBytes} bytes` } : {}),
          binary: false,
          bytes: Buffer.byteLength(capped.text, 'utf8'),
        },
      }
    },

    async status(root, repositoryIdValue, signal): Promise<AdapterResult<WorkingTreeStatus>> {
      const result = await run(statusArgs(), root, signal, STATUS_TIMEOUT_MS, 4 * 1024 * 1024)
      if (result.exitCode !== 0) {
        const fallback = await run(statusV1Args(), root, signal, STATUS_TIMEOUT_MS, 4 * 1024 * 1024)
        if (fallback.exitCode !== 0) return runFailure(result, 'reading working-tree status')
        const parsedV1 = parseStatusV1(fallback.stdout, MAX_STATUS_ENTRIES)
        return { ok: true, value: buildStatus(repositoryIdValue, parsedV1) }
      }
      const parsed = parseStatusV2(result.stdout, MAX_STATUS_ENTRIES)
      return { ok: true, value: buildStatus(repositoryIdValue, parsed) }
    },

    async beforeState(root, _operation, signal): Promise<AdapterResult<OperationBeforeState>> {
      const [branch, head, status, staged, remotes, aheadBehind] = await Promise.all([
        run(currentBranchArgs(), root, signal, READ_TIMEOUT_MS, 64 * 1024),
        run(headArgs(), root, signal, READ_TIMEOUT_MS, 64 * 1024),
        run(statusArgs(), root, signal, STATUS_TIMEOUT_MS, 4 * 1024 * 1024),
        run(stagedNamesArgs(), root, signal, STATUS_TIMEOUT_MS, 512 * 1024),
        run(remoteArgs(), root, signal, READ_TIMEOUT_MS, 256 * 1024),
        run(aheadBehindArgs(), root, signal, READ_TIMEOUT_MS, 64 * 1024),
      ])
      const state: OperationBeforeState = {}
      const branchName = branch.exitCode === 0 ? firstLine(branch.stdout) : ''
      if (branchName !== '') state.branch = branchName
      const headHash = head.exitCode === 0 ? firstLine(head.stdout) : ''
      if (headHash !== '') {
        state.head = headHash
        state.revision = headHash
      }
      if (status.exitCode === 0) {
        const parsed = parseStatusV2(status.stdout, MAX_STATUS_ENTRIES)
        state.clean = parsed.clean && parsed.entries.length === 0
      }
      if (staged.exitCode === 0) {
        state.stagedFiles = nulTokens(staged.stdout).map(path => normalizeRepoRelativePath(path) ?? path).slice(0, 500)
      }
      if (remotes.exitCode === 0) {
        state.remoteUrls = parseRemotesForState(remotes.stdout)
      }
      if (aheadBehind.exitCode === 0) {
        const parts = firstLine(aheadBehind.stdout).split(/\s+/)
        const behind = Number.parseInt(parts[0] ?? '', 10)
        const ahead = Number.parseInt(parts[1] ?? '', 10)
        if (Number.isFinite(behind)) state.behind = behind
        if (Number.isFinite(ahead)) state.ahead = ahead
      }
      return { ok: true, value: state }
    },

    async planOperation(root, operation: OperationType, params: OperationParams, before): Promise<AdapterResult<OperationPlan>> {
      const executable = await runner.resolveExecutable('git')
      if (executable === null) {
        return failure('vcs-not-installed', 'git is not available on this machine')
      }
      const warnings = stateWarnings(before)
      const blocked = (blockedReason: string): OperationPlan => ({
        allowed: false,
        blockedReason,
        argv: [],
        cwd: root,
        summary: `${operation} blocked`,
        warnings,
        network: operation !== 'commit',
      })

      switch (operation) {
        case 'fetch': {
          return {
            ok: true,
            value: {
              allowed: true,
              argv: fetchArgs(),
              cwd: root,
              summary: 'fetch new commits and objects from the default remote',
              warnings,
              network: true,
            },
          }
        }
        case 'pull': {
          if (before.clean === false) return { ok: true, value: blocked('the working tree has uncommitted changes; commit or discard them first') }
          if ((before.remoteUrls ?? []).length === 0) return { ok: true, value: blocked('this repository has no configured remote') }
          if (before.ahead === undefined && before.behind === undefined) {
            return { ok: true, value: blocked('the current branch has no upstream; set one before pulling') }
          }
          return {
            ok: true,
            value: {
              allowed: true,
              argv: pullArgs(),
              cwd: root,
              summary: 'pull from the upstream with fast-forward only (no merge commit, no rebase)',
              warnings,
              network: true,
            },
          }
        }
        case 'commit': {
          const message = typeof params.message === 'string' ? params.message : ''
          if (message.trim() === '') return { ok: true, value: blocked('a commit message is required') }
          if (message.length > 4000) return { ok: true, value: blocked('the commit message is longer than 4000 characters') }
          if ((before.stagedFiles ?? []).length === 0) return { ok: true, value: blocked('nothing is staged; stage changes first (this plugin never stages files for you)') }
          return {
            ok: true,
            value: {
              allowed: true,
              argv: commitArgs(message),
              cwd: root,
              summary: `commit ${before.stagedFiles?.length ?? 0} staged path(s) on ${before.branch ?? 'the current branch'}`,
              warnings,
              network: false,
            },
          }
        }
        case 'push': {
          if (before.branch === undefined) return { ok: true, value: blocked('HEAD is detached; check out a branch before pushing') }
          if ((before.remoteUrls ?? []).length === 0) return { ok: true, value: blocked('this repository has no configured remote') }
          const remotes = await run(remoteNamesArgs(), root, undefined, READ_TIMEOUT_MS, 64 * 1024)
          const names = remotes.exitCode === 0 ? parseRemoteNames(remotes.stdout) : []
          const remote = typeof params.remote === 'string' && params.remote !== '' ? params.remote : (names.includes('origin') ? 'origin' : names[0])
          if (remote === undefined || remote === '') return { ok: true, value: blocked('this repository has no configured remote') }
          if (!names.includes(remote)) return { ok: true, value: blocked(`unknown remote "${remote}"`) }
          const branch = typeof params.branch === 'string' && params.branch !== '' ? params.branch : before.branch
          if (!isSafeRemoteName(remote)) return { ok: true, value: blocked('the remote name contains unsupported characters') }
          if (!isSafeBranchName(branch)) return { ok: true, value: blocked('the branch name contains unsupported characters') }
          // v1 pushes only the checked-out branch: pushing an arbitrary branch
          // name would let the client name a ref this plugin never validated.
          if (branch !== before.branch) {
            return { ok: true, value: blocked(`only the current branch (${before.branch}) can be pushed in this version`) }
          }
          return {
            ok: true,
            value: {
              allowed: true,
              argv: pushArgs(remote, branch),
              cwd: root,
              summary: `push ${branch} to ${remote}`,
              warnings,
              network: true,
            },
          }
        }
        default:
          return {
            ok: true,
            value: blocked(`the ${operation} operation is not implemented by this plugin version`),
          }
      }
    },
  }

  return adapter
}
