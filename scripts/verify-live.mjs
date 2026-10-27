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
