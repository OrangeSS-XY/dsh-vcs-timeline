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
  errorMessage,
  eventTypeLabel,
  formatBytes,
  formatTime,
  operationLabel,
  operationStateLabel,
  pathsSummary,
  shortHash,
  sourceLabel,
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
