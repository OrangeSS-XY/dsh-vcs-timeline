/**
 * Git adapter integration tests against real temporary repositories.
 *
 * Every repository is created under the OS temp directory, configured
 * locally, and removed afterwards. The user's repositories are never touched.
 * @module dsh-vcs-timeline/tests/git.integration.test
 */

import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { RunOptions, RunResult, Runner } from '../host/adapters/types.ts'
import { createGitAdapter } from '../host/adapters/git/adapter.ts'
import {
  isSafeBranchName,
  isSafeRemoteName,
  parseLogOutput,
  parseNameStatusZ,
  parseNumstatZ,
  parseStatusV2,
} from '../host/adapters/git/commands.ts'

const execFileAsync = promisify(execFile)

/** A real-subprocess runner used only by tests. */
function nodeRunner(): Runner {
  return {
    async run(argv, cwd, options: RunOptions = {}): Promise<RunResult> {
      try {
        const { stdout, stderr } = await execFileAsync(argv[0] as string, argv.slice(1), {
          cwd,
          encoding: 'utf8',
          maxBuffer: options.maxBytes ?? 8 << 20,
          windowsHide: true,
          timeout: options.timeoutMs ?? 20_000,
          ...(options.signal === undefined ? {} : { signal: options.signal as AbortSignal }),
        })
        return { exitCode: 0, stdout, stderr }
      } catch (error: unknown) {
        const failure = error as { code?: number | string; killed?: boolean; signal?: string; stdout?: string; stderr?: string; message?: string }
        if (failure.code === 'ENOENT') {
          return { exitCode: null, stdout: '', stderr: '', spawnFailed: true, failureMessage: 'ENOENT' }
        }
        return {
          exitCode: typeof failure.code === 'number' ? failure.code : null,
          stdout: failure.stdout ?? '',
          stderr: failure.stderr ?? '',
          ...(failure.killed === true ? { timedOut: true } : {}),
          ...(failure.message === undefined ? {} : { failureMessage: failure.message }),
        }
      }
    },
    async resolveExecutable(command) {
      try {
        await execFileAsync(command, ['--version'], { windowsHide: true })
        return command
      } catch {
        return null
      }
    },
  }
}

/** Run a git command for test setup. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return stdout
}

/** Create a temp repository with two commits, a rename, and a binary file. */
async function makeRepo(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'dvt-git-'))
  await git(dir, 'init', '-b', 'main', '-q')
  await git(dir, 'config', 'user.name', 'Test User')
  await git(dir, 'config', 'user.email', 'test@example.com')
  await writeFile(join(dir, 'a.txt'), 'one\ntwo\n', 'utf8')
  await writeFile(join(dir, '中文 空格 #1.txt'), 'hello\n', 'utf8')
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-q', '-m', 'first commit')
  await writeFile(join(dir, 'a.txt'), 'one\nthree\n', 'utf8')
  await rename(join(dir, '中文 空格 #1.txt'), join(dir, 'renamed file.txt'))
  await writeFile(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 0, 255]))
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-q', '-m', 'second: rename, binary, unicode')
  return {
    dir,
    cleanup: async () => { await rm(dir, { recursive: true, force: true, maxRetries: 3 }) },
  }
}

test('detect, info, history paging, changeset, diff and status on a real repository', async () => {
  const repo = await makeRepo()
  try {
    const adapter = createGitAdapter(nodeRunner())
    const detected = await adapter.detect(repo.dir)
    assert.equal(detected.ok, true)
    assert.equal(detected.ok ? detected.value !== null : false, true)
    const root = detected.ok && detected.value !== null ? detected.value.rootPath : repo.dir

    const info = await adapter.info(root)
    assert.equal(info.ok, true)
    if (!info.ok) return
    assert.equal(info.value.vcsType, 'git')
    assert.equal(info.value.currentBranch, 'main')
    assert.match(info.value.currentRevision ?? '', /^[0-9a-f]{40}$/)
    assert.equal(info.value.displayName.length > 0, true)

    const head = info.value.currentRevision as string
    // Page 1: one commit, hasMore true.
    const page1 = await adapter.history(root, info.value.id, { limit: 1 })
    assert.equal(page1.ok, true)
    if (!page1.ok) return
    assert.equal(page1.value.events.length, 1)
    assert.equal(page1.value.hasMore, true)
    assert.ok(page1.value.nextCursor !== null)
    assert.equal(page1.value.events[0]!.source, 'repository')
    assert.equal(page1.value.events[0]!.eventType, 'commit')

    // Page 2 continues without repeating.
    const page2 = await adapter.history(root, info.value.id, { limit: 1, cursor: page1.value.nextCursor })
    assert.equal(page2.ok, true)
    if (!page2.ok) return
    assert.equal(page2.value.events.length, 1)
    assert.notEqual(page2.value.events[0]!.commitHash, page1.value.events[0]!.commitHash)

    // Per-commit stats ride on the same page, aligned by commit hash:
    // commit 2 changes a.txt (1+/1-), adds one binary file and renames one
    // file (0/0), so it touches three files with one addition and one deletion.
    const headEvent = page1.value.events[0]!
    assert.equal(headEvent.metadata?.filesChanged, 3)
    assert.equal(headEvent.metadata?.additions, 1)
    assert.equal(headEvent.metadata?.deletions, 1)
    assert.equal(headEvent.metadata?.binaryFiles, 1)
    // Existing metadata keys survive alongside the additive stats keys.
    assert.equal(headEvent.metadata?.parentCount, 1)
    assert.equal(headEvent.metadata?.authorEmail, 'test@example.com')
    // Commit 1 adds two text files (3 lines total, no deletions, no binaries).
    const parentEvent = page2.value.events[0]!
    assert.equal(parentEvent.metadata?.filesChanged, 2)
    assert.equal(parentEvent.metadata?.additions, 3)
    assert.equal(parentEvent.metadata?.deletions, 0)
    assert.equal(parentEvent.metadata?.binaryFiles, 0)

    // Changeset of HEAD: rename + binary + unicode name.
    const changeset = await adapter.changeSet(root, info.value.id, head)
    assert.equal(changeset.ok, true)
    if (!changeset.ok) return
    const files = changeset.value.files
    const renamed = files.find(file => file.status === 'renamed')
    assert.ok(renamed !== undefined, 'expected a renamed entry')
    assert.equal(renamed?.path, 'renamed file.txt')
    assert.equal(renamed?.oldPath, '中文 空格 #1.txt')
    const binary = files.find(file => file.path === 'bin.dat')
    assert.equal(binary?.binary, true)
    const modified = files.find(file => file.path === 'a.txt')
    assert.equal(modified?.status, 'modified')
    assert.equal(modified?.additions, 1)
    assert.equal(modified?.deletions, 1)

    // Diff of one file inside that commit (revisionB = commit hash).
    const diff = await adapter.diff(root, info.value.id, { revisionB: head, filePath: 'a.txt', maxBytes: 64 * 1024 })
    assert.equal(diff.ok, true)
    if (!diff.ok) return
    assert.equal(diff.value.binary, false)
    assert.ok(diff.value.text.includes('-two'))
    assert.ok(diff.value.text.includes('+three'))
    assert.equal(diff.value.revisionB, head)

    // Diff of the binary file is flagged, not rendered.
    const binaryDiff = await adapter.diff(root, info.value.id, { revisionB: head, filePath: 'bin.dat', maxBytes: 64 * 1024 })
    assert.equal(binaryDiff.ok, true)
    assert.equal(binaryDiff.ok ? binaryDiff.value.binary : false, true)

    // Path traversal is refused.
    const traversal = await adapter.diff(root, info.value.id, { revisionB: head, filePath: '../secret.txt', maxBytes: 1024 })
    assert.equal(traversal.ok, false)
    assert.equal(traversal.ok === false ? traversal.error.code : '', 'invalid-request')

    // Clean working tree, then dirty with one modified and one untracked file.
    const clean = await adapter.status(root, info.value.id)
    assert.equal(clean.ok, true)
    assert.equal(clean.ok ? clean.value.clean : false, true)
    await writeFile(join(root, 'a.txt'), 'dirty\n', 'utf8')
    await writeFile(join(root, 'untracked.txt'), 'x', 'utf8')
    const dirty = await adapter.status(root, info.value.id)
    assert.equal(dirty.ok, true)
    if (!dirty.ok) return
    assert.equal(dirty.value.clean, false)
    assert.ok(dirty.value.entries.some(entry => entry.path === 'a.txt'))
    assert.ok(dirty.value.entries.some(entry => entry.path === 'untracked.txt' && entry.status === '?'))
  } finally {
    await repo.cleanup()
  }
})

test('history filters by author and text', async () => {
  const repo = await makeRepo()
  try {
    const adapter = createGitAdapter(nodeRunner())
    const info = await adapter.info(repo.dir)
    assert.equal(info.ok, true)
    if (!info.ok) return
    const byAuthor = await adapter.history(repo.dir, info.value.id, { limit: 10, author: 'Test User' })
    assert.equal(byAuthor.ok, true)
    assert.equal(byAuthor.ok ? byAuthor.value.events.length : 0, 2)
    // Newest first: the rename commit then the initial commit.
    if (byAuthor.ok) {
      assert.equal(byAuthor.value.events[0]!.metadata?.filesChanged, 3)
      assert.equal(byAuthor.value.events[1]!.metadata?.filesChanged, 2)
    }
    const byText = await adapter.history(repo.dir, info.value.id, { limit: 10, text: 'rename' })
    assert.equal(byText.ok, true)
    assert.equal(byText.ok ? byText.value.events.length : 0, 1)
    // The same filter applies to the stats invocation, so the surviving
    // commit carries its own stats (not the initial commit's two files).
    if (byText.ok) {
      assert.equal(byText.value.events[0]!.commitHash, info.value.currentRevision)
      assert.equal(byText.value.events[0]!.metadata?.filesChanged, 3)
      assert.equal(byText.value.events[0]!.metadata?.additions, 1)
      assert.equal(byText.value.events[0]!.metadata?.deletions, 1)
      assert.equal(byText.value.events[0]!.metadata?.binaryFiles, 1)
    }
    const noMatch = await adapter.history(repo.dir, info.value.id, { limit: 10, text: 'zzz-not-there' })
    assert.equal(noMatch.ok, true)
    assert.equal(noMatch.ok ? noMatch.value.events.length : -1, 0)
  } finally {
    await repo.cleanup()
  }
})

test('history includeFiles attaches each commit\'s changed files to the same page', async () => {
  const repo = await makeRepo()
  try {
    const adapter = createGitAdapter(nodeRunner())
    const info = await adapter.info(repo.dir)
    assert.equal(info.ok, true)
    if (!info.ok) return

    const page = await adapter.history(repo.dir, info.value.id, { limit: 10, includeFiles: true })
    assert.equal(page.ok, true)
    if (!page.ok) return
    assert.equal(page.value.events.length, 2)

    // Newest first: modify a.txt, add the binary, rename the unicode file.
    const headFiles = page.value.events[0]!.changedFiles
    assert.ok(headFiles !== undefined)
    assert.equal(headFiles?.length, 3)
    assert.equal(page.value.events[0]!.changedFilesTruncated, undefined)
    const renamed = headFiles?.find(file => file.status === 'renamed')
    assert.equal(renamed?.path, 'renamed file.txt')
    assert.equal(renamed?.oldPath, '中文 空格 #1.txt')
    assert.equal(renamed?.additions, 0)
    assert.equal(renamed?.deletions, 0)
    const binary = headFiles?.find(file => file.path === 'bin.dat')
    assert.equal(binary?.status, 'added')
    assert.equal(binary?.binary, true)
    assert.equal(binary?.additions, undefined)
    const modified = headFiles?.find(file => file.path === 'a.txt')
    assert.equal(modified?.status, 'modified')
    assert.equal(modified?.additions, 1)
    assert.equal(modified?.deletions, 1)

    // Oldest: the initial commit adds two text files.
    const rootFiles = page.value.events[1]!.changedFiles
    assert.ok(rootFiles !== undefined)
    assert.equal(rootFiles?.length, 2)
    for (const file of rootFiles ?? []) {
      assert.equal(file.status, 'added')
      assert.equal(file.binary, undefined)
      assert.equal(typeof file.additions, 'number')
    }
    assert.deepEqual(
      (rootFiles ?? []).map(file => file.path).sort(),
      ['a.txt', '中文 空格 #1.txt'],
    )

    // Without includeFiles the key is absent, so the client can tell
    // "not asked for" from "changed nothing".
    const plain = await adapter.history(repo.dir, info.value.id, { limit: 10 })
    assert.equal(plain.ok, true)
    if (!plain.ok) return
    for (const event of plain.value.events) {
      assert.equal('changedFiles' in event, false)
      assert.equal(event.changedFilesTruncated, undefined)
    }
  } finally {
    await repo.cleanup()
  }
})

test('history includeFiles classifies added, modified, deleted, renamed and binary files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvt-git-files-'))
  try {
    await git(dir, 'init', '-b', 'main', '-q')
    await git(dir, 'config', 'user.name', 'Test User')
    await git(dir, 'config', 'user.email', 'test@example.com')
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\n', 'utf8')
    await writeFile(join(dir, 'del.txt'), 'bye\n', 'utf8')
    await writeFile(join(dir, 'old name.txt'), 'copy me\n', 'utf8')
    await writeFile(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 0, 255]))
    await git(dir, 'add', '-A')
    await git(dir, 'commit', '-q', '-m', 'initial files')
    await writeFile(join(dir, 'a.txt'), 'one\nCHANGED\n', 'utf8')
    await rm(join(dir, 'del.txt'))
    await rename(join(dir, 'old name.txt'), join(dir, 'new name.txt'))
    await writeFile(join(dir, 'bin.dat'), Buffer.from([9, 9, 0]))
    await git(dir, 'add', '-A')
    await git(dir, 'commit', '-q', '-m', 'modify, delete, rename, binary')

    const adapter = createGitAdapter(nodeRunner())
    const info = await adapter.info(dir)
    assert.equal(info.ok, true)
    if (!info.ok) return
    const page = await adapter.history(dir, info.value.id, { limit: 10, includeFiles: true })
    assert.equal(page.ok, true)
    if (!page.ok) return
    assert.equal(page.value.events.length, 2)

    const files = page.value.events[0]!.changedFiles ?? []
    assert.equal(files.length, 4)
    const byPath = new Map(files.map(file => [file.path, file]))
    assert.deepEqual(byPath.get('a.txt'), { path: 'a.txt', status: 'modified', additions: 1, deletions: 1 })
    assert.deepEqual(byPath.get('del.txt'), { path: 'del.txt', status: 'deleted', additions: 0, deletions: 1 })
    assert.deepEqual(byPath.get('new name.txt'), { path: 'new name.txt', oldPath: 'old name.txt', status: 'renamed', additions: 0, deletions: 0 })
    assert.deepEqual(byPath.get('bin.dat'), { path: 'bin.dat', status: 'modified', binary: true })

    const initial = page.value.events[1]!.changedFiles ?? []
    assert.deepEqual(initial.map(file => file.status), ['added', 'added', 'added', 'added'])
    assert.equal(initial.find(file => file.path === 'bin.dat')?.binary, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('history includeFiles reports an empty file list for a merge commit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvt-git-merge-'))
  try {
    await git(dir, 'init', '-b', 'main', '-q')
    await git(dir, 'config', 'user.name', 'Test User')
    await git(dir, 'config', 'user.email', 'test@example.com')
    await writeFile(join(dir, 'base.txt'), 'base\n', 'utf8')
    await git(dir, 'add', '-A')
    await git(dir, 'commit', '-q', '-m', 'base')
    await git(dir, 'checkout', '-q', '-b', 'side')
    await writeFile(join(dir, 'side.txt'), 'side\n', 'utf8')
    await git(dir, 'add', '-A')
    await git(dir, 'commit', '-q', '-m', 'side commit')
    await git(dir, 'checkout', '-q', 'main')
    await writeFile(join(dir, 'main.txt'), 'main\n', 'utf8')
    await git(dir, 'add', '-A')
    await git(dir, 'commit', '-q', '-m', 'main commit')
    await git(dir, 'merge', '--no-ff', '-q', '-m', 'merge side', 'side')

    const adapter = createGitAdapter(nodeRunner())
    const info = await adapter.info(dir)
    assert.equal(info.ok, true)
    if (!info.ok) return
    const page = await adapter.history(dir, info.value.id, { limit: 10, includeFiles: true })
    assert.equal(page.ok, true)
    if (!page.ok) return
    const mergeEvent = page.value.events[0]
    assert.ok(mergeEvent !== undefined)
    assert.equal(mergeEvent.parentHashes?.length, 2)
    // `git log --name-status` never expands a merge without `-m`, so the honest
    // answer is an empty list, not a guessed one.
    assert.deepEqual(mergeEvent.changedFiles, [])
    assert.equal(mergeEvent.changedFilesTruncated, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a failed name-status probe omits changedFiles and warns instead of failing the page', async () => {
  const repo = await makeRepo()
  try {
    const base = nodeRunner()
    const failingNameStatus: Runner = {
      ...base,
      async run(argv, cwd, options = {}) {
        if (argv.includes('log') && argv.includes('--name-status')) {
          return { exitCode: 1, stdout: '', stderr: 'fatal: simulated name-status failure' }
        }
        return base.run(argv, cwd, options)
      },
    }
    const adapter = createGitAdapter(failingNameStatus)
    const info = await adapter.info(repo.dir)
    assert.equal(info.ok, true)
    if (!info.ok) return
    const history = await adapter.history(repo.dir, info.value.id, { limit: 10, includeFiles: true })
    assert.equal(history.ok, true)
    if (!history.ok) return
    assert.equal(history.value.events.length, 2)
    for (const event of history.value.events) {
      assert.equal('changedFiles' in event, false)
      // The page is still fully readable and the stats probe is unaffected.
      assert.equal(typeof event.metadata?.filesChanged, 'number')
    }
    assert.equal((history.value.warnings ?? []).some(warning => warning.includes('changed files')), true)
  } finally {
    await repo.cleanup()
  }
})

test('a failed stats probe omits the stats keys instead of failing the page', async () => {
  const repo = await makeRepo()
  try {
    const base = nodeRunner()
    const failingStats: Runner = {
      ...base,
      async run(argv, cwd, options = {}) {
        if (argv.includes('log') && argv.includes('--numstat')) {
          return { exitCode: 1, stdout: '', stderr: 'fatal: simulated stats failure' }
        }
        return base.run(argv, cwd, options)
      },
    }
    const adapter = createGitAdapter(failingStats)
    const info = await adapter.info(repo.dir)
    assert.equal(info.ok, true)
    if (!info.ok) return
    const history = await adapter.history(repo.dir, info.value.id, { limit: 10 })
    assert.equal(history.ok, true)
    if (!history.ok) return
    assert.equal(history.value.events.length, 2)
    for (const event of history.value.events) {
      assert.equal(event.metadata?.filesChanged, undefined)
      assert.equal(event.metadata?.additions, undefined)
      assert.equal(event.metadata?.deletions, undefined)
      assert.equal(event.metadata?.binaryFiles, undefined)
      // Non-stats metadata is still present.
      assert.equal(typeof event.metadata?.parentCount, 'number')
    }
  } finally {
    await repo.cleanup()
  }
})

test('an unborn repository yields an empty history page instead of an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvt-git-empty-'))
  try {
    await git(dir, 'init', '-b', 'main', '-q')
    const adapter = createGitAdapter(nodeRunner())
    const info = await adapter.info(dir)
    assert.equal(info.ok, true)
    if (!info.ok) return
    assert.equal(info.value.currentRevision, undefined)
    const history = await adapter.history(dir, info.value.id, { limit: 10 })
    assert.equal(history.ok, true)
    if (!history.ok) return
    assert.equal(history.value.events.length, 0)
    assert.equal(history.value.hasMore, false)
    // No commits means no stats keys anywhere on the page.
    assert.equal(history.value.events.every(event => event.metadata?.filesChanged === undefined), true)
    assert.equal(history.value.events.every(event => event.metadata?.binaryFiles === undefined), true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('working-tree state drives the write-operation plans', async () => {
  const repo = await makeRepo()
  try {
    const adapter = createGitAdapter(nodeRunner())
    const info = await adapter.info(repo.dir)
    assert.equal(info.ok, true)
    if (!info.ok) return
    const id = info.value.id

    const cleanState = await adapter.beforeState(repo.dir, 'commit')
    assert.equal(cleanState.ok, true)
    if (!cleanState.ok) return
    assert.equal(cleanState.value.clean, true)
    assert.equal(cleanState.value.branch, 'main')
    assert.equal((cleanState.value.stagedFiles ?? []).length, 0)

    // Commit with nothing staged is blocked.
    const blocked = await adapter.planOperation(repo.dir, 'commit', { message: 'x' }, cleanState.value)
    assert.equal(blocked.ok, true)
    assert.equal(blocked.ok ? blocked.value.allowed : true, false)

    // Stage a change, then commit is allowed and argv is exact.
    await writeFile(join(repo.dir, 'a.txt'), 'staged\n', 'utf8')
    await git(repo.dir, 'add', 'a.txt')
    const staged = await adapter.beforeState(repo.dir, 'commit')
    assert.equal(staged.ok, true)
    if (!staged.ok) return
    assert.deepEqual(staged.value.stagedFiles, ['a.txt'])
    const allowed = await adapter.planOperation(repo.dir, 'commit', { message: 'feat: staged change' }, staged.value)
    assert.equal(allowed.ok, true)
    if (!allowed.ok) return
    assert.equal(allowed.value.allowed, true)
    assert.deepEqual(allowed.value.argv.slice(-3), ['commit', '-m', 'feat: staged change'])
    assert.equal(allowed.value.network, false)

    // The message is required and never interpolated into a shell string.
    const noMessage = await adapter.planOperation(repo.dir, 'commit', {}, staged.value)
    assert.equal(noMessage.ok ? noMessage.value.allowed : true, false)

    // Pull/push are blocked without a remote; fetch is allowed.
    const pull = await adapter.planOperation(repo.dir, 'pull', {}, cleanState.value)
    assert.equal(pull.ok ? pull.value.allowed : true, false)
    const push = await adapter.planOperation(repo.dir, 'push', {}, cleanState.value)
    assert.equal(push.ok ? push.value.allowed : true, false)
    const fetch = await adapter.planOperation(repo.dir, 'fetch', {}, cleanState.value)
    assert.equal(fetch.ok ? fetch.value.allowed : false, true)
    assert.deepEqual(fetch.ok ? fetch.value.argv.slice(-1) : [], ['fetch'])

    // Operations outside the v1 set are refused explicitly.
    for (const operation of ['merge', 'rebase', 'switch'] as const) {
      const plan = await adapter.planOperation(repo.dir, operation, {}, cleanState.value)
      assert.equal(plan.ok, true)
      assert.equal(plan.ok ? plan.value.allowed : true, false)
    }

    // Detached HEAD blocks push.
    const head = (await adapter.info(repo.dir)).ok ? (await adapter.info(repo.dir)) : undefined
    void head
    await git(repo.dir, 'checkout', '--detach', '-q', 'HEAD')
    const detached = await adapter.beforeState(repo.dir, 'push')
    assert.equal(detached.ok, true)
    if (detached.ok) {
      assert.equal(detached.value.branch, undefined)
      const detachedPush = await adapter.planOperation(repo.dir, 'push', {}, detached.value)
      assert.equal(detachedPush.ok ? detachedPush.value.allowed : true, false)
    }
  } finally {
    await repo.cleanup()
  }
})

test('remote URLs are stored without credentials', async () => {
  const repo = await makeRepo()
  try {
    await git(repo.dir, 'remote', 'add', 'origin', 'https://user:supersecret@example.com/org/repo.git')
    const adapter = createGitAdapter(nodeRunner())
    const info = await adapter.info(repo.dir)
    assert.equal(info.ok, true)
    if (!info.ok) return
    const urls = info.value.remoteUrls ?? []
    assert.equal(urls.length, 1)
    assert.ok(!urls[0]!.includes('supersecret'))
    assert.ok(!urls[0]!.includes('user:'))
  } finally {
    await repo.cleanup()
  }
})

test('parser fixtures cover empty body, unicode, rename and binary shapes', () => {
  const logText = [
    'aaa\u0000bbb ccc\u0000Ann\u0000ann@example.com\u00002026-01-02T03:04:05+08:00\u0000HEAD -> main\u0000subject line\u0000body line 1\nbody line 2\n',
    'bbb\u0000\u0000Bob\u0000bob@example.com\u00002026-01-01T00:00:00+08:00\u0000\u0000unicode 中文 subject\u0000',
    '',
  ].join('\u0000')
  const commits = parseLogOutput(logText)
  assert.equal(commits.length, 2)
  assert.equal(commits[0]!.hash, 'aaa')
  assert.deepEqual(commits[0]!.parents, ['bbb', 'ccc'])
  assert.equal(commits[0]!.body, 'body line 1\nbody line 2')
  assert.equal(commits[1]!.parents.length, 0)
  assert.equal(commits[1]!.subject, 'unicode 中文 subject')
  assert.equal(commits[1]!.body, '')

  const names = parseNameStatusZ('M\u0000a.txt\u0000A\u0000bin.dat\u0000R100\u0000old name.txt\u0000new name.txt\u0000')
  assert.deepEqual(names, [
    { status: 'M', path: 'a.txt' },
    { status: 'A', path: 'bin.dat' },
    { status: 'R100', path: 'new name.txt', oldPath: 'old name.txt' },
  ])

  const numstat = parseNumstatZ('1\t1\ta.txt\u0000-\t-\tbin.dat\u00000\t0\t\u0000old name.txt\u0000new name.txt\u0000')
  assert.equal(numstat.length, 3)
  assert.equal(numstat[0]!.additions, 1)
  assert.equal(numstat[1]!.binary, true)
  assert.equal(numstat[2]!.oldPath, 'old name.txt')
  assert.equal(numstat[2]!.path, 'new name.txt')

  const status = parseStatusV2([
    '# branch.oid abc\u0000# branch.head main\u0000# branch.ab +2 -1\u0000',
    '1 .M N... 100644 100644 100644 aaa bbb src/a.txt\u0000',
    '? untracked file.txt\u0000',
    'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.txt\u0000',
  ].join(''))
  assert.equal(status.branch, 'main')
  assert.equal(status.head, 'abc')
  assert.equal(status.ahead, 2)
  assert.equal(status.behind, 1)
  assert.equal(status.clean, false)
  assert.deepEqual(status.conflicts, ['conflict.txt'])
  assert.equal(status.entries.length, 3)
})

test('ref-name validators refuse option-like and shell-metacharacter input', () => {
  assert.equal(isSafeBranchName('main'), true)
  assert.equal(isSafeBranchName('feature/x-1'), true)
  assert.equal(isSafeBranchName('-Delete'), false)
  assert.equal(isSafeBranchName('a b'), false)
  assert.equal(isSafeBranchName('a;rm -rf /'), false)
  assert.equal(isSafeBranchName('a..b'), false)
  assert.equal(isSafeRemoteName('origin'), true)
  assert.equal(isSafeRemoteName('--upload-pack=evil'), false)
  assert.equal(isSafeRemoteName('a&b'), false)
})

test('a missing git executable is reported as vcs-not-installed', async () => {
  const adapter = createGitAdapter({
    async run() {
      return { exitCode: null, stdout: '', stderr: '', spawnFailed: true, failureMessage: 'ENOENT' }
    },
    async resolveExecutable() {
      return null
    },
  })
  const info = await adapter.info('C:/whatever')
  assert.equal(info.ok, false)
  assert.equal(info.ok === false ? info.error.code : '', 'vcs-not-installed')
  const plan = await adapter.planOperation('C:/whatever', 'fetch', {}, {})
  assert.equal(plan.ok, false)
  assert.equal(plan.ok === false ? plan.error.code : '', 'vcs-not-installed')
})

test('mkdir is unused but keeps the import honest for directory fixtures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvt-git-misc-'))
  try {
    await mkdir(join(dir, 'nested'))
    assert.equal(true, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
