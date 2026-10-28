/**
 * Host insight tests: VCS client discovery/configuration, the runner's
 * executable rewriting, and the local branch comparison (parsers, action table,
 * route wiring, and an optional real-git integration pass).
 *
 * Everything here is hermetic: fake filesystem/PATH seams, a fake subprocess
 * service, and a scripted runner. The integration test builds throwaway
 * repositories under the OS temp directory and only runs when `git` is on PATH.
 * @module dsh-vcs-timeline/tests/insight.test
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import type { BranchCompare, BranchCompareQuery, Repository } from '../shared/contracts.ts'
import { isBranchCompare } from '../shared/contracts.ts'
import type { RunOptions, RunResult, Runner, VcsAdapter } from '../host/adapters/types.ts'
import type { ServiceError as ServiceErrorType } from '../host/services/timeline-service.ts'
import {
  deriveBranchActions,
  isCompareBaseName,
  parseCompareLogZ,
  parseMergeTree,
  parseRevListCounts,
  parseShortstat,
} from '../host/branch/compare.ts'
import { createBranchService, type BranchService } from '../host/branch/service.ts'
import { createDiagnosticsProvider } from '../host/diagnostics.ts'
import type { OperationService } from '../host/services/operation-service.ts'
import type { PullRequestService } from '../host/pr/service.ts'
import { registerVcsRoutes, type VcsRoutesDeps } from '../host/routes.ts'
import { createRunner, type SubprocessLike } from '../host/runner.ts'
import { repositoryId } from '../host/security.ts'
import type { RepositoryResolver, TimelineService } from '../host/services/timeline-service.ts'
import {
  createToolchain,
  isRunnableFile,
  parseVcsConfig,
  probePaths,
  resolveToolPaths,
  VCS_CONFIG_FILE_NAME,
  type ToolResolutionDeps,
} from '../host/toolchain.ts'
import { createFakeAdapter, makeTempDir } from './helpers.ts'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Shared fakes
// ---------------------------------------------------------------------------

/** One recorded fake spawn. */
interface SpawnCall {
  argv: readonly string[]
  cwd: string
}

/** Fake Host subprocess service with a scripted PATH resolution. */
function createFakeSubprocess(options: {
  resolve?: (command: string) => string | null
  stdout?: string
} = {}): SubprocessLike & { calls: SpawnCall[] } {
  const calls: SpawnCall[] = []
  const fake: SubprocessLike & { calls: SpawnCall[] } = {
    calls,
    spawn(spec) {
      calls.push({ argv: spec.argv, cwd: spec.cwd })
      return {
        done: Promise.resolve({ exitCode: 0 }),
        collected: {
          stdout: { readFrom: () => ({ text: options.stdout ?? '' }) },
          stderr: { readFrom: () => ({ text: '' }) },
        },
      }
    },
    async resolveExecutable(command: string) {
      const resolved = options.resolve?.(command) ?? null
      if (resolved === null) throw new Error(`executable not found: ${command}`)
      return resolved
    },
  }
  return fake
}

/** Scripted runner: answers by argv, records every invocation. */
function createStubRunner(
  answer: (argv: readonly string[], cwd: string) => Partial<RunResult> | undefined,
): Runner & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    async run(argv, cwd): Promise<RunResult> {
      calls.push([...argv])
      const partial = answer(argv, cwd) ?? {}
      return { exitCode: 0, stdout: '', stderr: '', ...partial }
    },
    async resolveExecutable(command) {
      return command
    },
  }
}

/** A git repository record used by the branch-service tests. */
function makeRepository(overrides: Partial<Repository> = {}): Repository {
  return {
    schemaVersion: 1,
    id: 'git:c:/fake/repo',
    vcsType: 'git',
    rootPath: 'C:/fake/repo',
    displayName: 'repo',
    currentBranch: 'feature',
    defaultBranch: 'main',
    detectedAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Resolver returning exactly one repository. */
function createStubResolver(repository: Repository): RepositoryResolver {
  const git = createFakeAdapter()
  const svn = createFakeAdapter({ vcsType: 'svn' })
  const pick = (): VcsAdapter => (repository.vcsType === 'git' ? git : svn)
  return {
    adapters: { git, svn },
    async resolve(id) {
      if (id !== repository.id) {
        return { ok: false, error: { code: 'unknown-repository', message: 'unknown repository id' } }
      }
      return { ok: true, value: { repository, root: repository.rootPath, adapter: pick() } }
    },
  }
}

/** Build the branch service over a stub resolver and runner. */
function makeBranchService(
  repository: Repository,
  runner: Runner,
): { service: BranchService; resolver: RepositoryResolver } {
  const resolver = createStubResolver(repository)
  return {
    service: createBranchService({ resolver, runner, now: () => new Date('2026-02-03T04:05:06.000Z') }),
    resolver,
  }
}

/** Join argv for readable matching in a scripted runner. */
function argvText(argv: readonly string[]): string {
  return argv.join(' ')
}

// ---------------------------------------------------------------------------
// A. vcs-config.json parsing
// ---------------------------------------------------------------------------

test('vcs-config: a missing file is the normal case and warns about nothing', () => {
  const parsed = parseVcsConfig(null)
  assert.deepEqual(parsed.paths, {})
  assert.deepEqual(parsed.warnings, [])
  assert.deepEqual(parseVcsConfig('   ').warnings, [])
})

test('vcs-config: valid absolute paths are accepted', () => {
  const parsed = parseVcsConfig(
    JSON.stringify({ gitPath: '/opt/git/bin/git', svnPath: '/opt/svn/bin/svn' }),
    'C:/data/vcs-config.json',
  )
  assert.deepEqual(parsed.paths, { gitPath: '/opt/git/bin/git', svnPath: '/opt/svn/bin/svn' })
  assert.deepEqual(parsed.warnings, [])
})

test('vcs-config: malformed JSON, non-object roots and wrong entry shapes are ignored with a warning', () => {
  const invalidJson = parseVcsConfig('{ gitPath: ', 'C:/data/vcs-config.json')
  assert.deepEqual(invalidJson.paths, {})
  assert.equal(invalidJson.warnings.length, 1)
  assert.match(invalidJson.warnings[0] ?? '', /is not valid JSON/)

  const arrayRoot = parseVcsConfig('[1,2,3]', 'C:/data/vcs-config.json')
  assert.deepEqual(arrayRoot.paths, {})
  assert.match(arrayRoot.warnings[0] ?? '', /must contain a JSON object/)

  const wrongType = parseVcsConfig(JSON.stringify({ gitPath: 42, svnPath: '' }), 'C:/data/vcs-config.json')
  assert.deepEqual(wrongType.paths, {})
  assert.equal(wrongType.warnings.length, 2)
  for (const warning of wrongType.warnings) assert.match(warning, /must be a non-empty string/)

  const relative = parseVcsConfig(JSON.stringify({ svnPath: 'bin/svn' }), 'C:/data/vcs-config.json')
  assert.deepEqual(relative.paths, {})
  assert.match(relative.warnings[0] ?? '', /must be an absolute path/)

  const unknownKeys = parseVcsConfig(JSON.stringify({ gitPath: '/usr/bin/git', extra: true }), 'x.json')
  assert.deepEqual(unknownKeys.paths, { gitPath: '/usr/bin/git' })
  assert.deepEqual(unknownKeys.warnings, [])
})

// ---------------------------------------------------------------------------
// A. Executable resolution: config > PATH > probe
// ---------------------------------------------------------------------------

/** Dependencies of a hermetic tool resolution. */
function toolDeps(overrides: Partial<ToolResolutionDeps> = {}): ToolResolutionDeps {
  return {
    dataDir: '/data/dsh-vcs-timeline',
    resolveOnPath: async () => null,
    readConfigText: async () => null,
    isRunnableFile: async () => false,
    env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local' },
    platform: 'win32',
    ...overrides,
  }
}

test('toolchain: the configured path wins over PATH and probing', async () => {
  const resolved = await resolveToolPaths(toolDeps({
    readConfigText: async () => JSON.stringify({ gitPath: '/opt/custom/git.exe', svnPath: '/opt/custom/svn.exe' }),
    isRunnableFile: async () => true,
    resolveOnPath: async (tool) => (tool === 'git' ? 'C:/path/git.exe' : 'C:/path/svn.exe'),
  }))
  assert.equal(resolved.paths.git, '/opt/custom/git.exe')
  assert.equal(resolved.paths.svn, '/opt/custom/svn.exe')
  assert.equal(resolved.sources.git, 'config')
  assert.equal(resolved.sources.svn, 'config')
  assert.deepEqual(resolved.warnings, [])
})

test('toolchain: PATH wins over probing when no config entry exists', async () => {
  const probed: string[] = []
  const resolved = await resolveToolPaths(toolDeps({
    resolveOnPath: async (tool) => (tool === 'git' ? 'C:/path/git.exe' : 'C:/path/svn.exe'),
    isRunnableFile: async (path) => {
      probed.push(path)
      return true
    },
  }))
  assert.equal(resolved.sources.git, 'path')
  assert.equal(resolved.paths.svn, 'C:/path/svn.exe')
  assert.deepEqual(probed, [])
  assert.deepEqual(resolved.warnings, [])
})

test('toolchain: a missing PATH entry falls back to the well-known install locations', async () => {
  const resolved = await resolveToolPaths(toolDeps({
    resolveOnPath: async () => null,
    isRunnableFile: async (path) => path.toLowerCase().endsWith('svn.exe'),
  }))
  assert.equal(resolved.paths.git, null)
  assert.equal(resolved.sources.git, 'missing')
  assert.equal(resolved.paths.svn, join('C:\\Program Files', 'TortoiseSVN', 'bin', 'svn.exe'))
  assert.equal(resolved.sources.svn, 'probe')
  assert.ok(resolved.warnings.some(warning => /svn client was not found on PATH/.test(warning)))
  // git is absent everywhere: the warning names the install and the config key.
  const gitWarning = resolved.warnings.find(warning => warning.startsWith('git client not found'))
  assert.ok(gitWarning !== undefined)
  assert.match(gitWarning, /vcs-config\.json/)
})

test('toolchain: missing svn names TortoiseSVN/SlikSvn and the config key', async () => {
  const resolved = await resolveToolPaths(toolDeps())
  assert.equal(resolved.paths.git, null)
  assert.equal(resolved.paths.svn, null)
  assert.deepEqual(resolved.sources, { git: 'missing', svn: 'missing' })
  const svnWarning = resolved.warnings.find(warning => warning.startsWith('svn client not found'))
  assert.ok(svnWarning !== undefined)
  assert.match(svnWarning, /TortoiseSVN/)
  assert.match(svnWarning, /SlikSVN/)
  assert.match(svnWarning, /svnPath/)
  assert.match(svnWarning, new RegExp(VCS_CONFIG_FILE_NAME.replace('.', '\\.')))
  assert.match(svnWarning, /dsh-vcs-timeline/)
})

test('toolchain: an invalid configured path is ignored with a warning and falls through', async () => {
  const resolved = await resolveToolPaths(toolDeps({
    readConfigText: async () => JSON.stringify({ gitPath: '/opt/broken/git.exe' }),
    isRunnableFile: async (path) => path === 'C:/path/git.exe',
    resolveOnPath: async (tool) => (tool === 'git' ? 'C:/path/git.exe' : null),
  }))
  assert.equal(resolved.paths.git, 'C:/path/git.exe')
  assert.equal(resolved.sources.git, 'path')
  assert.ok(resolved.warnings.some(warning => /does not point at an executable file/.test(warning)))
})

test('toolchain: a throwing PATH resolver degrades to probing and never rejects', async () => {
  const expected = join('C:\\Program Files', 'Git', 'cmd', 'git.exe')
  const resolved = await resolveToolPaths(toolDeps({
    resolveOnPath: async () => {
      throw new Error('subprocess service unavailable')
    },
    isRunnableFile: async (path) => path === expected,
  }))
  assert.equal(resolved.paths.git, expected)
  assert.equal(resolved.sources.git, 'probe')
})

test('toolchain: probe locations follow the Windows environment and other platforms probe nothing', () => {
  const env = { ProgramFiles: 'D:\\PF', 'ProgramFiles(x86)': 'D:\\PF86', LOCALAPPDATA: 'D:\\Local' }
  const svnCandidates = probePaths('svn', env, 'win32')
  assert.ok(svnCandidates.includes(join('D:\\PF', 'TortoiseSVN', 'bin', 'svn.exe')))
  assert.ok(svnCandidates.includes(join('D:\\PF86', 'SlikSvn', 'bin', 'svn.exe')))
  assert.ok(svnCandidates.includes(join('D:\\PF', 'VisualSVN Server', 'bin', 'svn.exe')))
  assert.ok(svnCandidates.includes(join('D:\\Local', 'Programs', 'TortoiseSVN', 'bin', 'svn.exe')))
  assert.ok(probePaths('git', env, 'win32').includes(join('D:\\PF', 'Git', 'cmd', 'git.exe')))
  assert.deepEqual(probePaths('git', env, 'linux'), [])
  assert.deepEqual(probePaths('svn', env, 'darwin'), [])
  assert.deepEqual(probePaths('svn', {}, 'win32').slice(0, 1), [join('C:\\Program Files', 'TortoiseSVN', 'bin', 'svn.exe')])
})

test('toolchain: isRunnableFile rejects directories, missing files and non-executable Windows shims', async () => {
  const { path: dir, cleanup } = await makeTempDir('dvt-tool-')
  try {
    const exe = join(dir, 'fake-git.exe')
    await writeFile(exe, 'stub', 'utf8')
    const shim = join(dir, 'git.cmd')
    await writeFile(shim, '@echo off\n', 'utf8')
    assert.equal(await isRunnableFile(exe, 'win32'), true)
    assert.equal(await isRunnableFile(shim, 'win32'), false)
    assert.equal(await isRunnableFile(dir, 'win32'), false)
    assert.equal(await isRunnableFile(join(dir, 'absent.exe'), 'win32'), false)
    // POSIX checks the execute bit; on Windows X_OK is equivalent to F_OK, so
    // the platform-independent half is only assertable elsewhere.
    if (process.platform !== 'win32') assert.equal(await isRunnableFile(exe, 'linux'), false)
  } finally {
    await cleanup()
  }
})

test('toolchain: the mount handle resolves exactly once', async () => {
  let reads = 0
  const toolchain = createToolchain(toolDeps({
    readConfigText: async () => {
      reads += 1
      return null
    },
    resolveOnPath: async () => null,
  }))
  const [first, second] = await Promise.all([toolchain.paths(), toolchain.paths()])
  assert.deepEqual(first, { git: null, svn: null })
  assert.deepEqual(first, second)
  assert.equal(reads, 1)
  const resolved = await toolchain.resolve()
  assert.equal(resolved, await toolchain.resolve())
  assert.ok(resolved.warnings.some(warning => warning.startsWith('svn client not found')))
})

// ---------------------------------------------------------------------------
// A. Runner executable rewriting
// ---------------------------------------------------------------------------

test('runner: a bare git/svn argv[0] is rewritten to the resolved executable', async () => {
  const subprocess = createFakeSubprocess({ resolve: () => null })
  const runner = createRunner(subprocess, {
    git: 'C:/Git/cmd/git.exe',
    svn: 'C:/SVN/bin/svn.exe',
  })
  await runner.run(['git', 'status', '--porcelain'], 'C:/repo')
  await runner.run(['svn', 'info', '--xml'], 'C:/repo')
  await runner.run(['node', '-e', '0'], 'C:/repo')
  assert.equal(subprocess.calls.length, 3)
  assert.deepEqual(subprocess.calls[0]?.argv, ['C:/Git/cmd/git.exe', 'status', '--porcelain'])
  assert.deepEqual(subprocess.calls[1]?.argv, ['C:/SVN/bin/svn.exe', 'info', '--xml'])
  // Anything else is passed through untouched: the runner is not a general
  // command resolver.
  assert.deepEqual(subprocess.calls[2]?.argv, ['node', '-e', '0'])
  assert.equal(subprocess.calls[0]?.cwd, 'C:/repo')
})

test('runner: an unresolved client keeps its bare name, and a getter is read once', async () => {
  const subprocess = createFakeSubprocess({ resolve: () => null })
  let reads = 0
  const runner = createRunner(subprocess, async () => {
    reads += 1
    return { git: 'C:/Git/cmd/git.exe', svn: null }
  })
  await runner.run(['git', 'rev-parse', 'HEAD'], 'C:/repo')
  await runner.run(['svn', 'log'], 'C:/repo')
  await runner.run(['git', 'log'], 'C:/repo')
  assert.equal(reads, 1)
  assert.equal(subprocess.calls[0]?.argv[0], 'C:/Git/cmd/git.exe')
  assert.equal(subprocess.calls[1]?.argv[0], 'svn')
  assert.equal(subprocess.calls[2]?.argv[0], 'C:/Git/cmd/git.exe')
})

test('runner: without a tool-path source every argv is passed through unchanged', async () => {
  const subprocess = createFakeSubprocess({ resolve: () => null })
  const runner = createRunner(subprocess)
  await runner.run(['git', 'status'], 'C:/repo')
  assert.deepEqual(subprocess.calls[0]?.argv, ['git', 'status'])
})

test('runner: resolveExecutable reports the resolved path and delegates other names', async () => {
  const subprocess = createFakeSubprocess({
    resolve: (command) => (command === 'svn' ? 'C:/path/svn.exe' : 'C:/path/node.exe'),
  })
  const runner = createRunner(subprocess, { git: 'C:/cfg/git.exe', svn: null })
  assert.equal(await runner.resolveExecutable('git'), 'C:/cfg/git.exe')
  // svn was not resolved at mount: the subprocess service is the fallback.
  assert.equal(await runner.resolveExecutable('svn'), 'C:/path/svn.exe')
  assert.equal(await runner.resolveExecutable('node'), 'C:/path/node.exe')
})

test('toolchain + runner: a configured executable is what the spawned command actually uses', async () => {
  const subprocess = createFakeSubprocess({ resolve: () => null })
  const toolchain = createToolchain(toolDeps({
    readConfigText: async () => JSON.stringify({ svnPath: '/opt/svn/bin/svn' }),
    isRunnableFile: async (path) => path === '/opt/svn/bin/svn',
    resolveOnPath: async () => null,
  }))
  const runner = createRunner(subprocess, () => toolchain.paths())
  await runner.run(['svn', 'log', '--xml'], 'C:/wc')
  assert.deepEqual(subprocess.calls[0]?.argv, ['/opt/svn/bin/svn', 'log', '--xml'])
  assert.equal(await runner.resolveExecutable('svn'), '/opt/svn/bin/svn')
})

// ---------------------------------------------------------------------------
// A. Diagnostics warnings name the exact situation
// ---------------------------------------------------------------------------

test('diagnostics: the missing-svn sentence is surfaced verbatim, versions still reported', async () => {
  const runner: Runner = {
    async run(argv) {
      if (argv[0] === 'git') return { exitCode: 0, stdout: 'git version 2.45.1.windows.1\n', stderr: '' }
      return { exitCode: 1, stdout: '', stderr: 'not found' }
    },
    async resolveExecutable(command) {
      return command === 'git' ? 'C:/Git/cmd/git.exe' : null
    },
  }
  const toolWarnings = [
    'svn client not found (install TortoiseSVN with command line tools, SlikSVN, or set svnPath in C:/data/vcs-config.json)',
  ]
  const provider = createDiagnosticsProvider({
    runner,
    workspaces: () => [],
    pluginVersion: '0.1.0',
    dataDir: 'C:/data',
    toolWarnings: () => toolWarnings,
    toolPaths: () => ({ git: 'C:/Git/cmd/git.exe', svn: null }),
  })
  const value = await provider()
  assert.equal(value.gitVersion, 'git version 2.45.1.windows.1')
  assert.equal(value.svnVersion, null)
  assert.deepEqual(value.warnings, toolWarnings)
})

test('diagnostics: without a toolchain the generic messages are kept', async () => {
  const runner: Runner = {
    async run() {
      return { exitCode: 1, stdout: '', stderr: '' }
    },
    async resolveExecutable() {
      return null
    },
  }
  const provider = createDiagnosticsProvider({
    runner,
    workspaces: () => [],
    pluginVersion: '0.1.0',
    dataDir: 'C:/data',
  })
  const value = await provider()
  assert.deepEqual(value.warnings, ['git executable not found', 'svn executable not found'])
})

// ---------------------------------------------------------------------------
// B. Branch comparison parsers
// ---------------------------------------------------------------------------

test('compare: rev-list counts parse tabs, spaces and reject anything else', () => {
  assert.deepEqual(parseRevListCounts('3\t5\n'), { left: 3, right: 5 })
  assert.deepEqual(parseRevListCounts('0 0'), { left: 0, right: 0 })
  assert.deepEqual(parseRevListCounts('  12\t0  '), { left: 12, right: 0 })
  assert.equal(parseRevListCounts(''), null)
  assert.equal(parseRevListCounts('1 2 3'), null)
  assert.equal(parseRevListCounts('a b'), null)
})

/** `git log -z` fixture: four NUL-terminated fields per commit. */
const LOG_FIXTURE = [
  'a'.repeat(40), 'Ada Lovelace', '2026-01-02T03:04:05+08:00', 'newest subject',
  'b'.repeat(40), 'Grace Hopper', '2025-12-31T23:59:59Z', 'older subject',
].join('\u0000') + '\u0000'

test('compare: log -z parses hash, author, author date and subject per commit', () => {
  const commits = parseCompareLogZ(LOG_FIXTURE)
  assert.equal(commits.length, 2)
  assert.equal(commits[0]?.hash, 'a'.repeat(40))
  assert.equal(commits[0]?.author, 'Ada Lovelace')
  assert.equal(commits[0]?.summary, 'newest subject')
  assert.equal(commits[0]?.timestamp, new Date('2026-01-02T03:04:05+08:00').toISOString())
  assert.equal(commits[1]?.author, 'Grace Hopper')
  assert.equal(commits[1]?.timestamp, '2025-12-31T23:59:59.000Z')
})

test('compare: log -z tolerates trailing newlines, an empty author and an empty stream', () => {
  const text = ['c'.repeat(40), '', '2026-01-02T00:00:00Z', ''].join('\u0000') + '\u0000\n'
  const commits = parseCompareLogZ(text)
  assert.equal(commits.length, 1)
  assert.equal(commits[0]?.author, undefined)
  assert.equal(commits[0]?.summary, '')
  assert.deepEqual(parseCompareLogZ(''), [])
  assert.deepEqual(parseCompareLogZ('\u0000'), [])
})

test('compare: shortstat parses singular, plural, partial and empty lines', () => {
  assert.deepEqual(parseShortstat(' 1 file changed, 1 insertion(+), 1 deletion(-)\n'), {
    filesChanged: 1,
    additions: 1,
    deletions: 1,
  })
  assert.deepEqual(parseShortstat(' 2 files changed, 10 insertions(+)'), {
    filesChanged: 2,
    additions: 10,
    deletions: 0,
  })
  assert.deepEqual(parseShortstat(' 1 file changed, 3 deletions(-)'), {
    filesChanged: 1,
    additions: 0,
    deletions: 3,
  })
  assert.deepEqual(parseShortstat(' 7 files changed'), { filesChanged: 7, additions: 0, deletions: 0 })
  assert.deepEqual(parseShortstat(''), { filesChanged: 0, additions: 0, deletions: 0 })
  assert.deepEqual(parseShortstat('unexpected output'), { filesChanged: 0, additions: 0, deletions: 0 })
})

test('compare: merge-tree exit 0 means clean, exit 1 lists the conflicted paths only', () => {
  const clean = parseMergeTree({ exitCode: 0, stdout: '4b825dc642cb6eb9a060e54bf8d69288fbee4904\n', stderr: '' })
  assert.deepEqual(clean, { conflicts: [] })

  const conflicted = parseMergeTree({
    exitCode: 1,
    stdout: [
      '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      'f.txt',
      'dir with space/g.txt',
      '',
      'Auto-merging f.txt',
      'CONFLICT (content): Merge conflict in f.txt',
    ].join('\n'),
    stderr: '',
  })
  assert.deepEqual(conflicted.conflicts, ['f.txt', 'dir with space/g.txt'])

  // Informational messages are never mistaken for paths.
  assert.deepEqual(conflicted.conflicts?.includes('Auto-merging f.txt'), false)
})

test('compare: merge-tree decodes git C-quoted and octal-escaped paths', () => {
  // The quoted path is git's C-style form: a literal backslash then octal bytes.
  const quotedUnicode = '"\\303\\274\\303\\261\\303\\256.txt"'
  const result = parseMergeTree({
    exitCode: 1,
    stdout: ['tree-oid', quotedUnicode, '"tab\\tname.txt"', '', 'CONFLICT'].join('\n'),
    stderr: '',
  })
  assert.deepEqual(result.conflicts, ['üñî.txt', 'tab\tname.txt'])
})

test('compare: an unparseable merge-tree answer is unknown, never "no conflicts"', () => {
  const noPaths = parseMergeTree({ exitCode: 1, stdout: 'tree-oid\n\nCONFLICT (content): Merge conflict in x\n', stderr: '' })
  assert.equal(noPaths.conflicts, null)
  assert.ok((noPaths.unsupportedReason ?? '') !== '')

  const empty = parseMergeTree({ exitCode: 1, stdout: '', stderr: '' })
  assert.equal(empty.conflicts, null)
  assert.ok((empty.unsupportedReason ?? '') !== '')

  const unsupported = parseMergeTree({ exitCode: 128, stdout: '', stderr: "error: unknown option `write-tree'\n" })
  assert.equal(unsupported.conflicts, null)
  assert.match(unsupported.unsupportedReason ?? '', /merge-tree/)
  assert.match(unsupported.unsupportedReason ?? '', /unknown option/)

  const spawnFailed = parseMergeTree({ exitCode: null, stdout: '', stderr: '', spawnFailed: true })
  assert.equal(spawnFailed.conflicts, null)
  assert.ok((spawnFailed.unsupportedReason ?? '') !== '')
})

test('compare: the action table follows the documented order', () => {
  const cases: Array<{ facts: Parameters<typeof deriveBranchActions>[0]; kind: string; reason: string }> = [
    { facts: { conflicts: ['f.txt'], ahead: 3, behind: 0, unpushed: 1 }, kind: 'fix-conflicts', reason: 'merge-conflict' },
    { facts: { conflicts: null, ahead: 2, behind: 1, unpushed: null }, kind: 'create-pr', reason: 'no-upstream' },
    { facts: { conflicts: [], ahead: 2, behind: 0, unpushed: 2 }, kind: 'push', reason: 'unpushed-commits' },
    { facts: { conflicts: [], ahead: 0, behind: 4, unpushed: 0 }, kind: 'pull', reason: 'behind-base' },
    { facts: { conflicts: [], ahead: 2, behind: 0, unpushed: 0 }, kind: 'create-pr', reason: 'ahead-of-base' },
    { facts: { conflicts: [], ahead: 0, behind: 0, unpushed: 0 }, kind: 'wait', reason: 'in-sync' },
    { facts: { conflicts: null, ahead: 0, behind: 0, unpushed: null }, kind: 'wait', reason: 'in-sync' },
  ]
  for (const entry of cases) {
    const actions = deriveBranchActions(entry.facts)
    assert.equal(actions.length, 1)
    assert.equal(actions[0]?.kind, entry.kind)
    assert.equal(actions[0]?.reason, entry.reason)
  }
})

test('compare: a base branch must be a safe git revision name', () => {
  assert.equal(isCompareBaseName('main'), true)
  assert.equal(isCompareBaseName('origin/release/1.0'), true)
  assert.equal(isCompareBaseName('a b'), false)
  assert.equal(isCompareBaseName('--evil'), false)
  assert.equal(isCompareBaseName('x..y'), false)
  assert.equal(isCompareBaseName('foo@{1}'), false)
  assert.equal(isCompareBaseName(''), false)
  assert.equal(isCompareBaseName(42), false)
  assert.equal(isCompareBaseName('x'.repeat(201)), false)
  assert.equal(isCompareBaseName('x'.repeat(200)), true)
})

// ---------------------------------------------------------------------------
// B. Branch comparison service
// ---------------------------------------------------------------------------

/** Scripted runner for one healthy repository comparison. */
function healthyRunner(overrides: { log?: string; counts?: string; merge?: Partial<RunResult> } = {}): Runner & { calls: string[][] } {
  return createStubRunner((argv) => {
    const text = argvText(argv)
    if (text.includes('rev-parse --abbrev-ref HEAD')) return { exitCode: 0, stdout: 'feature\n' }
    if (text.includes('--symbolic-full-name')) return { exitCode: 0, stdout: 'origin/feature\n' }
    if (text.includes('rev-parse --verify --quiet')) return { exitCode: 0, stdout: '' }
    if (text.includes('rev-list --left-right --count')) {
      if (text.includes('@{u}')) return { exitCode: 0, stdout: '0\t2\n' }
      return { exitCode: 0, stdout: overrides.counts ?? '1\t2\n' }
    }
    if (text.includes(' log ')) return { exitCode: 0, stdout: overrides.log ?? LOG_FIXTURE }
    if (text.includes('diff --shortstat')) return { exitCode: 0, stdout: ' 3 files changed, 10 insertions(+), 4 deletions(-)\n' }
    if (text.includes('merge-tree')) return { exitCode: 0, stdout: 'tree-oid\n', stderr: '', ...overrides.merge }
    return { exitCode: 0, stdout: '' }
  })
}

test('branch compare: a healthy git comparison reports counts, commits, stats and one action', async () => {
  const repository = makeRepository()
  const runner = healthyRunner()
  const { service } = makeBranchService(repository, runner)
  const result = await service.compare({ repositoryId: repository.id })

  assert.equal(isBranchCompare(result), true)
  assert.equal(result.available, true)
  assert.equal(result.vcsType, 'git')
  assert.equal(result.currentBranch, 'feature')
  assert.equal(result.baseBranch, 'main')
  assert.equal(result.ahead, 2)
  assert.equal(result.behind, 1)
  assert.equal(result.commits.length, 2)
  assert.equal(result.commits[0]?.summary, 'newest subject')
  assert.equal(result.filesChanged, 3)
  assert.equal(result.additions, 10)
  assert.equal(result.deletions, 4)
  assert.deepEqual(result.conflictPaths, [])
  assert.equal(result.unpushed, 2)
  assert.equal(result.hasUpstream, true)
  assert.deepEqual(result.actions, [{ kind: 'push', reason: 'unpushed-commits' }])
  assert.equal(result.computedAt, '2026-02-03T04:05:06.000Z')
  assert.equal(result.warnings, undefined)
  // The log range and the merge probe really describe the resolved base.
  const calls = runner.calls.map(argvText)
  assert.ok(calls.some(call => call.includes('main..HEAD')))
  assert.ok(calls.some(call => call.includes('--shortstat main...HEAD')))
  assert.ok(calls.some(call => call.includes('merge-tree --write-tree --name-only main HEAD')))
})

test('branch compare: conflicts outrank every other action', async () => {
  const repository = makeRepository()
  const runner = healthyRunner({
    merge: {
      exitCode: 1,
      stdout: ['tree-oid', 'f.txt', 'other.txt', '', 'Auto-merging f.txt', 'CONFLICT (content): Merge conflict in f.txt'].join('\n'),
    },
  })
  const { service } = makeBranchService(repository, runner)
  const result = await service.compare({ repositoryId: repository.id })
  assert.deepEqual(result.conflictPaths, ['f.txt', 'other.txt'])
  assert.deepEqual(result.actions, [{ kind: 'fix-conflicts', reason: 'merge-conflict' }])
})

test('branch compare: a merge-tree that cannot run leaves conflicts unknown with a warning', async () => {
  const repository = makeRepository()
  const runner = healthyRunner({ merge: { exitCode: 128, stdout: '', stderr: "error: unknown option 'write-tree'" } })
  const { service } = makeBranchService(repository, runner)
  const result = await service.compare({ repositoryId: repository.id })
  assert.equal(result.conflictPaths, null)
  assert.ok((result.warnings ?? []).some(warning => /merge conflicts could not be checked/.test(warning)))
})

test('branch compare: an explicit base branch is honoured and trimmed', async () => {
  const repository = makeRepository()
  const runner = createStubRunner((argv) => {
    const text = argvText(argv)
    if (text.includes('rev-parse --abbrev-ref HEAD')) return { stdout: 'feature\n' }
    if (text.includes('--symbolic-full-name')) return { exitCode: 128, stderr: 'no upstream' }
    if (text.includes('rev-parse --verify --quiet')) {
      return { exitCode: text.includes('release/1.0^{commit}') ? 0 : 1 }
    }
    if (text.includes('rev-list --left-right --count')) return { stdout: '0\t1\n' }
    if (text.includes(' log ')) return { stdout: LOG_FIXTURE }
    if (text.includes('diff --shortstat')) return { stdout: ' 1 file changed, 1 insertion(+)\n' }
    if (text.includes('merge-tree')) return { stdout: 'tree-oid\n' }
    return {}
  })
  const { service } = makeBranchService(repository, runner)
  const result = await service.compare({ repositoryId: repository.id, baseBranch: '  release/1.0  ' })
  assert.equal(result.baseBranch, 'release/1.0')
  assert.ok(runner.calls.some(argv => argvText(argv).includes('release/1.0..HEAD')))
})

test('branch compare: a missing requested base falls back and says so', async () => {
  const repository = makeRepository({ defaultBranch: undefined })
  const runner = createStubRunner((argv) => {
    const text = argvText(argv)
    if (text.includes('rev-parse --abbrev-ref HEAD')) return { stdout: 'feature\n' }
    if (text.includes('--symbolic-full-name')) return { exitCode: 128 }
    if (text.includes('rev-parse --verify --quiet')) {
      // Only the conventional `master` exists.
      return { exitCode: text.includes('master^{commit}') ? 0 : 1 }
    }
    if (text.includes('rev-list --left-right --count')) return { stdout: '0\t1\n' }
    if (text.includes(' log ')) return { stdout: LOG_FIXTURE }
    if (text.includes('diff --shortstat')) return { stdout: '' }
    if (text.includes('merge-tree')) return { stdout: 'tree-oid\n' }
    return {}
  })
  const { service } = makeBranchService(repository, runner)
  const result = await service.compare({ repositoryId: repository.id, baseBranch: 'nope' })
  assert.equal(result.baseBranch, 'master')
  assert.ok((result.warnings ?? []).some(warning => /requested base branch nope does not exist/.test(warning)))
})

test('branch compare: detached HEAD is available with a null branch and a warning', async () => {
  const repository = makeRepository()
  const runner = createStubRunner((argv) => {
    const text = argvText(argv)
    if (text.includes('rev-parse --abbrev-ref HEAD')) return { exitCode: 0, stdout: 'HEAD\n' }
    if (text.includes('--symbolic-full-name')) return { exitCode: 128, stderr: 'fatal: no upstream' }
    if (text.includes('rev-parse --verify --quiet')) return { exitCode: text.includes('main^{commit}') ? 0 : 1 }
    if (text.includes('rev-list --left-right --count')) return { stdout: '0\t1\n' }
    if (text.includes(' log ')) return { stdout: LOG_FIXTURE }
    if (text.includes('diff --shortstat')) return { stdout: ' 1 file changed, 1 insertion(+)\n' }
    if (text.includes('merge-tree')) return { stdout: 'tree-oid\n' }
    return {}
  })
  const { service } = makeBranchService(repository, runner)
  const result = await service.compare({ repositoryId: repository.id })
  assert.equal(result.available, true)
  assert.equal(result.currentBranch, null)
  assert.equal(result.baseBranch, 'main')
  assert.equal(result.hasUpstream, false)
  assert.equal(result.unpushed, null)
  assert.equal(result.ahead, 1)
  assert.deepEqual(result.actions, [{ kind: 'create-pr', reason: 'no-upstream' }])
  assert.ok((result.warnings ?? []).some(warning => /HEAD is detached/.test(warning)))
})

test('branch compare: an empty repository is available, empty and never throws', async () => {
  const repository = makeRepository({ currentBranch: undefined, defaultBranch: undefined })
  const runner = createStubRunner((argv) => {
    const text = argvText(argv)
    if (text.includes('rev-parse --abbrev-ref HEAD')) {
      return { exitCode: 128, stdout: 'HEAD\n', stderr: "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree." }
    }
    if (text.includes('rev-parse --verify --quiet')) return { exitCode: 1 }
    if (text.includes('--symbolic-full-name')) return { exitCode: 128 }
    return {}
  })
  const { service } = makeBranchService(repository, runner)
  const result = await service.compare({ repositoryId: repository.id })
  assert.equal(isBranchCompare(result), true)
  assert.equal(result.available, true)
  assert.equal(result.currentBranch, null)
  assert.equal(result.baseBranch, null)
  assert.equal(result.ahead, 0)
  assert.equal(result.behind, 0)
  assert.deepEqual(result.commits, [])
  assert.equal(result.filesChanged, 0)
  assert.equal(result.additions, undefined)
  assert.equal(result.deletions, undefined)
  assert.equal(result.conflictPaths, null)
  assert.equal(result.unpushed, null)
  assert.equal(result.hasUpstream, false)
  assert.deepEqual(result.actions, [{ kind: 'wait', reason: 'in-sync' }])
  assert.ok((result.warnings ?? []).some(warning => /no commits yet/.test(warning)))
})

test('branch compare: SVN is reported as unavailable with a safe empty payload', async () => {
  const repository = makeRepository({
    id: 'svn:c:/fake/wc',
    vcsType: 'svn',
    rootPath: 'C:/fake/wc',
    currentBranch: 'trunk',
    defaultBranch: undefined,
  })
  const runner = createStubRunner(() => undefined)
  const { service } = makeBranchService(repository, runner)
  const result = await service.compare({ repositoryId: repository.id })
  assert.equal(isBranchCompare(result), true)
  assert.equal(result.available, false)
  assert.equal(result.unsupportedReason, 'svn-branches-not-compared')
  assert.equal(result.vcsType, 'svn')
  assert.equal(result.currentBranch, 'trunk')
  assert.equal(result.baseBranch, null)
  assert.equal(result.ahead, 0)
  assert.equal(result.behind, 0)
  assert.deepEqual(result.commits, [])
  assert.equal(result.filesChanged, 0)
  assert.equal(result.conflictPaths, null)
  assert.equal(result.unpushed, null)
  assert.equal(result.hasUpstream, false)
  assert.ok(result.actions.length > 0)
  assert.deepEqual(runner.calls, [])
})

test('branch compare: a missing/unstartable git client is unavailable instead of a crash', async () => {
  const repository = makeRepository()
  const runner = createStubRunner((argv) => {
    if (argvText(argv).includes('rev-parse --abbrev-ref HEAD')) {
      return { exitCode: null, stdout: '', stderr: '', spawnFailed: true, failureMessage: 'ENOENT git' }
    }
    return {}
  })
  const { service } = makeBranchService(repository, runner)
  const result = await service.compare({ repositoryId: repository.id })
  assert.equal(result.available, false)
  assert.equal(result.unsupportedReason, 'git-client-missing')
  assert.ok((result.warnings ?? []).some(warning => /git could not be started/.test(warning)))
})

test('branch compare: an unknown repository fails through the gated resolver', async () => {
  const repository = makeRepository()
  const { service } = makeBranchService(repository, healthyRunner())
  await assert.rejects(
    async () => service.compare({ repositoryId: 'git:c:/elsewhere' }),
    (error: unknown) => (error as ServiceErrorType).code === 'unknown-repository',
  )
})

test('branch compare: comparing the branch with itself costs no comparison commands', async () => {
  const repository = makeRepository()
  const runner = createStubRunner((argv) => {
    const text = argvText(argv)
    if (text.includes('rev-parse --abbrev-ref HEAD')) return { stdout: 'main\n' }
    if (text.includes('--symbolic-full-name')) return { exitCode: 128 }
    if (text.includes('rev-parse --verify --quiet')) return { exitCode: text.includes('main^{commit}') ? 0 : 1 }
    return {}
  })
  const { service } = makeBranchService(repository, runner)
  const result = await service.compare({ repositoryId: repository.id })
  assert.equal(result.baseBranch, 'main')
  assert.equal(result.currentBranch, 'main')
  assert.equal(result.ahead, 0)
  assert.equal(result.behind, 0)
  assert.deepEqual(result.conflictPaths, [])
  assert.equal(result.additions, 0)
  assert.equal(result.deletions, 0)
  assert.deepEqual(result.actions, [{ kind: 'wait', reason: 'in-sync' }])
  const compared = runner.calls.map(argvText).filter(text => text.includes('rev-list') || text.includes('merge-tree') || text.includes(' log '))
  assert.deepEqual(compared, [])
})

// ---------------------------------------------------------------------------
// B. Route wiring
// ---------------------------------------------------------------------------

/** Minimal fake response capturing the JSON envelope. */
class FakeResponse {
  statusCode = 0
  payload = ''
  writeHead(status: number): this {
    this.statusCode = status
    return this
  }
  end(chunk?: string): void {
    if (typeof chunk === 'string') this.payload = chunk
  }
}

/** Minimal fake request with a JSON body. */
class FakeRequest {
  readonly method = 'POST'
  readonly url = '/vcs/branch/compare'
  readonly headers: Record<string, string> = { 'content-type': 'application/json', host: '127.0.0.1:2011' }
  readonly socket = { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' }
  private readonly body: string

  constructor(body: unknown) {
    this.body = typeof body === 'string' ? body : JSON.stringify(body)
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    yield Buffer.from(this.body, 'utf8')
  }
}

/** A comparison payload used by the route stub. */
function sampleCompare(repository: string): BranchCompare {
  return {
    repositoryId: repository,
    vcsType: 'git',
    currentBranch: 'feature',
    baseBranch: 'main',
    available: true,
    ahead: 1,
    behind: 0,
    commits: [],
    filesChanged: 0,
    additions: 0,
    deletions: 0,
    conflictPaths: [],
    unpushed: null,
    hasUpstream: false,
    actions: [{ kind: 'create-pr', reason: 'no-upstream' }],
    computedAt: '2026-02-03T04:05:06.000Z',
  }
}

/** Register the routes over stubs and return the captured handler. */
function registerRoutesForTest(): {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  queries: BranchCompareQuery[]
} {
  const queries: BranchCompareQuery[] = []
  const registered: Array<{ path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }> = []
  const ctx = {
    logger: { warn: () => {} },
    webServer: {
      register(spec: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) {
        registered.push({ path: spec.path, handler: spec.handler })
        return () => {}
      },
    },
  }
  const deps: VcsRoutesDeps = {
    timeline: {} as unknown as TimelineService,
    operations: {} as unknown as OperationService,
    pullRequests: {} as unknown as PullRequestService,
    branch: {
      async compare(query) {
        queries.push(query)
        return sampleCompare(query.repositoryId)
      },
    },
    diagnostics: async () => ({
      pluginVersion: '0.1.0',
      dshVersion: null,
      platform: 'win32 x64',
      dataDir: 'C:/data',
      gitVersion: 'git version 2.45.1',
      svnVersion: null,
      workspaceCount: 0,
      warnings: [],
    }),
    log: () => {},
  }
  registerVcsRoutes(ctx as unknown as Context, deps)
  const entry = registered[0]
  assert.ok(entry !== undefined)
  assert.equal(entry.path, '/vcs')
  return { handler: entry.handler, queries }
}

test('route: POST /vcs/branch/compare parses and forwards the optional base branch', async () => {
  const { handler, queries } = registerRoutesForTest()
  const res = new FakeResponse()
  await handler(
    new FakeRequest({ repositoryId: 'git:c:/fake/repo', baseBranch: '  release/1.0  ' }) as unknown as IncomingMessage,
    res as unknown as ServerResponse,
  )
  assert.equal(res.statusCode, 200)
  const envelope = JSON.parse(res.payload) as { ok: boolean; value: BranchCompare }
  assert.equal(envelope.ok, true)
  assert.equal(isBranchCompare(envelope.value), true)
  assert.deepEqual(queries, [{ repositoryId: 'git:c:/fake/repo', baseBranch: 'release/1.0' }])
})

test('route: POST /vcs/branch/compare omits an absent base branch and rejects a non-string one', async () => {
  const { handler, queries } = registerRoutesForTest()
  const res = new FakeResponse()
  await handler(
    new FakeRequest({ repositoryId: 'git:c:/fake/repo' }) as unknown as IncomingMessage,
    res as unknown as ServerResponse,
  )
  assert.deepEqual(queries, [{ repositoryId: 'git:c:/fake/repo' }])

  const bad = new FakeResponse()
  await handler(
    new FakeRequest({ repositoryId: 'git:c:/fake/repo', baseBranch: 42 }) as unknown as IncomingMessage,
    bad as unknown as ServerResponse,
  )
  const envelope = JSON.parse(bad.payload) as { ok: boolean; error: { code: string } }
  assert.equal(envelope.ok, false)
  assert.equal(envelope.error.code, 'invalid-request')
  assert.equal(queries.length, 1)
})

test('route: POST /vcs/branch/compare requires a repository id', async () => {
  const { handler } = registerRoutesForTest()
  const res = new FakeResponse()
  await handler(
    new FakeRequest({ baseBranch: 'main' }) as unknown as IncomingMessage,
    res as unknown as ServerResponse,
  )
  const envelope = JSON.parse(res.payload) as { ok: boolean; error: { code: string; message: string } }
  assert.equal(envelope.ok, false)
  assert.equal(envelope.error.code, 'invalid-request')
  assert.match(envelope.error.message, /repositoryId/)
})

// ---------------------------------------------------------------------------
// B. Real git integration (optional: needs a git client on PATH)
// ---------------------------------------------------------------------------

/** Whether the machine has a runnable git on PATH. */
async function hasGit(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version'], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

const gitMissing = !(await hasGit())

/** A real-subprocess runner used only by the integration test. */
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
        })
        return { exitCode: 0, stdout, stderr }
      } catch (error: unknown) {
        const failure = error as { code?: number | string; killed?: boolean; stdout?: string; stderr?: string; message?: string }
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

/** Run one git command for test setup. */
async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
  return stdout
}

/**
 * Build a temp repository where `feature` has two commits and `main` has one,
 * both after a shared base commit.
 */
async function makeComparisonRepo(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'dvt-insight-'))
  await git(dir, 'init', '-q', '-b', 'main')
  await git(dir, 'config', 'user.name', 'Insight Tester')
  await git(dir, 'config', 'user.email', 'insight@example.com')
  await writeFile(join(dir, 'f.txt'), 'line one\n', 'utf8')
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-q', '-m', 'base commit')
  await git(dir, 'checkout', '-q', '-b', 'feature')
  await writeFile(join(dir, 'g.txt'), 'feature one\n', 'utf8')
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-q', '-m', 'feature one')
  await writeFile(join(dir, 'f.txt'), 'feature change\n', 'utf8')
  await git(dir, 'commit', '-q', '-am', 'feature two')
  await git(dir, 'checkout', '-q', 'main')
  await writeFile(join(dir, 'h.txt'), 'main only\n', 'utf8')
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-q', '-m', 'main only')
  await git(dir, 'checkout', '-q', 'feature')
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 })
    },
  }
}

test('integration: real git reports ahead/behind, commits, stats and a clean merge', { skip: gitMissing }, async () => {
  const repo = await makeComparisonRepo()
  try {
    const root = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: repo.dir, encoding: 'utf8', windowsHide: true })
    const canonical = root.stdout.trim()
    const repository = makeRepository({
      id: repositoryId('git', canonical),
      rootPath: canonical,
      displayName: 'insight',
    })
    const service = createBranchService({ resolver: createStubResolver(repository), runner: nodeRunner() })
    const result = await service.compare({ repositoryId: repository.id })

    assert.equal(result.available, true)
    assert.equal(result.currentBranch, 'feature')
    assert.equal(result.baseBranch, 'main')
    assert.equal(result.ahead, 2)
    assert.equal(result.behind, 1)
    assert.deepEqual(result.commits.map(commit => commit.summary), ['feature two', 'feature one'])
    assert.equal(result.commits[0]?.author, 'Insight Tester')
    assert.match(result.commits[0]?.timestamp ?? '', /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(result.filesChanged, 2)
    assert.equal(result.additions, 2)
    assert.equal(result.deletions, 1)
    assert.deepEqual(result.conflictPaths, [])
    assert.equal(result.hasUpstream, false)
    assert.equal(result.unpushed, null)
    assert.deepEqual(result.actions, [{ kind: 'create-pr', reason: 'no-upstream' }])
  } finally {
    await repo.cleanup()
  }
})

test('integration: real git merge-tree detects a conflicting file', { skip: gitMissing }, async () => {
  const repo = await makeComparisonRepo()
  try {
    // Both sides now edit f.txt after the shared base: a real content conflict.
    await git(repo.dir, 'checkout', '-q', 'main')
    await writeFile(join(repo.dir, 'f.txt'), 'main change\n', 'utf8')
    await git(repo.dir, 'commit', '-q', '-am', 'main changes f')
    await git(repo.dir, 'checkout', '-q', 'feature')

    const root = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: repo.dir, encoding: 'utf8', windowsHide: true })
    const canonical = root.stdout.trim()
    const repository = makeRepository({ id: repositoryId('git', canonical), rootPath: canonical })
    const service = createBranchService({ resolver: createStubResolver(repository), runner: nodeRunner() })
    const result = await service.compare({ repositoryId: repository.id })

    assert.deepEqual(result.conflictPaths, ['f.txt'])
    assert.deepEqual(result.actions, [{ kind: 'fix-conflicts', reason: 'merge-conflict' }])
    assert.equal(result.ahead, 2)
    assert.equal(result.behind, 2)
  } finally {
    await repo.cleanup()
  }
})

test('integration: real git detached HEAD still compares against the default branch', { skip: gitMissing }, async () => {
  const repo = await makeComparisonRepo()
  try {
    await git(repo.dir, 'checkout', '-q', '--detach', 'HEAD')
    const root = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: repo.dir, encoding: 'utf8', windowsHide: true })
    const canonical = root.stdout.trim()
    const repository = makeRepository({ id: repositoryId('git', canonical), rootPath: canonical })
    const service = createBranchService({ resolver: createStubResolver(repository), runner: nodeRunner() })
    const result = await service.compare({ repositoryId: repository.id })

    assert.equal(result.available, true)
    assert.equal(result.currentBranch, null)
    assert.equal(result.baseBranch, 'main')
    assert.equal(result.hasUpstream, false)
    assert.ok((result.warnings ?? []).some(warning => /HEAD is detached/.test(warning)))
  } finally {
    await repo.cleanup()
  }
})
