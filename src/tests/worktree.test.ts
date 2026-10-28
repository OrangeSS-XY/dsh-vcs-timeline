/**
 * Working-tree diff and branch-filter tests over the Git adapter.
 *
 * The adapter is driven through a scripted {@link Runner}, plus a real temp
 * directory for the untracked-file path (the adapter reads that file itself).
 * @module dsh-vcs-timeline/tests/worktree.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createGitAdapter } from '../host/adapters/git/adapter.ts'
import type { RunOptions, RunResult, Runner } from '../host/adapters/types.ts'
import { makeTempDir } from './helpers.ts'

interface Call {
  argv: string[]
  cwd: string
}

/** A runner that records argv and answers with scripted results. */
function scriptedRunner(
  answers: Array<Partial<RunResult> & { match?: (argv: readonly string[]) => boolean }>,
): { runner: Runner; calls: Call[] } {
  const calls: Call[] = []
  const results = answers.map(answer => ({ ...answer }))
  const runner: Runner = {
    async run(argv, cwd, _options?: RunOptions): Promise<RunResult> {
      calls.push({ argv: [...argv], cwd })
      const index = results.findIndex(answer => answer.match === undefined || answer.match(argv))
      const answer = index >= 0 ? results.splice(index, 1)[0] : undefined
      return {
        exitCode: answer?.exitCode ?? 0,
        stdout: answer?.stdout ?? '',
        stderr: answer?.stderr ?? '',
        ...(answer?.spawnFailed === undefined ? {} : { spawnFailed: answer.spawnFailed }),
        ...(answer?.timedOut === undefined ? {} : { timedOut: answer.timedOut }),
      }
    },
    async resolveExecutable() {
      return 'git'
    },
  }
  return { runner, calls }
}

test('worktreeDiff uses the index side for staged and the worktree side otherwise', async () => {
  const first = scriptedRunner([{ stdout: 'diff --git a/a b/a\n+one\n' }])
  const adapter = createGitAdapter(first.runner)
  const staged = await adapter.worktreeDiff('/repo', 'git:repo', { filePath: 'a.ts', staged: true, contextLines: 3, maxBytes: 65536 })
  assert.ok(staged.ok)
  assert.equal(staged.value.kind, 'tracked')
  assert.equal(staged.value.staged, true)
  const stagedArgv = first.calls[0]?.argv.join(' ') ?? ''
  assert.ok(stagedArgv.includes('--cached'))
  assert.ok(stagedArgv.includes('a.ts'))

  const second = scriptedRunner([{ match: argv => argv.includes('ls-files'), exitCode: 0 }, { stdout: '+two\n' }])
  const unstaged = await createGitAdapter(second.runner).worktreeDiff('/repo', 'git:repo', { filePath: 'a.ts', staged: false, contextLines: 3, maxBytes: 65536 })
  assert.ok(unstaged.ok)
  const unstagedArgv = second.calls[1]?.argv.join(' ') ?? ''
  assert.ok(!unstagedArgv.includes('--cached'))
})

test('an untracked file is rendered as a whole-file addition and labelled untracked', async () => {
  const dir = await makeTempDir('dvt-worktree-')
  try {
    await writeFile(join(dir.path, 'new.txt'), 'alpha\nbeta\n', 'utf8')
    const scripted = scriptedRunner([
      { match: argv => argv.includes('ls-files'), exitCode: 1 },
    ])
    const adapter = createGitAdapter(scripted.runner)
    const result = await adapter.worktreeDiff(dir.path, 'git:repo', {
      filePath: 'new.txt',
      staged: false,
      contextLines: 3,
      maxBytes: 65536,
    })
    assert.ok(result.ok)
    assert.equal(result.value.kind, 'untracked')
    assert.equal(result.value.staged, false)
    assert.ok(result.value.text.includes('new file mode 100644'))
    assert.ok(result.value.text.includes('+alpha'))
    assert.ok(result.value.text.includes('+beta'))
    assert.ok(result.value.bytes > 0)
  } finally {
    await dir.cleanup()
  }
})

test('a binary untracked file reports binary instead of inventing text', async () => {
  const dir = await makeTempDir('dvt-worktree-bin-')
  try {
    await writeFile(join(dir.path, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 255]), 'binary' as never)
    const scripted = scriptedRunner([
      { match: argv => argv.includes('ls-files'), exitCode: 1 },
    ])
    const result = await createGitAdapter(scripted.runner).worktreeDiff(dir.path, 'git:repo', {
      filePath: 'blob.bin',
      staged: false,
      contextLines: 3,
      maxBytes: 65536,
    })
    assert.ok(result.ok)
    assert.equal(result.value.binary, true)
    assert.equal(result.value.text, '')
  } finally {
    await dir.cleanup()
  }
})

test('history passes a real branch ref, or --branches for the all-branch scope', async () => {
  const first = scriptedRunner([{ match: argv => argv.includes('log'), stdout: '' }])
  const page = await createGitAdapter(first.runner).history('/repo', 'git:repo', {
    limit: 10,
    branch: 'release/1.0',
    branchScope: 'current',
  })
  assert.ok(page.ok)
  assert.ok(first.calls[0]?.argv.some(arg => arg === 'release/1.0'), 'the branch is a real revision argument')

  const second = scriptedRunner([{ match: argv => argv.includes('log'), stdout: '' }])
  await createGitAdapter(second.runner).history('/repo', 'git:repo', { limit: 10, branchScope: 'all' })
  assert.ok(second.calls[0]?.argv.includes('--branches'))
  assert.ok(!second.calls[0]?.argv.includes('--all'), 'local branch heads only, never remote-tracking refs')
})

test('an unsafe branch filter is rejected before it reaches argv', async () => {
  const scripted = scriptedRunner([])
  const result = await createGitAdapter(scripted.runner).history('/repo', 'git:repo', {
    limit: 10,
    branch: '--upload-pack=evil',
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'invalid-request')
  assert.equal(scripted.calls.length, 0)
})

test('a whole-side diff keeps text even when it contains binary markers', async () => {
  const mixed = [
    'diff --git a/a.txt b/a.txt',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1 @@',
    '-one',
    '+two',
    'Binary files a/logo.png and b/logo.png differ',
  ].join('\n')
  const scripted = scriptedRunner([{ match: argv => argv.includes('diff'), stdout: mixed }])
  const result = await createGitAdapter(scripted.runner).worktreeDiff('/repo', 'git:repo', {
    staged: false,
    contextLines: 3,
    maxBytes: 65536,
  })
  assert.ok(result.ok)
  assert.equal(result.value.binary, false, 'a mixed side is not "all binary"')
  assert.ok(result.value.text.includes('+two'))
  assert.ok(result.value.text.includes('Binary files'))
})

test('a single-file diff with a binary marker is still answered as binary', async () => {
  const scripted = scriptedRunner([
    { match: argv => argv.includes('ls-files'), exitCode: 0 },
    { match: argv => argv.includes('diff'), stdout: 'Binary files a/logo.png and b/logo.png differ\n' },
  ])
  const result = await createGitAdapter(scripted.runner).worktreeDiff('/repo', 'git:repo', {
    filePath: 'logo.png',
    staged: false,
    contextLines: 3,
    maxBytes: 65536,
  })
  assert.ok(result.ok)
  assert.equal(result.value.binary, true)
  assert.equal(result.value.text, '')
})

test('stage and unstage are planned as explicit argv with real guards', async () => {
  const adapter = createGitAdapter(scriptedRunner([]).runner)
  const stage = await adapter.planOperation('/repo', 'stage', {}, { clean: false, stagedFiles: [] })
  assert.ok(stage.ok)
  assert.equal(stage.value.allowed, true)
  assert.deepEqual(stage.value.argv.slice(-2), ['add', '-A'])
  assert.equal(stage.value.network, false)

  const stageOne = await adapter.planOperation('/repo', 'stage', { path: 'src/a.ts' }, { clean: false })
  assert.ok(stageOne.ok)
  assert.deepEqual(stageOne.value.argv.slice(-3), ['add', '--', 'src/a.ts'])

  const nothing = await adapter.planOperation('/repo', 'stage', {}, { clean: true })
  assert.ok(nothing.ok)
  assert.equal(nothing.value.allowed, false)

  const unstage = await adapter.planOperation('/repo', 'unstage', {}, { stagedFiles: ['a.ts'] })
  assert.ok(unstage.ok)
  assert.equal(unstage.value.allowed, true)
  assert.ok(unstage.value.argv.includes('restore'))
  assert.ok(unstage.value.argv.includes('--staged'))

  const unstageNothing = await adapter.planOperation('/repo', 'unstage', {}, { stagedFiles: [] })
  assert.ok(unstageNothing.ok)
  assert.equal(unstageNothing.value.allowed, false)
  assert.ok(!unstageNothing.value.argv.includes('restore'), 'a blocked plan carries no argv')
})
