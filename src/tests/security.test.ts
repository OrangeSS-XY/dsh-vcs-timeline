/**
 * Security primitive tests: credential redaction, repository-relative path
 * validation, path containment, cursor round-trips, and UTF-8 truncation.
 * @module dsh-vcs-timeline/tests/security.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampInt,
  decodeCursor,
  encodeCursor,
  isInside,
  joinRepoPath,
  normalizeRepoRelativePath,
  parseIsoTimestamp,
  redactText,
  redactUrl,
  repositoryId,
  safeErrorMessage,
  truncateUtf8,
} from '../host/security.ts'

test('redactUrl strips userinfo and token query parameters', () => {
  assert.equal(redactUrl('https://user:secret@example.com/org/repo.git'), 'https://example.com/org/repo.git')
  assert.equal(redactUrl('https://example.com/repo?token=abc123&x=1'), 'https://example.com/repo?token=***&x=1')
  assert.equal(redactUrl('git@github.com:org/repo.git'), 'git@github.com:org/repo.git')
  assert.equal(redactUrl('ssh://git:pass@host/repo'), 'ssh://host/repo')
})

test('redactText masks credentials in free text and private keys', () => {
  const message = 'fatal: https://bob:hunter2@example.com/repo password=hunter2 Authorization: Bearer abc.def'
  const redacted = redactText(message)
  assert.ok(!redacted.includes('hunter2'))
  assert.ok(!redacted.includes('abc.def'))
  assert.ok(redacted.includes('***'))
  const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----'
  assert.ok(!redactText(key).includes('MIIabc'))
})

test('safeErrorMessage bounds and redacts', () => {
  const long = `x`.repeat(900) + ' token=abcdef'
  const result = safeErrorMessage(new Error(long), 100)
  assert.ok(result.length <= 101)
  assert.ok(!result.includes('abcdef'))
})

test('normalizeRepoRelativePath accepts repository paths and rejects escapes', () => {
  assert.equal(normalizeRepoRelativePath('src/a.ts'), 'src/a.ts')
  assert.equal(normalizeRepoRelativePath('./src//a.ts'), 'src/a.ts')
  assert.equal(normalizeRepoRelativePath('src\\a.ts'), 'src/a.ts')
  assert.equal(normalizeRepoRelativePath('中文 空格 #1.txt'), '中文 空格 #1.txt')
  assert.equal(normalizeRepoRelativePath('../etc/passwd'), null)
  assert.equal(normalizeRepoRelativePath('src/../../etc/passwd'), null)
  assert.equal(normalizeRepoRelativePath('/etc/passwd'), null)
  assert.equal(normalizeRepoRelativePath('C:/Windows/win.ini'), null)
  assert.equal(normalizeRepoRelativePath(''), null)
  assert.equal(normalizeRepoRelativePath('a\0b'), null)
})

test('isInside and joinRepoPath keep paths under the root', () => {
  const root = process.platform === 'win32' ? 'C:\\repo' : '/repo'
  const child = process.platform === 'win32' ? 'C:\\repo\\src\\a.ts' : '/repo/src/a.ts'
  const outside = process.platform === 'win32' ? 'C:\\other\\a.ts' : '/other/a.ts'
  assert.equal(isInside(root, child), true)
  assert.equal(isInside(root, outside), false)
  const joined = joinRepoPath(root, 'src/a.ts')
  assert.ok(joined !== null && joined.endsWith('a.ts'))
  assert.equal(joinRepoPath(root, '../outside'), null)
})

test('cursor codec round-trips and rejects malformed input', () => {
  const cursor = encodeCursor({ o: 42, r: '10' })
  assert.deepEqual(decodeCursor(cursor), { o: 42, r: '10' })
  assert.equal(decodeCursor('not-a-cursor'), null)
  assert.equal(decodeCursor(''), null)
  assert.equal(decodeCursor(null), null)
})

test('truncateUtf8 never splits a multi-byte sequence', () => {
  const text = '中文路径abc'
  const truncated = truncateUtf8(text, 7)
  assert.equal(truncated.truncated, true)
  assert.ok(!truncated.text.includes('\uFFFD'))
  const whole = truncateUtf8('abc', 10)
  assert.deepEqual(whole, { text: 'abc', truncated: false })
})

test('numeric and timestamp helpers clamp and validate', () => {
  assert.equal(clampInt(5, 1, 10, 3), 5)
  assert.equal(clampInt(50, 1, 10, 3), 10)
  assert.equal(clampInt('x', 1, 10, 3), 3)
  assert.equal(parseIsoTimestamp('2026-01-02T03:04:05Z'), '2026-01-02T03:04:05.000Z')
  assert.equal(parseIsoTimestamp('nope'), null)
})

test('repositoryId is stable and normalized', () => {
  const id = repositoryId('git', 'C:\\Repo\\')
  assert.ok(id.startsWith('git:'))
  assert.ok(!id.includes('\\'))
  assert.equal(id, repositoryId('git', 'C:\\Repo'))
})
