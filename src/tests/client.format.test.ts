/**
 * Client pure-helper tests: formatting, diff classification, error mapping,
 * and locale dictionaries.
 * @module dsh-vcs-timeline/tests/client.format.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  apiErrorKey,
  diffLineClassName,
  diffLineKind,
  diffLines,
  diffRows,
  errorMessage,
  eventStats,
  eventTypeLabel,
  fileStats,
  formatBytes,
  formatCompactTime,
  formatTime,
  hasStats,
  isMergeCommit,
  operationLabel,
  operationStateLabel,
  pathsSummary,
  shortHash,
  sourceLabel,
  splitRepoPath,
  stagedCount,
  statusLetter,
  statusLabel,
  truncate,
  typeGlyph,
} from '../client/format.ts'
import { createTranslator, dictionaries, en, interpolate, normalizeLocale, zh } from '../client/i18n.ts'

test('formatTime renders a local time and tolerates invalid input', () => {
  const rendered = formatTime('2026-01-02T03:04:05.000Z', 'zh-CN')
  assert.equal(typeof rendered, 'string')
  assert.ok(rendered.length > 0)
  assert.equal(formatTime(undefined), '')
  assert.equal(formatTime('not-a-date'), 'not-a-date')
})

test('shortHash and truncate bound their output', () => {
  assert.equal(shortHash('0123456789abcdef', 7), '0123456')
  assert.equal(shortHash(undefined), '')
  const long = 'x'.repeat(200)
  assert.ok(truncate(long, 20).length <= 21)
})

test('formatBytes renders readable sizes', () => {
  assert.equal(formatBytes(undefined), '')
  assert.ok(formatBytes(0).length > 0)
  assert.ok(formatBytes(2048).length > 0)
})

test('diff line classification covers headers, hunks, additions and removals', () => {
  assert.equal(diffLineKind('diff --git a/x b/x'), 'meta')
  assert.equal(diffLineKind('index 000..111 100644'), 'meta')
  assert.equal(diffLineKind('--- a/x'), 'meta')
  assert.equal(diffLineKind('+++ b/x'), 'meta')
  assert.equal(diffLineKind('@@ -1,2 +1,2 @@'), 'hunk')
  assert.equal(diffLineKind('+added line'), 'added')
  assert.equal(diffLineKind('-removed line'), 'removed')
  assert.equal(diffLineKind(' context line'), 'context')
  assert.notEqual(diffLineClassName('added'), diffLineClassName('removed'))
})

test('diffLines splits on LF and is empty for empty input', () => {
  assert.deepEqual(diffLines('a\nb'), ['a', 'b'])
  assert.deepEqual(diffLines(''), [])
  assert.deepEqual(diffLines(undefined), [])
})

test('status letters, labels and glyphs resolve through the dictionary', () => {
  const t = createTranslator('zh')
  for (const status of ['added', 'modified', 'deleted', 'renamed', 'copied', 'type-changed', 'unknown'] as const) {
    assert.equal(typeof statusLetter(status), 'string')
    assert.ok(statusLabel(status, t).length > 0)
  }
  for (const type of ['commit', 'push', 'fetch', 'pull', 'update', 'unknown'] as const) {
    assert.equal(typeof typeGlyph(type), 'string')
    assert.ok(eventTypeLabel(type, t).length > 0)
  }
  assert.ok(sourceLabel('repository', t).length > 0)
  assert.ok(sourceLabel('plugin-audit', t).length > 0)
  assert.ok(operationLabel('commit', t).length > 0)
  assert.ok(operationStateLabel('succeeded', t).length > 0)
})

test('error mapping produces localized, non-empty messages', () => {
  const t = createTranslator('zh')
  assert.equal(apiErrorKey(null), 'error.generic')
  assert.equal(apiErrorKey({ code: 'vcs-not-installed', message: 'x' }), 'error.vcs-not-installed')
  assert.ok(errorMessage({ code: 'timeout', message: 'x' }, t).length > 0)
  assert.ok(errorMessage(null, t).length > 0)
  assert.ok(errorMessage({ code: 'some-unknown-code' as never, message: 'x' }, t).length > 0)
})

test('stagedCount and pathsSummary summarize lists', () => {
  assert.equal(stagedCount([{ staged: true }, { staged: false }, {}]), 1)
  assert.equal(stagedCount(undefined), 0)
  assert.ok(pathsSummary(['a', 'b', 'c', 'd'], 2).length > 0)
})

test('dictionaries are complete for both locales', () => {
  assert.ok(Object.keys(zh).length > 100)
  assert.ok(Object.keys(en).length > 100)
  const zhKeys = Object.keys(dictionaries.zh).sort()
  const enKeys = Object.keys(dictionaries.en).sort()
  assert.deepEqual(zhKeys, enKeys, 'zh and en dictionaries must share the same keys')
  assert.equal(normalizeLocale('zh-CN'), 'zh')
  assert.equal(normalizeLocale('en-US'), 'en')
  assert.equal(normalizeLocale(undefined), 'zh')
})

test('interpolation replaces named parameters and leaves unknown placeholders alone', () => {
  assert.equal(interpolate('a {n} b', { n: 3 }), 'a 3 b')
  assert.equal(interpolate('a {n} b'), 'a {n} b')
  assert.equal(interpolate('no parameters'), 'no parameters')
})

test('the translator falls back to the key rather than throwing', () => {
  const t = createTranslator('en')
  assert.equal(t('timeline.empty'), dictionaries.en['timeline.empty'])
  assert.equal(t('this.key.does.not.exist'), 'this.key.does.not.exist')
})

test('formatCompactTime keeps dense rows short and rejects invalid input', () => {
  const now = new Date('2026-06-01T00:00:00.000Z')
  const sameYear = formatCompactTime('2026-01-02T03:04:05.000Z', 'zh-CN', now)
  assert.ok(/\d{1,2}\/\d{1,2}/.test(sameYear), sameYear)
  assert.ok(!sameYear.includes('2026'), sameYear)
  const otherYear = formatCompactTime('2024-01-02T03:04:05.000Z', 'zh-CN', now)
  assert.ok(otherYear.includes('2024'), otherYear)
  assert.equal(formatCompactTime('not-a-date'), '')
  assert.equal(formatCompactTime(undefined), '')
})

test('eventStats reads only reported numbers and prefers filesChanged', () => {
  assert.deepEqual(eventStats({ metadata: { filesChanged: 3, additions: 12, deletions: 4, binaryFiles: 1 } }), {
    files: 3,
    additions: 12,
    deletions: 4,
    binaryFiles: 1,
  })
  assert.deepEqual(eventStats({ metadata: { pathCount: 2 } }), { files: 2 })
  assert.deepEqual(eventStats({ metadata: { filesChanged: 0, additions: 0, deletions: 0 } }), {
    files: 0,
    additions: 0,
    deletions: 0,
  })
  assert.deepEqual(eventStats({ metadata: { additions: -1 as never } }), {})
  assert.deepEqual(eventStats({}), {})
  assert.deepEqual(eventStats(null), {})
  assert.deepEqual(eventStats(undefined), {})
  assert.equal(hasStats(eventStats({ metadata: { filesChanged: 1 } })), true)
  assert.equal(hasStats({}), false)
})

test('merge commits never present all-zero stats as a real change', () => {
  const stats = eventStats({
    parentHashes: ['a', 'b'],
    metadata: { filesChanged: 0, additions: 0, deletions: 0 },
  })
  assert.deepEqual(stats, {})
  const real = eventStats({
    parentHashes: ['a', 'b'],
    metadata: { filesChanged: 2, additions: 5, deletions: 1 },
  })
  assert.deepEqual(real, { files: 2, additions: 5, deletions: 1 })
  assert.equal(isMergeCommit({ parentHashes: ['a', 'b'] }), true)
  assert.equal(isMergeCommit({ parentHashes: ['a'] }), false)
  assert.equal(isMergeCommit({}), false)
})

test('splitRepoPath separates directory and file name', () => {
  assert.deepEqual(splitRepoPath('src/components/a.ts'), { dir: 'src/components/', name: 'a.ts' })
  assert.deepEqual(splitRepoPath('a.ts'), { dir: '', name: 'a.ts' })
  assert.deepEqual(splitRepoPath(''), { dir: '', name: '' })
  assert.deepEqual(splitRepoPath(undefined), { dir: '', name: '' })
})

test('diffRows tracks old and new line numbers per hunk', () => {
  const rows = diffRows('@@ -10,3 +20,4 @@ ctx\n context\n-removed\n+added\n+added2\n')
  assert.equal(rows.length, 5)
  assert.equal(rows[0]!.kind, 'hunk')
  assert.deepEqual([rows[1]!.oldLine, rows[1]!.newLine], [10, 20])
  assert.deepEqual([rows[2]!.oldLine, rows[2]!.newLine], [11, null])
  assert.deepEqual([rows[3]!.oldLine, rows[3]!.newLine], [null, 21])
  assert.deepEqual([rows[4]!.oldLine, rows[4]!.newLine], [null, 22])
  const meta = diffRows('diff --git a/x b/x\n--- a/x\n+++ b/x\n')
  assert.ok(meta.every((row) => row.oldLine === null && row.newLine === null))
  assert.deepEqual(diffRows(''), [])
})

test('fileStats reflects only reported per-file numbers', () => {
  assert.deepEqual(fileStats({ additions: 2, deletions: 0 }), { additions: 2, deletions: 0 })
  assert.deepEqual(fileStats({}), { additions: null, deletions: null })
  assert.deepEqual(fileStats({ additions: undefined, deletions: undefined }), { additions: null, deletions: null })
})
