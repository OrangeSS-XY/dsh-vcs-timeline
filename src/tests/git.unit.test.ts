/**
 * Pure unit tests for the Git command builders and machine-readable parsers.
 *
 * No repository, process, network or filesystem is touched: every fixture is
 * a synthetic NUL-delimited stream shaped like the real Git 2.45.1 output
 * verified during development. Integration behaviour against real temporary
 * repositories lives in `git.integration.test.ts`.
 * @module dsh-vcs-timeline/tests/git.unit.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  branchFromDecoration,
  commitArgs,
  commitToEvent,
  hasBinaryHeader,
  isEmptyRepositoryError,
  isCommitHash,
  isSafeBranchName,
  isSafeRemoteName,
  logArgs,
  logStatsArgs,
  mergeChangedFiles,
  parseLogOutput,
  parseLogStatsZ,
  parseNameStatusZ,
  parseNumstatZ,
  parseRemotes,
  parseStatusV1,
  parseStatusV2,
  pushArgs,
} from '../host/adapters/git/commands.ts'

/** Join eight log fields into one `-z` record (NUL between fields, NUL terminator). */
function logRecord(fields: readonly string[]): string {
  return `${fields.join('\u0000')}\u0000`
}

test('parseLogOutput decodes NUL records with unicode, multiline and empty bodies', () => {
  const multiline = logRecord([
    'a'.repeat(40),
    `${'b'.repeat(40)} ${'c'.repeat(40)}`,
    '测试 User',
    'unicode@example.com',
    '2026-01-02T03:04:05+08:00',
    'HEAD -> main, tag: v1.0',
    'unicode 中文 subject',
    'body line 1\nbody line 2\n',
  ])
  const emptyBody = logRecord([
    'd'.repeat(40),
    '',
    'Bob',
    'bob@example.com',
    '2026-01-01T00:00:00+08:00',
    '',
    'simple subject',
    '',
  ])
  const commits = parseLogOutput(multiline + emptyBody)

  assert.equal(parseLogOutput('').length, 0)
  assert.equal(commits.length, 2)

  const first = commits[0]
  assert.ok(first !== undefined)
  assert.equal(first.hash, 'a'.repeat(40))
  assert.deepEqual(first.parents, ['b'.repeat(40), 'c'.repeat(40)])
  assert.equal(first.author, '测试 User')
  assert.equal(first.authorEmail, 'unicode@example.com')
  assert.equal(first.authorDate, '2026-01-02T03:04:05+08:00')
  assert.equal(first.decorations, 'HEAD -> main, tag: v1.0')
  assert.equal(first.subject, 'unicode 中文 subject')
  // The record separator is NUL, so the trailing newline of `%b` is trimmed.
  assert.equal(first.body, 'body line 1\nbody line 2')

  const second = commits[1]
  assert.ok(second !== undefined)
  assert.deepEqual(second.parents, [])
  assert.equal(second.decorations, '')
  assert.equal(second.body, '')
})

test('parseNameStatusZ handles rename and copy streams', () => {
  const stream = [
    'M', 'a.txt',
    'A', 'bin.dat',
    'R100', 'old name.txt', 'new name.txt',
    'C75', 'src.txt', 'dst.txt',
    '',
  ].join('\u0000')

  assert.deepEqual(parseNameStatusZ(stream), [
    { status: 'M', path: 'a.txt' },
    { status: 'A', path: 'bin.dat' },
    { status: 'R100', path: 'new name.txt', oldPath: 'old name.txt' },
    { status: 'C75', path: 'dst.txt', oldPath: 'src.txt' },
  ])
  assert.deepEqual(parseNameStatusZ(''), [])
})

test('parseNumstatZ handles binary entries and the rename empty-path form', () => {
  const stream = [
    '1\t2\ta.txt',
    '-\t-\tbin.dat',
    '0\t0\t', 'old name.txt', 'new name.txt',
    '',
  ].join('\u0000')

  const entries = parseNumstatZ(stream)
  assert.equal(entries.length, 3)

  const modified = entries[0]
  assert.ok(modified !== undefined)
  assert.equal(modified.path, 'a.txt')
  assert.equal(modified.additions, 1)
  assert.equal(modified.deletions, 2)
  assert.equal(modified.binary, false)

  const binary = entries[1]
  assert.ok(binary !== undefined)
  assert.equal(binary.path, 'bin.dat')
  assert.equal(binary.binary, true)
  assert.equal(binary.additions, undefined)
  assert.equal(binary.deletions, undefined)

  const renamed = entries[2]
  assert.ok(renamed !== undefined)
  assert.equal(renamed.oldPath, 'old name.txt')
  assert.equal(renamed.path, 'new name.txt')
  assert.equal(renamed.additions, 0)
  assert.equal(renamed.deletions, 0)
})

test('parseLogStatsZ aggregates numeric, binary and renamed files per commit', () => {
  const hashA = 'a'.repeat(40)
  const hashB = 'b'.repeat(40)
  const stream = [
    `\u0001${hashA}`,
    '\n2\t2\ta.txt',
    '-\t-\tbin.dat',
    '0\t0\t',
    'old name.txt',
    'new name.txt',
    '',
    `\u0001${hashB}`,
    '\n3\t0\ta.txt',
    '',
  ].join('\u0000')

  const stats = parseLogStatsZ(stream)
  assert.equal(stats.size, 2)
  // a.txt (2/2) + binary bin.dat + one rename = three changed files.
  assert.deepEqual(stats.get(hashA), { filesChanged: 3, additions: 2, deletions: 2, binaryFiles: 1 })
  assert.deepEqual(stats.get(hashB), { filesChanged: 1, additions: 3, deletions: 0, binaryFiles: 0 })
  assert.equal(parseLogStatsZ('').size, 0)
})

test('parseLogStatsZ tolerates unknown tokens, leading newlines and truncated renames', () => {
  const hashC = 'c'.repeat(40)
  const hashD = 'd'.repeat(40)
  const tolerated = [
    `\u0001${hashC}`,
    'not-a-numstat-line',
    '1\t2',
    '\u0001',
    '5\t5\tafter-a-reset.txt',
    `\u0001\n${hashD}`,
    '\n0\t0\t',
    'old.txt',
    'new.txt',
    '',
  ].join('\u0000')
  const stats = parseLogStatsZ(tolerated)
  assert.equal(stats.size, 2)
  // Unknown tokens and stats before any commit token are ignored, never thrown.
  assert.deepEqual(stats.get(hashC), { filesChanged: 0, additions: 0, deletions: 0, binaryFiles: 0 })
  // The hash may arrive with a leading newline; the rename counts one file.
  assert.deepEqual(stats.get(hashD), { filesChanged: 1, additions: 0, deletions: 0, binaryFiles: 0 })

  // A rename record whose deferred paths are missing must not throw or hang.
  const truncated = parseLogStatsZ(`\u0001${hashD}\u00000\t0\t`)
  assert.deepEqual(truncated.get(hashD), { filesChanged: 1, additions: 0, deletions: 0, binaryFiles: 0 })
})

test('parseStatusV2 decodes branch headers and record types 1, 2, u and ?', () => {
  const stream = [
    '# branch.oid ' + 'a'.repeat(40),
    '# branch.head main',
    '# branch.ab +2 -1',
    '1 M. N... 100644 100644 100644 aaa bbb staged.txt',
    '2 R. N... 100644 100644 100644 aaa bbb R100 new name.txt',
    'old name.txt',
    'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.txt',
    '? untracked file.txt',
  ].join('\u0000')

  const status = parseStatusV2(stream)
  assert.equal(status.branch, 'main')
  assert.equal(status.head, 'a'.repeat(40))
  assert.equal(status.ahead, 2)
  assert.equal(status.behind, 1)
  assert.equal(status.truncated, false)
  assert.deepEqual(status.conflicts, ['conflict.txt'])
  assert.deepEqual(status.entries.map(entry => [entry.path, entry.status]), [
    ['staged.txt', 'M'],
    ['new name.txt', 'R'],
    ['conflict.txt', 'U'],
    ['untracked file.txt', '?'],
  ])
  const staged = status.entries[0]
  assert.ok(staged !== undefined)
  assert.equal(staged.staged, true)
  const conflict = status.entries[2]
  assert.ok(conflict !== undefined)
  assert.equal(conflict.status, 'U')

  const detached = parseStatusV2('# branch.oid abc\u0000# branch.head (detached)\u0000')
  assert.equal(detached.branch, undefined)
  assert.equal(detached.head, 'abc')

  const empty = parseStatusV2('')
  assert.deepEqual(empty.entries, [])
  assert.deepEqual(empty.conflicts, [])
  assert.equal(empty.truncated, false)
})

test('parseStatusV2 caps the entry list and reports truncation', () => {
  const status = parseStatusV2('? a\u0000? b\u0000? c\u0000', 2)
  assert.equal(status.truncated, true)
  assert.deepEqual(status.entries.map(entry => entry.path), ['a', 'b'])
})

test('parseStatusV1 parses the fallback porcelain stream records it supports', () => {
  const status = parseStatusV1('M  a.txt\u0000?? new.txt\u0000UU conflict.txt\u0000')
  assert.deepEqual(status.entries.map(entry => [entry.path, entry.status]), [
    ['a.txt', 'M'],
    ['new.txt', '?'],
    ['conflict.txt', 'U'],
  ])
  assert.deepEqual(status.conflicts, ['conflict.txt'])
  assert.equal(status.clean, false)

  const truncated = parseStatusV1('?? a\u0000?? b\u0000', 1)
  assert.equal(truncated.truncated, true)
  assert.equal(truncated.entries.length, 1)
})

test('parseRemotes redacts credentials and deduplicates fetch/push URLs', () => {
  const stdout = [
    'origin\thttps://user:supersecret@example.com/org/repo.git (fetch)',
    'origin\thttps://user:supersecret@example.com/org/repo.git (push)',
    'upstream\thttps://example.com/other.git?token=abc123&ref=main (fetch)',
    '',
  ].join('\n')

  const urls = parseRemotes(stdout)
  assert.deepEqual(urls, [
    'https://example.com/org/repo.git',
    'https://example.com/other.git?token=***&ref=main',
  ])
  for (const url of urls) {
    assert.ok(!url.includes('supersecret'))
    assert.ok(!url.includes('user:'))
    assert.ok(!url.includes('abc123'))
  }
})

test('isCommitHash accepts full hashes and refuses option-like or non-hex input', () => {
  assert.equal(isCommitHash('a'.repeat(40)), true)
  assert.equal(isCommitHash('A'.repeat(40)), true)
  assert.equal(isCommitHash('0'.repeat(64)), true)
  assert.equal(isCommitHash('HEAD'), false)
  assert.equal(isCommitHash('--all'), false)
  assert.equal(isCommitHash('main'), false)
  assert.equal(isCommitHash(''), false)
  assert.equal(isCommitHash('abc'), false)
  assert.equal(isCommitHash('g'.repeat(40)), false)
  assert.equal(isCommitHash('a'.repeat(65)), false)
  assert.equal(isCommitHash(42), false)
  assert.equal(isCommitHash(undefined), false)
})

test('isSafeBranchName and isSafeRemoteName refuse option and shell-shaped input', () => {
  assert.equal(isSafeBranchName('main'), true)
  assert.equal(isSafeBranchName('feature/x-1'), true)
  assert.equal(isSafeBranchName('-Delete'), false)
  assert.equal(isSafeBranchName('a b'), false)
  assert.equal(isSafeBranchName('a..b'), false)
  assert.equal(isSafeBranchName('a;rm -rf /'), false)
  assert.equal(isSafeBranchName('a|b'), false)
  assert.equal(isSafeBranchName(''), false)
  assert.equal(isSafeBranchName(7), false)

  assert.equal(isSafeRemoteName('origin'), true)
  assert.equal(isSafeRemoteName('upstream-2'), true)
  assert.equal(isSafeRemoteName('--upload-pack=evil'), false)
  assert.equal(isSafeRemoteName('a&b'), false)
  assert.equal(isSafeRemoteName('a`b'), false)
  assert.equal(isSafeRemoteName(''), false)
})

test('isEmptyRepositoryError distinguishes an unborn HEAD from unrelated failures', () => {
  assert.equal(isEmptyRepositoryError("fatal: your current branch 'main' does not have any commits yet"), true)
  assert.equal(isEmptyRepositoryError("fatal: bad revision 'HEAD'"), true)
  assert.equal(isEmptyRepositoryError("fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree."), true)
  assert.equal(isEmptyRepositoryError('fatal: not a git repository (or any of the parent directories): .git'), false)
  assert.equal(isEmptyRepositoryError('fatal: Authentication failed for repository'), false)
  assert.equal(isEmptyRepositoryError(''), false)
})

test('branchFromDecoration prefers HEAD and never invents remote branches', () => {
  assert.equal(branchFromDecoration('HEAD -> main, tag: v1.0'), 'main')
  assert.equal(branchFromDecoration('tag: v1.0, feature'), 'feature')
  assert.equal(branchFromDecoration('origin/main'), undefined)
  assert.equal(branchFromDecoration('tag: v1.0'), undefined)
  assert.equal(branchFromDecoration(''), undefined)
})

test('mergeChangedFiles joins stats, keeps rename oldPath and omits binary counts', () => {
  const nameStatus = parseNameStatusZ([
    'M', 'a.txt',
    'A', 'bin.dat',
    'R100', 'old name.txt', 'new name.txt',
    'C75', 'src.txt', 'dst.txt',
    '',
  ].join('\u0000'))
  const numstat = parseNumstatZ([
    '1\t2\ta.txt',
    '-\t-\tbin.dat',
    '0\t0\t', 'old name.txt', 'new name.txt',
    '',
  ].join('\u0000'))

  const merged = mergeChangedFiles(nameStatus, numstat, 10)
  assert.equal(merged.truncated, false)
  assert.deepEqual(merged.files, [
    { path: 'a.txt', status: 'modified', additions: 1, deletions: 2 },
    { path: 'bin.dat', status: 'added', binary: true },
    { path: 'new name.txt', oldPath: 'old name.txt', status: 'renamed', additions: 0, deletions: 0 },
    { path: 'dst.txt', oldPath: 'src.txt', status: 'copied' },
  ])

  const capped = mergeChangedFiles(nameStatus, numstat, 1)
  assert.equal(capped.truncated, true)
  assert.equal(capped.files.length, 1)
})

test('commitToEvent maps one parsed commit onto a repository event', () => {
  const event = commitToEvent(
    {
      hash: 'a'.repeat(40),
      parents: ['b'.repeat(40), 'c'.repeat(40)],
      author: 'Ann',
      authorEmail: 'ann@example.com',
      authorDate: '2026-01-02T03:04:05+08:00',
      decorations: 'HEAD -> main',
      subject: 'merge: 中文 subject',
      body: '',
    },
    'git:/tmp/repo',
  )

  assert.equal(event.schemaVersion, 1)
  assert.equal(event.vcsType, 'git')
  assert.equal(event.eventType, 'commit')
  assert.equal(event.source, 'repository')
  assert.equal(event.repositoryId, 'git:/tmp/repo')
  assert.equal(event.actor, 'Ann')
  assert.equal(event.summary, 'merge: 中文 subject')
  assert.equal(event.commitHash, 'a'.repeat(40))
  assert.deepEqual(event.parentHashes, ['b'.repeat(40), 'c'.repeat(40)])
  assert.equal(event.branch, 'main')
  assert.equal(event.changeSetId, 'git:/tmp/repo:' + 'a'.repeat(40))
  // Author date is normalized to UTC while keeping the instant.
  assert.equal(event.timestamp, '2026-01-01T19:04:05.000Z')
  assert.equal(event.metadata?.parentCount, 2)
  assert.equal(event.metadata?.authorEmail, 'ann@example.com')
})

test('argv builders keep user input inside single argv elements (never a shell string)', () => {
  const logArgv = logArgs({
    skip: 2,
    limit: 3,
    author: 'a b; rm -rf /',
    text: 'x;y&&z',
    since: '2026-01-01T00:00:00.000Z',
  })
  assert.ok(Array.isArray(logArgv))
  assert.equal(logArgv[0], 'git')
  assert.equal(logArgv[1], '--no-pager')
  assert.ok(logArgv.includes('--author=a b; rm -rf /'))
  assert.ok(logArgv.includes('--grep=x;y&&z'))
  assert.ok(logArgv.includes('--since=2026-01-01T00:00:00.000Z'))
  assert.ok(logArgv.includes('--max-count=3'))
  assert.ok(logArgv.includes('--skip=2'))
  assert.ok(logArgv.every(argument => typeof argument === 'string'))

  // The stats invocation shares every filter with the history invocation.
  const statsArgv = logStatsArgs({
    skip: 2,
    limit: 3,
    author: 'a b; rm -rf /',
    text: 'x;y&&z',
    since: '2026-01-01T00:00:00.000Z',
  })
  const filterArgs = (argv: readonly string[]): string[] => argv.filter(argument =>
    argument.startsWith('--author=')
    || argument.startsWith('--grep=')
    || argument.startsWith('--since=')
    || argument.startsWith('--until=')
    || argument === '--fixed-strings'
    || argument === '--regexp-ignore-case')
  assert.deepEqual(filterArgs(statsArgv), filterArgs(logArgv))
  assert.ok(statsArgv.includes('--numstat'))
  assert.ok(statsArgv.includes('--format=\u0001%H'))
  assert.ok(statsArgv.includes('--max-count=3'))
  assert.ok(statsArgv.includes('--skip=2'))
  assert.ok(statsArgv.includes('--author=a b; rm -rf /'))
  assert.ok(statsArgv.includes('--grep=x;y&&z'))

  const commitArgv = commitArgs('msg; rm -rf / && echo pwned')
  assert.deepEqual(commitArgv.slice(-2), ['-m', 'msg; rm -rf / && echo pwned'])
  assert.equal(commitArgv[0], 'git')

  const pushArgv = pushArgs('origin', 'feature/x')
  assert.deepEqual(pushArgv.slice(-3), ['--porcelain', 'origin', 'feature/x'])
  assert.equal(pushArgv[0], 'git')
})

test('hasBinaryHeader detects the Git binary placeholder only', () => {
  assert.equal(hasBinaryHeader('diff --git a/bin.dat b/bin.dat\nBinary files /dev/null and b/bin.dat differ\n'), true)
  assert.equal(hasBinaryHeader('diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n'), false)
  assert.equal(hasBinaryHeader(''), false)
})
