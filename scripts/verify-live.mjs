/**
 * Live verification against a running DSH desktop host.
 *
 * Creates a throwaway Git repository under the OS temp directory, drives the
 * plugin's `/vcs` routes over HTTP (the same routes the sidebar panel calls),
 * performs one audited commit on that throwaway repository, and removes it.
 * The user's repositories are never touched.
 *
 * Usage: node scripts/verify-live.mjs [baseUrl]
 * @module scripts/verify-live
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const baseUrl = (process.argv[2] ?? 'http://127.0.0.1:12050').replace(/\/+$/, '')
const results = []

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
}

async function postRaw(path, body) {
  const response = await fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return response.json()
}

async function post(path, body) {
  const envelope = await postRaw(path, body)
  if (envelope.ok !== true) {
    throw new Error(`${path}: ${envelope.error?.code ?? 'error'} ${envelope.error?.message ?? ''} ${envelope.error?.detail ?? ''}`.trim())
  }
  return envelope.value
}

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return stdout
}

const repoDir = await mkdtemp(join(tmpdir(), 'dvt-live-'))
let repositoryId
try {
  // --- fixture: a throwaway repository with two commits and staged work -----
  await git(repoDir, 'init', '-b', 'main', '-q')
  await git(repoDir, 'config', 'user.name', 'DSH Verify')
  await git(repoDir, 'config', 'user.email', 'verify@example.com')
  await writeFile(join(repoDir, 'a.txt'), 'one\ntwo\n')
  await git(repoDir, 'add', '-A')
  await git(repoDir, 'commit', '-q', '-m', 'first: initial commit')
  await writeFile(join(repoDir, 'a.txt'), 'one\nthree\n')
  await git(repoDir, 'add', '-A')
  await git(repoDir, 'commit', '-q', '-m', 'second: change a.txt')
  await writeFile(join(repoDir, 'a.txt'), 'one\nthree\nfour\n')
  await git(repoDir, 'add', 'a.txt')

  // --- diagnostics ---------------------------------------------------------
  const diagnostics = await post('vcs/diagnostics', {})
  record('diagnostics', typeof diagnostics.pluginVersion === 'string' && diagnostics.pluginVersion !== '',
    `plugin=${diagnostics.pluginVersion} git=${diagnostics.gitVersion ?? 'missing'} svn=${diagnostics.svnVersion ?? 'missing'} dataDir=${diagnostics.dataDir}`)

  // --- add the throwaway repository ---------------------------------------
  const repository = await post('vcs/repos/add', { path: repoDir })
  repositoryId = repository.id
  record('repos/add', repository.vcsType === 'git' && repository.currentBranch === 'main',
    `${repository.displayName} branch=${repository.currentBranch} rev=${String(repository.currentRevision).slice(0, 8)}`)

  // --- repository list includes it ----------------------------------------
  const list = await post('vcs/repos/list', { workspacePath: null })
  const listed = list.repositories.find(entry => entry.id === repositoryId)
  record('repos/list', listed !== undefined, `${list.repositories.length} repositories, diagnostics.gitVersion=${list.diagnostics.gitVersion ?? 'missing'}`)

  // --- timeline ------------------------------------------------------------
  const timeline = await post('vcs/timeline', { repositoryId, limit: 10 })
  record('timeline', timeline.events.length === 2 && timeline.events[0].summary === 'second: change a.txt',
    `${timeline.events.length} events, newest="${timeline.events[0]?.summary ?? ''}"`)

  const head = timeline.events[0].commitHash
  const headStats = timeline.events[0].metadata ?? {}
  record('timeline carries real commit stats',
    typeof headStats.filesChanged === 'number' && typeof headStats.additions === 'number' && typeof headStats.deletions === 'number',
    `files=${String(headStats.filesChanged)} +${String(headStats.additions)} -${String(headStats.deletions)}`)
  const changeset = await post('vcs/changeset', { repositoryId, revision: head })
  record('changeset', changeset.files.length === 1 && changeset.files[0].path === 'a.txt',
    JSON.stringify(changeset.files.map(file => `${file.status}:${file.path}`)))

  const diff = await post('vcs/diff', { repositoryId, revisionB: head, filePath: 'a.txt', maxBytes: 262144 })
  record('diff', diff.binary === false && diff.text.includes('+three'),
    `${diff.bytes} bytes, truncated=${diff.truncated}`)

  const status = await post('vcs/status', { repositoryId })
  const staged = status.entries.filter(entry => entry.staged === true)
  record('status', status.clean === false && staged.length === 1,
    `clean=${status.clean} entries=${status.entries.length} staged=${staged.length}`)

  // --- unsupported and blocked operations are refused ---------------------
  const merge = await postRaw('vcs/op/preview', { repositoryId, operation: 'merge', params: {} })
  record('op/preview refuses merge', merge.ok === false && merge.error.code === 'invalid-request',
    merge.ok === false ? `${merge.error.code}: ${merge.error.message}` : 'unexpectedly allowed')

  const blockedCommit = await postRaw('vcs/op/preview', { repositoryId, operation: 'commit', params: {} })
  record('op/preview blocks empty commit message',
    blockedCommit.ok === true && blockedCommit.value.allowed === false && typeof blockedCommit.value.blockedReason === 'string',
    blockedCommit.ok === true ? String(blockedCommit.value.blockedReason) : `${blockedCommit.error.code}`)

  // --- preview + execute one audited commit -------------------------------
  const preview = await post('vcs/op/preview', { repositoryId, operation: 'commit', params: { message: 'live verification commit' } })
  record('op/preview commit', preview.allowed === true && typeof preview.confirmationToken === 'string' && preview.confirmationToken.length > 10,
    preview.argv.join(' '))

  const attempt = await post('vcs/op/execute', {
    repositoryId,
    operation: 'commit',
    params: { message: 'live verification commit' },
    confirmationToken: preview.confirmationToken,
  })
  record('op/execute commit', attempt.state === 'succeeded' && attempt.exitCode === 0,
    `${attempt.id} state=${attempt.state} exit=${attempt.exitCode} before=${String(attempt.beforeRevision).slice(0, 8)} after=${String(attempt.afterRevision).slice(0, 8)}`)

  // --- the commit is a repository fact now --------------------------------
  const after = await post('vcs/timeline', { repositoryId, limit: 10 })
  record('timeline sees the new commit', after.events.length === 3 && after.events[0].summary === 'live verification commit',
    `now ${after.events.length} events`)

  // --- audit folds the attempt --------------------------------------------
  const operations = await post('vcs/op/list', { repositoryId, limit: 20 })
  const auditRow = operations.operations.find(entry => entry.id === attempt.id)
  record('op/list audit fold', auditRow !== undefined && auditRow.state === 'succeeded',
    `${operations.operations.length} folded attempt(s), correlationId=${auditRow?.correlationId ?? 'n/a'}`)

  // --- plugin-audit events are persisted separately from history ----------
  const blockedSecondExecute = await fetch(`${baseUrl}/vcs/op/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repositoryId, operation: 'commit', params: { message: 'x' }, confirmationToken: preview.confirmationToken }),
  })
  const blockedBody = await blockedSecondExecute.json()
  record('single-use confirmation token', blockedBody.ok === false && blockedBody.error.code === 'confirmation-invalid',
    blockedBody.error?.code ?? '')

  // --- v1.1: working tree diff, checks, hotspots, session attribution ------
  await writeFile(join(repoDir, 'a.txt'), 'one\nthree\nfour\nfive\n')
  await writeFile(join(repoDir, 'untracked.txt'), 'brand new\n')
  const worktreeDiff = await post('vcs/worktree/diff', { repositoryId, filePath: 'a.txt' })
  record('v1.1 worktree/diff (tracked unstaged)',
    worktreeDiff.kind === 'tracked' && worktreeDiff.text.includes('+five'), worktreeDiff.kind)
  const untrackedDiff = await post('vcs/worktree/diff', { repositoryId, filePath: 'untracked.txt' })
  record('v1.1 worktree/diff (untracked whole file)',
    untrackedDiff.kind === 'untracked' && untrackedDiff.text.includes('+brand new'), untrackedDiff.kind)
  const checks = await post('vcs/checks', { repositoryId })
  record('v1.1 checks',
    checks.scope === 'worktree' && Array.isArray(checks.findings)
      && checks.findings.some(finding => finding.rule === 'untracked-skipped'),
    `${checks.filesChecked} file(s), ${checks.findings.length} finding(s)`)
  const hotspots = await post('vcs/stats/hotspots', { repositoryId })
  record('v1.1 stats/hotspots',
    hotspots.available === true && hotspots.scannedCommits >= 1 && hotspots.scope.branch === 'main',
    `${hotspots.files.length} file(s), scanned=${hotspots.scannedCommits}, window=${hotspots.scope.windowCommits}`)
  record('v1.2 stats/hotspots daily chart buckets',
    Array.isArray(hotspots.daily) && hotspots.daily.length >= 1
      && hotspots.daily.reduce((sum, day) => sum + day.commits, 0) === hotspots.scannedCommits,
    `${hotspots.daily?.length ?? 0} day(s)`)
  const sessionChanges = await post('vcs/session/changes', { repositoryId, sessionId: 'verify-not-live' })
  record('v1.1 session/changes refuses a non-live session',
    sessionChanges.available === false, sessionChanges.warnings?.[0] ?? '')
  const allBranches = await post('vcs/timeline', { repositoryId, limit: 10, branchScope: 'all' })
  record('v1.1 branchScope=all', allBranches.events.length >= 3, `${allBranches.events.length} events`)

  // --- v1.2: explicit staging keeps commit usable --------------------------
  const stagePreview = await post('vcs/op/preview', { repositoryId, operation: 'stage', params: {} })
  record('v1.2 stage preview', stagePreview.allowed === true && stagePreview.argv.join(' ').includes(' add '),
    stagePreview.argv.join(' '))
  const stagedAttempt = await post('vcs/op/execute', {
    repositoryId,
    operation: 'stage',
    params: {},
    confirmationToken: stagePreview.confirmationToken,
  })
  record('v1.2 stage executes and is audited', stagedAttempt.state === 'succeeded' && stagedAttempt.exitCode === 0,
    `state=${stagedAttempt.state}`)
  const stagedStatus = await post('vcs/status', { repositoryId })
  record('v1.2 staged entries appear after stage', stagedStatus.entries.some(entry => entry.staged === true))
  const unstagePreview = await post('vcs/op/preview', { repositoryId, operation: 'unstage', params: {} })
  const unstagedAttempt = await post('vcs/op/execute', {
    repositoryId,
    operation: 'unstage',
    params: {},
    confirmationToken: unstagePreview.confirmationToken,
  })
  record('v1.2 unstage executes and clears the index',
    unstagedAttempt.state === 'succeeded' && (await post('vcs/status', { repositoryId })).entries.every(entry => entry.staged !== true),
    `state=${unstagedAttempt.state}`)

  // --- transport hardening ------------------------------------------------
  const badContentType = await fetch(`${baseUrl}/vcs/status`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ repositoryId }),
  })
  record('rejects non-JSON content type', badContentType.status === 415, `HTTP ${badContentType.status}`)

  const unknownRoute = await fetch(`${baseUrl}/vcs/does-not-exist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
  record('unknown route is 404', unknownRoute.status === 404, `HTTP ${unknownRoute.status}`)
} catch (error) {
  record('live verification aborted', false, error instanceof Error ? error.message : String(error))
} finally {
  await rm(repoDir, { recursive: true, force: true, maxRetries: 3 })
}

const failed = results.filter(entry => !entry.ok).length
console.log(`\n${results.length - failed}/${results.length} live checks passed`)
process.exit(failed === 0 ? 0 : 1)
