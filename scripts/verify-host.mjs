/**
 * Built-artifact acceptance: mount `lib/index.js` in a fake Cordis host over a
 * throwaway Git repository and drive the real `/vcs` route family.
 *
 * This verifies the bundle and the route wiring without restarting the running
 * DSH desktop app. The fake host provides only the services the plugin injects
 * (`webServer`, `subprocess`, `workspaceRegistry`, `sessions`), and the
 * subprocess seam really spawns git (argv arrays only).
 *
 * Usage: node scripts/verify-host.mjs
 * @module scripts/verify-host
 */

import { execFile, spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const results = []

function record(name, ok, detail) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  — ${detail}`}`)
}

/** A real subprocess runner with the plugin's argv-only contract. */
const subprocess = {
  async resolveExecutable(command) {
    if (command === 'git') return 'git'
    if (command === 'svn') return null
    return null
  },
  /**
   * The plugin's runner spawns through this handle shape: `done` plus bounded
   * collected streams. It really spawns the executable (no shell).
   */
  spawn(spec) {
    const stdout = []
    const stderr = []
    const child = spawn(spec.argv[0], spec.argv.slice(1), {
      cwd: spec.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
    const done = new Promise((resolve) => {
      child.on('error', () => resolve({ exitCode: null }))
      child.on('close', code => resolve({ exitCode: code }))
      spec.signal?.addEventListener('abort', () => child.kill(), { once: true })
    })
    const read = chunks => ({
      readFrom() {
        const text = Buffer.concat(chunks).toString('utf8')
        const cap = spec.stdio.stdout.maxBytes
        return { text: text.length > cap ? text.slice(0, cap) : text }
      },
    })
    return {
      done,
      collected: { stdout: read(stdout), stderr: read(stderr) },
    }
  },
  async run(argv, cwd, options = {}) {
    // Kept for probes that use the simpler seam; same argv-only behaviour.
    let workdir = cwd
    try {
      if (typeof workdir !== 'string' || workdir === '' || !statSync(workdir).isDirectory()) workdir = process.cwd()
    } catch {
      workdir = process.cwd()
    }
    try {
      const { stdout, stderr } = await execFileAsync(argv[0], argv.slice(1), {
        cwd: workdir,
        encoding: 'utf8',
        timeout: options.timeoutMs ?? 20_000,
        maxBuffer: options.maxBytes ?? 8 * 1024 * 1024,
        windowsHide: true,
      })
      return { exitCode: 0, stdout, stderr }
    } catch (error) {
      return {
        exitCode: typeof error.code === 'number' ? error.code : 1,
        stdout: typeof error.stdout === 'string' ? error.stdout : '',
        stderr: typeof error.stderr === 'string' ? error.stderr : String(error.message ?? ''),
        ...(error.killed === true ? { timedOut: true } : {}),
      }
    }
  },
}

/** Build the fake host context and mount the plugin. */
async function mount(dataDir, workspacePath, session) {
  const registered = []
  const ctx = {
    logger: { warn() {}, info() {}, debug() {}, error() {} },
    effect(fn) {
      return fn()
    },
    webServer: {
      register(spec) {
        registered.push(spec)
        return () => {}
      },
    },
    subprocess,
    workspaceRegistry: {
      list() {
        return [{ id: 'workspace-1', path: workspacePath }]
      },
    },
    sessions: {
      get(id) {
        return id === 'session-live' ? session : undefined
      },
      list() {
        return session === undefined ? [] : [session]
      },
    },
  }
  // The plugin reaches the session store through the Cordis lookup first; keep
  // both shapes so the probe covers that path as well as the property fallback.
  ctx.get = function get(name) {
    return this[name]
  }
  const plugin = await import('../lib/index.js')
  plugin.apply(ctx, { dataDir })
  const route = registered.find(spec => spec.path === '/vcs')
  if (route === undefined) throw new Error('the plugin did not register /vcs')
  return route.handler
}

/** POST one JSON body through the mounted route handler. */
async function post(handler, pathname, body) {
  const payload = Buffer.from(JSON.stringify(body ?? {}))
  const req = Object.assign(Readable.from([payload]), {
    method: 'POST',
    url: pathname,
    headers: { 'content-type': 'application/json', host: '127.0.0.1:2826' },
    socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' },
  })
  const chunks = []
  const res = {
    status: 0,
    writeHead(status) {
      this.status = status
      return this
    },
    end(chunk) {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk))
    },
  }
  await handler(req, res)
  const text = Buffer.concat(chunks).toString('utf8')
  const envelope = text === '' ? null : JSON.parse(text)
  if (envelope === null || envelope.ok !== true) {
    throw new Error(`${pathname}: ${envelope?.error?.code ?? res.status} ${envelope?.error?.message ?? ''}`)
  }
  return envelope.value
}

/** A fake live session with one successful `write` tool call. */
function makeSession(cwd) {
  return {
    header: { cwd },
    snapshotEvents() {
      return [
        { type: 'tool/call', time: Date.now(), data: { name: 'write', callId: 'c1', arguments: JSON.stringify({ file_path: 'src/agent.ts' }) } },
        { type: 'tool/result', data: { message: { toolCallId: 'c1', isError: false } } },
      ]
    },
  }
}

const root = await mkdtemp(join(tmpdir(), 'dvt-host-'))
const repoDir = join(root, 'repo')
const dataDir = join(root, 'data')
let passed = 0

try {
  // --- fixture: a repository with a commit, staged/unstaged/untracked work ---
  const git = (...args) => execFileAsync('git', args, { cwd: repoDir, windowsHide: true, encoding: 'utf8' })
  await execFileAsync('git', ['init', '-b', 'main', '-q', repoDir], { windowsHide: true })
  await git('config', 'user.name', 'DSH Verify')
  await git('config', 'user.email', 'verify@example.com')
  await writeFile(join(repoDir, 'README.md'), 'one\ntwo\n')
  await writeFile(join(repoDir, 'package-lock.json'), '{"lockfileVersion": 2}\n')
  await git('add', '-A')
  await git('commit', '-q', '-m', 'first: initial commit')
  await writeFile(join(repoDir, 'README.md'), 'one\nthree\n')
  await writeFile(join(repoDir, 'staged.ts'), 'export const a = 1\n')
  await git('add', 'staged.ts')
  await writeFile(join(repoDir, 'untracked.txt'), 'new file\n')
  await writeFile(join(repoDir, 'package-lock.json'), '{"lockfileVersion": 3}\n')
  await mkdir(join(repoDir, 'src'), { recursive: true })
  await writeFile(join(repoDir, 'src', 'agent.ts'), 'export const agent = 1\n')
  const handler = await mount(dataDir, repoDir, makeSession(repoDir))

  // --- repository discovery -------------------------------------------------
  const list = await post(handler, '/vcs/repos/list', { workspacePath: repoDir })
  const repository = list.repositories[0]
  record('repos/list discovers the workspace repository', repository !== undefined && repository.vcsType === 'git')
  const repositoryId = repository.id

  // --- timeline reads -------------------------------------------------------
  const timeline = await post(handler, '/vcs/timeline', { repositoryId, limit: 5, includeFiles: true })
  record('timeline returns a commit with its changed files',
    timeline.events.length === 1 && timeline.events[0].changedFiles.length === 2,
    `${timeline.events.length} commit(s), ${timeline.events[0]?.changedFiles?.length ?? 0} file(s)`)

  const allBranches = await post(handler, '/vcs/timeline', { repositoryId, limit: 5, branchScope: 'all' })
  record('branchScope=all is accepted as a real host-side walk', allBranches.events.length === 1)

  // --- working-tree status and diffs ----------------------------------------
  const status = await post(handler, '/vcs/status', { repositoryId })
  const paths = status.entries.map(entry => entry.path)
  record('status exposes staged, unstaged and untracked entries',
    status.entries.some(entry => entry.staged === true)
      && status.entries.some(entry => entry.staged !== true && entry.status === '?')
      && status.entries.some(entry => entry.staged !== true && entry.status !== '?'),
    paths.join(', '))

  const unstaged = await post(handler, '/vcs/worktree/diff', { repositoryId, filePath: 'README.md' })
  record('worktree/diff renders a tracked unstaged hunk',
    unstaged.kind === 'tracked' && unstaged.text.includes('+three'), unstaged.kind)

  const staged = await post(handler, '/vcs/worktree/diff', { repositoryId, filePath: 'staged.ts', staged: true })
  record('worktree/diff staged side reads the index',
    staged.staged === true && staged.kind === 'tracked' && staged.text.includes('+export const a = 1'))

  const untracked = await post(handler, '/vcs/worktree/diff', { repositoryId, filePath: 'untracked.txt' })
  record('worktree/diff reports an untracked file as a whole-file addition',
    untracked.kind === 'untracked' && untracked.text.includes('+new file'), untracked.kind)

  // --- pre-commit checks ----------------------------------------------------
  const checks = await post(handler, '/vcs/checks', { repositoryId, staged: true })
  record('checks answers for the staged diff',
    checks.scope === 'staged' && Array.isArray(checks.findings), `${checks.filesChecked} file(s)`)

  const worktreeChecks = await post(handler, '/vcs/checks', { repositoryId })
  record('checks on the worktree side reports lockfile and untracked truth',
    worktreeChecks.scope === 'worktree'
      && worktreeChecks.findings.some(finding => finding.rule === 'lockfile')
      && worktreeChecks.findings.some(finding => finding.rule === 'untracked-skipped'))

  // --- hotspot statistics ---------------------------------------------------
  const hotspots = await post(handler, '/vcs/stats/hotspots', { repositoryId, limit: 10 })
  record('stats/hotspots ranks real files over a bounded window',
    hotspots.available === true
      && hotspots.scannedCommits === 1
      && hotspots.files.some(file => file.path === 'README.md')
      && hotspots.scope.branch === 'main',
    `${hotspots.files.length} file(s), window ${hotspots.scope.windowCommits}`)
  record('stats/hotspots carries real daily chart buckets',
    Array.isArray(hotspots.daily)
      && hotspots.daily.length >= 1
      && hotspots.daily.reduce((sum, day) => sum + day.commits, 0) === hotspots.scannedCommits,
    `${hotspots.daily?.length ?? 0} day(s)`)

  // --- session attribution --------------------------------------------------
  const changes = await post(handler, '/vcs/session/changes', { repositoryId, sessionId: 'session-live' })
  record('session/changes attributes a successful tool call as inferred',
    changes.available === true
      && changes.files.some(file => file.path === 'src/agent.ts' && file.confidence === 'inferred'), changes.files.map(file => file.path).join(', '))

  const noSession = await post(handler, '/vcs/session/changes', { repositoryId, sessionId: 'archived' })
  record('session/changes refuses an archived session instead of guessing', noSession.available === false)

  // --- write preview (no execution) -----------------------------------------
  const preview = await post(handler, '/vcs/op/preview', {
    repositoryId,
    operation: 'commit',
    params: { message: 'verify: staged file' },
  })
  record('op/preview still produces a single-use commit preview',
    preview.allowed === true && preview.argv.includes('commit') && preview.confirmationToken !== '')

  const stagePreview = await post(handler, '/vcs/op/preview', { repositoryId, operation: 'stage', params: {} })
  record('op/preview plans an explicit stage action',
    stagePreview.allowed === true && stagePreview.argv.includes('add') && stagePreview.argv.includes('-A'),
    stagePreview.argv.join(' '))

  const unstagePreview = await post(handler, '/vcs/op/preview', { repositoryId, operation: 'unstage', params: {} })
  record('op/preview plans an explicit unstage action',
    unstagePreview.allowed === true && unstagePreview.argv.includes('restore') && unstagePreview.argv.includes('--staged'),
    unstagePreview.argv.join(' '))

  // --- execute staging on the throwaway repo --------------------------------
  const stageAttempt = await post(handler, '/vcs/op/execute', {
    repositoryId,
    operation: 'stage',
    params: {},
    confirmationToken: stagePreview.confirmationToken,
  })
  record('op/execute stage really stages the working tree',
    stageAttempt.state === 'succeeded' && stageAttempt.exitCode === 0,
    `state=${stageAttempt.state} exit=${stageAttempt.exitCode}`)
  const afterStage = await post(handler, '/vcs/status', { repositoryId })
  record('status after stage reports staged entries', afterStage.entries.some(entry => entry.staged === true))

  const unstagePreview2 = await post(handler, '/vcs/op/preview', { repositoryId, operation: 'unstage', params: {} })
  const unstageAttempt = await post(handler, '/vcs/op/execute', {
    repositoryId,
    operation: 'unstage',
    params: {},
    confirmationToken: unstagePreview2.confirmationToken,
  })
  record('op/execute unstage clears the index without touching worktree files',
    unstageAttempt.state === 'succeeded' && unstageAttempt.exitCode === 0,
    `state=${unstageAttempt.state} exit=${unstageAttempt.exitCode}`)
  const afterUnstage = await post(handler, '/vcs/status', { repositoryId })
  record('status after unstage has no staged entries', afterUnstage.entries.every(entry => entry.staged !== true))

  // --- diagnostics ----------------------------------------------------------
  const diagnostics = await post(handler, '/vcs/diagnostics', {})
  record('diagnostics names the git client and the data dir',
    typeof diagnostics.gitVersion === 'string' && diagnostics.dataDir === dataDir)

  passed = results.filter(entry => entry.ok).length
  console.log(`\n${passed}/${results.length} checks passed`)
  if (passed !== results.length) process.exitCode = 1
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 3 })
}
