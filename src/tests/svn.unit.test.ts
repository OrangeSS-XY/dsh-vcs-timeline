/**
 * Unit tests for the SVN backend: argv/XML/text parsers, revision
 * validation, adapter wiring and graceful degradation.
 *
 * IMPORTANT environment limitation: this machine has no `svn` client
 * installed, so there is no live integration test here. Every command the
 * adapter would run is answered by a scripted {@link Runner}; the fixtures
 * below are realistic `svn --xml`, `svn diff --summarize` and `svn diff`
 * outputs. A real Subversion round-trip remains unverified.
 * @module dsh-vcs-timeline/tests/svn.unit.test
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ApiError } from '../shared/contracts.ts'
import { MAX_EVENT_FILES, isChangeSet } from '../shared/contracts.ts'
import type { AdapterResult, OperationParams, RunResult, Runner } from '../host/adapters/types.ts'
import { createSvnAdapter } from '../host/adapters/svn/adapter.ts'
import {
  MAX_CHANGESET_FILES,
  buildCommitArgs,
  buildDiffArgs,
  buildDiffSummarizeArgs,
  buildInfoArgs,
  buildLogArgs,
  buildStatusArgs,
  buildUpdateArgs,
  buildVersionProbeArgs,
  decodeUriPath,
  parseDiffSummarize,
  parseInfoXml,
  parseLogXml,
  parseRevision,
  parseRevisionNumber,
  parseStatusXml,
  parseSvnDate,
  repoPathToRelative,
  svnPrefixFromInfo,
  targetPathToRelative,
} from '../host/adapters/svn/commands.ts'
import {
  decodeXmlEntities,
  parseXml,
  rootElement,
  XmlParseError,
} from '../host/adapters/svn/xml.ts'
import type { XmlNode } from '../host/adapters/svn/xml.ts'
import { decodeCursor, encodeCursor } from '../host/security.ts'

// ---------------------------------------------------------------------------
// Fixtures (realistic svn output shapes, including multi-line attributes)
// ---------------------------------------------------------------------------

const INFO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<info>
<entry
   kind="dir"
   path="."
   revision="4">
<url>https://user:secret@svn.example.com/repos/trunk?token=abc123</url>
<relative-url>^/trunk</relative-url>
<repository>
<root>https://svn.example.com/repos</root>
<uuid>a1b2c3d4-0000-1111-2222-333344445555</uuid>
</repository>
<wc-info>
<wcroot-abspath>/work/wc</wcroot-abspath>
<schedule>normal</schedule>
<depth>infinity</depth>
</wc-info>
<commit
   revision="3">
<author>alice</author>
<date>2024-05-02T10:30:00.123456Z</date>
</commit>
</entry>
</info>`

const LOG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<log>
<logentry
   revision="2">
<author>alice</author>
<date>2024-05-02T10:30:00.123456Z</date>
<paths>
<path
   action="A"
   kind="file"
   prop-mods="false"
   text-mods="true"
   copyfrom-path="/trunk/old name.txt"
   copyfrom-rev="1">/trunk/new name.txt</path>
<path
   action="M"
   kind="file"
   prop-mods="true"
   text-mods="true">/trunk/README.md</path>
</paths>
<msg>Привет мир
second line of the message</msg>
</logentry>
<logentry
   revision="1">
<author>bob</author>
<date>2024-05-01T09:00:00.000000Z</date>
<paths>
<path action="A" kind="dir" prop-mods="false" text-mods="false">/trunk</path>
</paths>
<msg/>
</logentry>
</log>`

const STATUS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<status>
<target path=".">
<entry path="modified.txt">
<wc-status item="modified" props="none" revision="4">
<commit revision="3">
<author>alice</author>
<date>2024-05-02T10:30:00.000000Z</date>
</commit>
</wc-status>
</entry>
<entry path="deleted.txt">
<wc-status item="deleted" props="none" revision="4"></wc-status>
</entry>
<entry path="conflicted.txt">
<wc-status item="conflicted" props="none" revision="4" tree-conflicted="true"></wc-status>
</entry>
<entry path="untracked.txt">
<wc-status item="unversioned" props="none"></wc-status>
</entry>
<entry path="ignored.log">
<wc-status item="ignored" props="none"></wc-status>
</entry>
<entry path="props-only.txt">
<wc-status item="normal" props="modified" revision="4"></wc-status>
</entry>
</target>
</status>`

const SUMMARIZE_TEXT = `M       README.md
A  +    new name.txt (from /trunk/old name.txt:1)
D       old name.txt
?       untracked.txt
`

/** The executable the scripted runner claims to have resolved. */
const SVN_EXECUTABLE = 'C:\\svn\\svn.exe'

/** The repository id the host would derive for a test root. */
const REPOSITORY_ID = 'svn:c:/fake/wc'

/** A reusable fake root that does not need to exist on disk. */
const WC_ROOT = join(tmpdir(), 'dvt-svn-unit-wc')

interface RecordedCall {
  argv: readonly string[]
  cwd: string
}

/** Scripted runner: answers svn invocations and records them. */
function createScriptedRunner(
  answer: (argv: readonly string[], cwd: string) => RunResult | Promise<RunResult>,
  executable: string | null = SVN_EXECUTABLE,
): { runner: Runner; calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  return {
    calls,
    runner: {
      async run(argv, cwd) {
        calls.push({ argv, cwd })
        return await answer(argv, cwd)
      },
      async resolveExecutable(command) {
        return command === 'svn' ? executable : null
      },
    },
  }
}

/** Build an adapter over a scripted runner. */
function svnAdapter(
  answer: (argv: readonly string[], cwd: string) => RunResult | Promise<RunResult>,
  executable: string | null = SVN_EXECUTABLE,
): { adapter: ReturnType<typeof createSvnAdapter>; calls: RecordedCall[] } {
  const scripted = createScriptedRunner(answer, executable)
  return { adapter: createSvnAdapter(scripted.runner), calls: scripted.calls }
}

/** A successful run result. */
function success(stdout: string): RunResult {
  return { exitCode: 0, stdout, stderr: '' }
}

/** A failed run result. */
function failure(stderr: string, exitCode = 1): RunResult {
  return { exitCode, stdout: '', stderr }
}

/** Unwrap an expected success. */
function expectOk<T>(result: AdapterResult<T>): T {
  if (!result.ok) assert.fail(`expected ok, got ${result.error.code}: ${result.error.message}`)
  return result.value
}

/** Unwrap an expected stable error. */
function expectErr<T>(result: AdapterResult<T>): ApiError {
  if (result.ok) assert.fail('expected an error result, got ok')
  return result.error
}

/** First recorded call argv. */
function firstArgv(calls: RecordedCall[]): readonly string[] {
  const call = calls[0]
  assert.ok(call !== undefined, 'expected at least one command invocation')
  return call.argv
}

/** Generate a realistic `svn log --xml` document. */
function logXml(
  entries: Array<{ revision: number; author?: string; date?: string; message?: string; paths?: string[] }>,
): string {
  const body = entries.map(entry => {
    const paths = (entry.paths ?? [`/trunk/file-${entry.revision}.txt`])
      .map(path => `\n<path action="M" kind="file" prop-mods="false" text-mods="true">${path}</path>`)
      .join('')
    return `\n<logentry\n   revision="${entry.revision}">\n`
      + (entry.author === undefined ? '' : `<author>${entry.author}</author>\n`)
      + `<date>${entry.date ?? `2024-05-0${entry.revision}T10:00:00.000000Z`}</date>\n`
      + `<paths>${paths}\n</paths>\n`
      + `<msg>${entry.message ?? `change ${entry.revision}`}</msg>\n`
      + '</logentry>'
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<log>${body}\n</log>`
}

/** Generate a realistic `svn status --xml` document. */
function statusXml(entries: Array<{ path: string; item: string; props?: string; treeConflicted?: boolean }>): string {
  const body = entries.map(entry => `\n<entry path="${entry.path}">\n<wc-status item="${entry.item}" props="${entry.props ?? 'none'}" revision="4"${entry.treeConflicted === true ? ' tree-conflicted="true"' : ''}></wc-status>\n</entry>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<status>\n<target path=".">${body}\n</target>\n</status>`
}

// ---------------------------------------------------------------------------
// xml.ts
// ---------------------------------------------------------------------------

test('xml: parses a realistic svn log document with multi-line attributes and entities', () => {
  const document = parseXml(LOG_XML)
  const log = rootElement(document, 'log')
  assert.equal(log.children.length, 2)
  const first = log.children[0] as XmlNode
  assert.equal(first.name, 'logentry')
  assert.equal(first.attributes['revision'], '2')
  const paths = first.children.find(child => child.name === 'paths')
  assert.ok(paths !== undefined)
  assert.equal(paths.children.length, 2)
  const firstPath = paths.children[0] as XmlNode
  assert.equal(firstPath.attributes['copyfrom-path'], '/trunk/old name.txt')
  assert.equal(firstPath.text, '/trunk/new name.txt')
  const message = first.children.find(child => child.name === 'msg')
  assert.ok(message !== undefined)
  assert.match(message.text, /Привет мир/)
})

test('xml: handles declarations, comments, DOCTYPE internal subsets and CDATA', () => {
  const source = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<!DOCTYPE log [ <!ELEMENT log ANY> ]>\n'
    + '<!-- leading comment -->\n'
    + '<log><msg>A &amp; B<![CDATA[<raw>&]]></msg></log>\n'
    + '<!-- trailing comment -->\n'
  const document = parseXml(source)
  const log = rootElement(document, 'log')
  const msg = log.children[0] as XmlNode
  assert.equal(msg.text, 'A & B<raw>&')
})

test('xml: decodes predefined and numeric entities, keeps unknown entities', () => {
  assert.equal(decodeXmlEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;'), 'a & b <c> "d" \'e\'')
  assert.equal(decodeXmlEntities('&#65;&#x42;&#x4e2d;'), 'AB中')
  assert.equal(decodeXmlEntities('keep &unknown; and & bare'), 'keep &unknown; and & bare')
})

test('xml: rejects malformed documents instead of returning partial trees', () => {
  assert.throws(() => parseXml('<log><a></b></log>'), XmlParseError)
  assert.throws(() => parseXml('<log><a x=1></a></log>'), XmlParseError)
  assert.throws(() => parseXml('<log><a></log>'), XmlParseError)
  assert.throws(() => parseXml(''), XmlParseError)
  assert.throws(() => parseXml('<a></a><b></b>'), XmlParseError)
  assert.throws(() => parseXml('<log><a x="1"></a>'), XmlParseError)
})

test('xml: rootElement enforces the expected root name', () => {
  const document = parseXml('<status></status>')
  assert.throws(() => rootElement(document, 'log'), XmlParseError)
  assert.equal(rootElement(document, 'status').name, 'status')
})

// ---------------------------------------------------------------------------
// argv builders
// ---------------------------------------------------------------------------

test('argv: every builder is an argv array with --non-interactive and -- before targets', () => {
  assert.deepEqual(buildVersionProbeArgs('svn'), ['svn', '--version', '--quiet'])
  assert.deepEqual(buildInfoArgs('svn', '/tmp/wc'), ['svn', 'info', '--xml', '--non-interactive', '--', '/tmp/wc'])
  assert.deepEqual(buildStatusArgs('svn', '/tmp/wc'), ['svn', 'status', '--xml', '--non-interactive', '--', '/tmp/wc'])
  assert.deepEqual(
    buildLogArgs('svn', '/tmp/wc', { revisionRange: 'HEAD:1', limit: 30 }),
    ['svn', 'log', '--xml', '--non-interactive', '-v', '-r', 'HEAD:1', '-l', '30', '--', '/tmp/wc'],
  )
  assert.deepEqual(
    buildDiffArgs('svn', '/tmp/wc', { revision: '5' }),
    ['svn', 'diff', '--non-interactive', '-c', '5', '--', '/tmp/wc'],
  )
  assert.deepEqual(
    buildDiffArgs('svn', '/tmp/wc', { range: { from: 3, to: 5 } }),
    ['svn', 'diff', '--non-interactive', '-r', '3:5', '--', '/tmp/wc'],
  )
  assert.deepEqual(
    buildDiffSummarizeArgs('svn', '/tmp/wc', '5'),
    ['svn', 'diff', '--summarize', '--non-interactive', '-c', '5', '--', '/tmp/wc'],
  )
  assert.deepEqual(
    buildUpdateArgs('svn', '/tmp/wc'),
    ['svn', 'update', '--non-interactive', '--accept', 'postpone', '--', '/tmp/wc'],
  )
  const commit = buildCommitArgs('svn', 'fix: thing', ['/tmp/wc/a.txt', '/tmp/wc/b.txt'])
  assert.deepEqual(commit, [
    'svn', 'commit', '--non-interactive', '-m', 'fix: thing', '--', '/tmp/wc/a.txt', '/tmp/wc/b.txt',
  ])
})

test('argv: user text stays one argv element (no shell splitting)', () => {
  const message = 'x; rm -rf / && echo "pwned" | cat'
  const argv = buildCommitArgs('svn', message, ['/tmp/wc'])
  assert.equal(argv.filter(element => element.includes('rm -rf')).length, 1)
  assert.ok(argv.includes(message))
})

test('argv: builders refuse revision injection', () => {
  assert.throws(() => buildDiffArgs('svn', '/tmp/wc', { revision: '1-2' }))
  assert.throws(() => buildDiffArgs('svn', '/tmp/wc', { revision: '1:2' }))
  assert.throws(() => buildDiffArgs('svn', '/tmp/wc', { revision: '--force' }))
  assert.throws(() => buildDiffArgs('svn', '/tmp/wc', { revision: '5\n--username x' }))
  assert.throws(() => buildDiffSummarizeArgs('svn', '/tmp/wc', '5:6'))
  assert.throws(() => buildLogArgs('svn', '/tmp/wc', { revisionRange: 'HEAD;rm -rf /' }))
  assert.throws(() => buildLogArgs('svn', '/tmp/wc', { revisionRange: 'HEAD:1', limit: 0 }))
  assert.throws(() => buildCommitArgs('svn', '   ', ['/tmp/wc']))
})

// ---------------------------------------------------------------------------
// revision and date validation
// ---------------------------------------------------------------------------

test('revision: accepts bounded decimal revisions and canonicalizes zeros', () => {
  assert.equal(parseRevision('0'), '0')
  assert.equal(parseRevision('42'), '42')
  assert.equal(parseRevision(' 42 '), '42')
  assert.equal(parseRevision('007'), '7')
  assert.equal(parseRevision('999999999999'), '999999999999')
  assert.equal(parseRevisionNumber('42'), 42)
  assert.equal(parseRevisionNumber('0012'), 12)
})

test('revision: rejects injection forms and non-string values', () => {
  for (const candidate of ['1-2', '1:2', '-1', 'HEAD', 'head', '1e3', '1 2', '12abc', '', '   ', '\n5', '1234567890123', '../1', '^/trunk']) {
    assert.equal(parseRevision(candidate), null, `expected ${JSON.stringify(candidate)} to be rejected`)
  }
  for (const candidate of [null, undefined, 5, {}, []]) {
    assert.equal(parseRevision(candidate), null)
  }
})

test('date: normalizes six-digit SVN fractions to ISO 8601 milliseconds', () => {
  assert.equal(parseSvnDate('2024-05-02T10:30:00.123456Z'), '2024-05-02T10:30:00.123Z')
  assert.equal(parseSvnDate('2024-05-01T09:00:00.000000Z'), '2024-05-01T09:00:00.000Z')
  assert.equal(parseSvnDate('2024-05-01T09:00:00Z'), '2024-05-01T09:00:00.000Z')
  assert.equal(parseSvnDate('not a date'), undefined)
  assert.equal(parseSvnDate(''), undefined)
  assert.equal(parseSvnDate(undefined), undefined)
})

// ---------------------------------------------------------------------------
// log parsing
// ---------------------------------------------------------------------------

test('log: parses revision, author, date, unicode multi-line message and copyfrom paths', () => {
  const entries = parseLogXml(LOG_XML)
  assert.equal(entries.length, 2)
  const entry = entries[0] as (typeof entries)[number]
  assert.equal(entry.revision, '2')
  assert.equal(entry.author, 'alice')
  assert.equal(entry.date, '2024-05-02T10:30:00.123Z')
  assert.match(entry.message, /^Привет мир\nsecond line/)
  assert.equal(entry.paths.length, 2)
  const copied = entry.paths[0] as (typeof entry.paths)[number]
  assert.equal(copied.action, 'A')
  assert.equal(copied.kind, 'file')
  assert.equal(copied.path, '/trunk/new name.txt')
  assert.equal(copied.copyFromPath, '/trunk/old name.txt')
  assert.equal(copied.copyFromRevision, '1')
  assert.equal(copied.propMods, false)
  assert.equal(copied.textMods, true)
  const modified = entry.paths[1] as (typeof entry.paths)[number]
  assert.equal(modified.action, 'M')
  assert.equal(modified.propMods, true)
})

test('log: empty <msg/> yields an empty message and missing author stays undefined', () => {
  const entries = parseLogXml(LOG_XML)
  const rootEntry = entries[1] as (typeof entries)[number]
  assert.equal(rootEntry.revision, '1')
  assert.equal(rootEntry.message, '')
  assert.equal(rootEntry.author, 'bob')

  const withoutAuthor = parseLogXml(logXml([{ revision: 3 }]))
  assert.equal((withoutAuthor[0] as (typeof withoutAuthor)[number]).author, undefined)
})

test('log: rejects malformed entries', () => {
  assert.throws(() => parseLogXml('<log><logentry revision="x"></logentry></log>'), XmlParseError)
  assert.throws(() => parseLogXml('<log><logentry revision="2"></logentry>'), XmlParseError)
  assert.throws(() => parseLogXml('<log></log'), XmlParseError)
})

// ---------------------------------------------------------------------------
// info parsing
// ---------------------------------------------------------------------------

test('info: parses urls, base revision, wc root and last-changed facts', () => {
  const info = parseInfoXml(INFO_XML)
  assert.equal(info.entryPath, '.')
  assert.equal(info.kind, 'dir')
  assert.equal(info.revision, '4')
  assert.equal(info.url, 'https://user:secret@svn.example.com/repos/trunk?token=abc123')
  assert.equal(info.relativeUrl, '^/trunk')
  assert.equal(info.repositoryRoot, 'https://svn.example.com/repos')
  assert.equal(info.repositoryUuid, 'a1b2c3d4-0000-1111-2222-333344445555')
  assert.equal(info.wcRootPath, '/work/wc')
  assert.equal(info.schedule, 'normal')
  assert.equal(info.depth, 'infinity')
  assert.equal(info.lastChangedRevision, '3')
  assert.equal(info.lastChangedAuthor, 'alice')
  assert.equal(info.lastChangedDate, '2024-05-02T10:30:00.123Z')
})

test('info: rejects output without an entry', () => {
  assert.throws(() => parseInfoXml('<info></info>'), XmlParseError)
})

// ---------------------------------------------------------------------------
// status parsing
// ---------------------------------------------------------------------------

test('status: parses modified, deleted, conflicted, unversioned, ignored and property-only entries', () => {
  const entries = parseStatusXml(STATUS_XML)
  assert.equal(entries.length, 6)
  const byPath = new Map(entries.map(entry => [entry.path, entry]))
  assert.equal(byPath.get('modified.txt')?.item, 'modified')
  assert.equal(byPath.get('deleted.txt')?.item, 'deleted')
  assert.equal(byPath.get('conflicted.txt')?.item, 'conflicted')
  assert.equal(byPath.get('conflicted.txt')?.treeConflicted, true)
  assert.equal(byPath.get('untracked.txt')?.item, 'unversioned')
  assert.equal(byPath.get('ignored.log')?.item, 'ignored')
  assert.equal(byPath.get('props-only.txt')?.item, 'normal')
  assert.equal(byPath.get('props-only.txt')?.props, 'modified')
  assert.equal(byPath.get('modified.txt')?.revision, '4')
})

test('status: accepts single-letter status aliases defensively', () => {
  const xml = statusXml([
    { path: 'a.txt', item: '?' },
    { path: 'b.txt', item: 'M' },
    { path: 'c.txt', item: '!' },
  ])
  const entries = parseStatusXml(xml)
  assert.deepEqual(entries.map(entry => entry.item), ['unversioned', 'modified', 'missing'])
})

test('status: rejects malformed output', () => {
  assert.throws(() => parseStatusXml('<status><target></target>'), XmlParseError)
})

// ---------------------------------------------------------------------------
// diff --summarize parsing
// ---------------------------------------------------------------------------

test('summarize: parses plain, copied, deleted and unversioned status lines', () => {
  const entries = parseDiffSummarize(SUMMARIZE_TEXT)
  assert.deepEqual(entries, [
    { action: 'M', path: 'README.md' },
    { action: 'A', path: 'new name.txt', copyFromPath: '/trunk/old name.txt', copyFromRevision: '1' },
    { action: 'D', path: 'old name.txt' },
    { action: '?', path: 'untracked.txt' },
  ])
})

test('summarize: tolerates padding variants, property-only lines and leading-plus filenames', () => {
  const text = [
    'M       spaced.txt',
    ' M      props-only.txt',
    'A  +    renamed.txt (from /trunk/original.txt:7)',
    'A       +weird.txt',
    'R       replaced.txt',
    '',
    'garbage line without status',
  ].join('\r\n')
  const entries = parseDiffSummarize(text)
  assert.equal(entries.length, 5)
  assert.equal(entries[1]?.action, 'M')
  assert.equal(entries[1]?.path, 'props-only.txt')
  assert.equal(entries[2]?.copyFromPath, '/trunk/original.txt')
  assert.equal(entries[2]?.copyFromRevision, '7')
  assert.equal(entries[3]?.path, '+weird.txt')
  assert.equal(entries[4]?.action, 'R')
})

// ---------------------------------------------------------------------------
// path normalization helpers
// ---------------------------------------------------------------------------

test('paths: maps repository-absolute log paths onto the working copy prefix', () => {
  assert.equal(repoPathToRelative('/trunk/a.txt', 'trunk'), 'a.txt')
  assert.equal(repoPathToRelative('/trunk/sub/b.txt', 'trunk'), 'sub/b.txt')
  assert.equal(repoPathToRelative('/trunk', 'trunk'), null)
  assert.equal(repoPathToRelative('/branches/other.txt', 'trunk'), 'branches/other.txt')
  assert.equal(repoPathToRelative('/trunk/a b.txt', ''), 'trunk/a b.txt')
  assert.equal(repoPathToRelative('a b.txt', ''), 'a b.txt')
  assert.equal(repoPathToRelative('/trunk/../escape', 'trunk'), null)
  assert.equal(repoPathToRelative('', 'trunk'), null)
})

test('paths: maps target-relative status/summarize paths and strips the working copy root', () => {
  const root = join(tmpdir(), 'dvt-svn-wc')
  assert.equal(targetPathToRelative('sub/a.txt', root), 'sub/a.txt')
  assert.equal(targetPathToRelative(root.replace(/\\/g, '/') + '/sub/a.txt', root), 'sub/a.txt')
  assert.equal(targetPathToRelative('.', root), null)
  assert.equal(targetPathToRelative('', root), null)
  assert.equal(targetPathToRelative('^/trunk/x.txt', root), 'trunk/x.txt')
  assert.equal(targetPathToRelative('../escape.txt', root), null)
})

test('paths: derives the working copy prefix from relative-url or url/root fallbacks', () => {
  assert.equal(svnPrefixFromInfo({ relativeUrl: '^/trunk' }), 'trunk')
  assert.equal(svnPrefixFromInfo({ relativeUrl: '^/trunk/sub dir' }), 'trunk/sub dir')
  assert.equal(svnPrefixFromInfo({ relativeUrl: '^/' }), '')
  assert.equal(svnPrefixFromInfo({ relativeUrl: '^' }), '')
  assert.equal(svnPrefixFromInfo({}), '')
  assert.equal(svnPrefixFromInfo({
    url: 'https://svn.example.com/repos/my%20project/trunk',
    repositoryRoot: 'https://svn.example.com/repos',
  }), 'my project/trunk')
  assert.equal(svnPrefixFromInfo({
    url: 'https://svn.example.com/repos',
    repositoryRoot: 'https://svn.example.com/repos',
  }), '')
})

test('paths: percent-encodes are decoded segment by segment', () => {
  assert.equal(decodeUriPath('%E4%B8%AD%E6%96%87/a%20b.txt'), '中文/a b.txt')
  assert.equal(decodeUriPath('plain/path.txt'), 'plain/path.txt')
  assert.equal(decodeUriPath('bad%ZZ/kept.txt'), 'bad%ZZ/kept.txt')
})

// ---------------------------------------------------------------------------
// detect
// ---------------------------------------------------------------------------

test('detect: reports vcs-not-installed when the svn client is missing and spawns nothing', async () => {
  const fake = svnAdapter(() => success(''), null)
  const result = await fake.adapter.detect(tmpdir())
  assert.equal(expectErr(result).code, 'vcs-not-installed')
  assert.equal(fake.calls.length, 0)
})

test('detect: walks up from a nested path to the .svn working copy root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dvt-svn-detect-'))
  try {
    await mkdir(join(directory, '.svn'))
    const nested = join(directory, 'src', 'deep')
    await mkdir(nested, { recursive: true })
    const canonical = await realpath(directory)
    const fake = svnAdapter(argv => {
      if (argv[1] === 'info') {
        return success(`<?xml version="1.0" encoding="UTF-8"?>\n<info><entry kind="dir" path="." revision="4"><url>file:///repo/trunk</url><relative-url>^/trunk</relative-url><repository><root>file:///repo</root></repository><wc-info><wcroot-abspath>${canonical.replace(/\\/g, '/')}</wcroot-abspath></wc-info><commit revision="3"><author>alice</author><date>2024-05-02T10:30:00.000000Z</date></commit></entry></info>`)
      }
      return failure('unexpected command')
    })
    const result = await fake.adapter.detect(nested)
    assert.equal(expectOk(result)?.rootPath, canonical)
    assert.ok(fake.calls.length >= 1)
    assert.equal(firstArgv(fake.calls)[1], 'info')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('detect: returns null outside an SVN working copy and when svn info fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dvt-svn-detect-none-'))
  try {
    const fake = svnAdapter(() => failure('svn: E155007: ... is not a working copy'))
    const result = await fake.adapter.detect(directory)
    assert.equal(expectOk(result), null)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('detect: accepts a root reported by svn info when no .svn marker is visible', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dvt-svn-detect-info-'))
  try {
    const canonical = await realpath(directory)
    const fake = svnAdapter(() => success(`<?xml version="1.0" encoding="UTF-8"?>\n<info><entry kind="dir" path="${canonical.replace(/\\/g, '/')}"><url>file:///repo</url><relative-url>^/</relative-url><repository><root>file:///repo</root></repository><wc-info><wcroot-abspath>${canonical.replace(/\\/g, '/')}</wcroot-abspath></wc-info></entry></info>`))
    const result = await fake.adapter.detect(directory)
    assert.equal(expectOk(result)?.rootPath, canonical)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// info
// ---------------------------------------------------------------------------

test('info: maps svn info into a Repository with a redacted url and base revision', async () => {
  const fake = svnAdapter(() => success(INFO_XML))
  const repository = expectOk(await fake.adapter.info(WC_ROOT))
  assert.equal(repository.vcsType, 'svn')
  assert.equal(repository.schemaVersion, 1)
  assert.equal(repository.rootPath, resolve(WC_ROOT))
  assert.equal(repository.displayName, 'dvt-svn-unit-wc')
  assert.equal(repository.currentRevision, '4')
  assert.equal(repository.currentBranch, undefined)
  assert.equal(repository.defaultBranch, undefined)
  assert.deepEqual(repository.remoteUrls, ['https://svn.example.com/repos/trunk?token=***'])
  assert.ok(!JSON.stringify(repository).includes('secret'))
  assert.ok(!JSON.stringify(repository).includes('abc123'))
  const argv = firstArgv(fake.calls)
  assert.equal(argv[1], 'info')
  assert.equal(argv[argv.length - 1], resolve(WC_ROOT))
})

test('info: maps a missing client and a non-working-copy path to stable error codes', async () => {
  const missing = svnAdapter(() => success(INFO_XML), null)
  assert.equal(expectErr(await missing.adapter.info(WC_ROOT)).code, 'vcs-not-installed')
  assert.equal(missing.calls.length, 0)

  const notWorkingCopy = svnAdapter(() => failure("svn: E155007: '/tmp/x' is not a working copy"))
  assert.equal(expectErr(await notWorkingCopy.adapter.info(WC_ROOT)).code, 'not-a-repository')
})

test('info: never throws when the runner itself rejects', async () => {
  const fake = svnAdapter(() => {
    throw new Error('spawn failed internally')
  })
  const error = expectErr(await fake.adapter.info(WC_ROOT))
  assert.equal(error.code, 'internal')
})

// ---------------------------------------------------------------------------
// history
// ---------------------------------------------------------------------------

test('history: maps a full page to commit events and a revision cursor', async () => {
  const entries = [5, 4, 3, 2, 1].map(revision => ({ revision }))
  const fake = svnAdapter(argv => {
    if (argv[1] !== 'log') return failure('unexpected')
    const limitIndex = argv.indexOf('-l')
    const limit = limitIndex === -1 ? 30 : Number(argv[limitIndex + 1])
    return success(logXml(entries.slice(0, limit)))
  })
  const page = expectOk(await fake.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 2 }))

  assert.equal(page.events.length, 2)
  assert.equal(page.hasMore, true)
  assert.deepEqual(decodeCursor(page.nextCursor), { r: 4 })
  const first = page.events[0] as (typeof page.events)[number]
  assert.equal(first.eventType, 'commit')
  assert.equal(first.source, 'repository')
  assert.equal(first.vcsType, 'svn')
  assert.equal(first.revision, '5')
  assert.equal(first.changeSetId, `${REPOSITORY_ID}:5`)
  assert.equal(first.summary, 'change 5')
  assert.equal(first.timestamp, '2024-05-05T10:00:00.000Z')
  assert.equal(first.metadata?.['pathCount'], 1)

  const argv = firstArgv(fake.calls)
  assert.equal(argv[1], 'log')
  assert.ok(argv.includes('--non-interactive'))
  assert.ok(argv.includes('-v'))
  assert.equal(argv[argv.indexOf('-r') + 1], 'HEAD:1')
  assert.equal(argv[argv.indexOf('-l') + 1], '2')
  assert.equal(argv[argv.length - 1], resolve(WC_ROOT))
})

test('history: a cursor continues from revision-1 and a short page ends paging', async () => {
  const fake = svnAdapter(argv => (argv[1] === 'log' ? success(logXml([{ revision: 3 }, { revision: 2 }])) : failure('unexpected')))
  const page = expectOk(await fake.adapter.history(WC_ROOT, REPOSITORY_ID, {
    limit: 30,
    cursor: encodeCursor({ r: 4 }),
  }))
  assert.equal(page.events.length, 2)
  assert.equal(page.hasMore, false)
  assert.equal(page.nextCursor, null)
  assert.equal(firstArgv(fake.calls)[firstArgv(fake.calls).indexOf('-r') + 1], '3:1')
})

test('history: applies author, text, date-window and event-type filters post-parse', async () => {
  const entries = [
    { revision: 5, author: 'alice', message: 'fix crash in parser', date: '2024-05-05T10:00:00.000000Z' },
    { revision: 4, author: 'bob', message: 'add feature', date: '2024-05-04T10:00:00.000000Z' },
    { revision: 3, author: 'Alice', message: 'refactor parser', date: '2024-05-03T10:00:00.000000Z' },
    { revision: 2, author: 'carol', message: 'docs only', date: '2024-05-02T10:00:00.000000Z' },
    { revision: 1, author: 'bob', message: 'initial', date: '2024-05-01T10:00:00.000000Z' },
  ]
  const fake = svnAdapter(argv => (argv[1] === 'log' ? success(logXml(entries)) : failure('unexpected')))

  const byAuthor = expectOk(await fake.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 10, author: 'ALI' }))
  assert.deepEqual(byAuthor.events.map(event => event.revision), ['5', '3'])

  const byText = expectOk(await fake.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 10, text: 'PARSER' }))
  assert.deepEqual(byText.events.map(event => event.revision), ['5', '3'])

  const byWindow = expectOk(await fake.adapter.history(WC_ROOT, REPOSITORY_ID, {
    limit: 10,
    since: '2024-05-03T00:00:00.000Z',
    until: '2024-05-04T23:59:59.000Z',
  }))
  assert.deepEqual(byWindow.events.map(event => event.revision), ['4', '3'])

  const commits = expectOk(await fake.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 10, eventTypes: ['commit'] }))
  assert.equal(commits.events.length, 5)

  const before = fake.calls.length
  const nonCommit = expectOk(await fake.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 10, eventTypes: ['push'] }))
  assert.deepEqual(nonCommit.events, [])
  assert.equal(nonCommit.hasMore, false)
  assert.equal(fake.calls.length, before, 'a non-commit filter must not run a command')
})

test('history: rejects an invalid cursor without running a command', async () => {
  const fake = svnAdapter(() => failure('must not be called'))
  const error = expectErr(await fake.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 10, cursor: 'not-a-real-cursor' }))
  assert.equal(error.code, 'invalid-request')
  assert.equal(fake.calls.length, 0)
})

test('history: maps timeout, auth, connect and non-working-copy failures to stable codes', async () => {
  const timedOut = svnAdapter(() => ({ exitCode: null, stdout: '', stderr: '', timedOut: true }))
  assert.equal(expectErr(await timedOut.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 5 })).code, 'timeout')

  const auth = svnAdapter(() => failure('svn: E170001: Authorization failed'))
  const authError = expectErr(await auth.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 5 }))
  assert.equal(authError.code, 'network-unknown')
  assert.equal(authError.retryable, false)

  const connect = svnAdapter(() => failure('svn: E175002: Could not connect to server'))
  const connectError = expectErr(await connect.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 5 }))
  assert.equal(connectError.code, 'network-unknown')
  assert.equal(connectError.retryable, true)

  const notRepo = svnAdapter(() => failure("svn: E155007: '/tmp/x' is not a working copy"))
  assert.equal(expectErr(await notRepo.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 5 })).code, 'not-a-repository')

  const missing = svnAdapter(() => success(''), null)
  assert.equal(expectErr(await missing.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 5 })).code, 'vcs-not-installed')
  assert.equal(missing.calls.length, 0)
})

test('history: includeFiles maps each revision\'s log paths into changed files', async () => {
  const mixedLogXml = `<?xml version="1.0" encoding="UTF-8"?>
<log>
<logentry revision="5">
<author>alice</author>
<date>2024-05-05T10:00:00.000000Z</date>
<paths>
<path action="M" kind="file" prop-mods="false" text-mods="true">/trunk/README.md</path>
<path action="A" kind="file" copyfrom-path="/trunk/old name.txt" copyfrom-rev="4">/trunk/new name.txt</path>
<path action="D" kind="file">/trunk/old name.txt</path>
<path action="A" kind="file">/trunk/brand-new.txt</path>
<path action="A" kind="dir" copyfrom-path="/trunk/dir" copyfrom-rev="2">/trunk/dir2</path>
</paths>
<msg>mixed change</msg>
</logentry>
<logentry revision="4">
<author>bob</author>
<date>2024-05-04T10:00:00.000000Z</date>
<paths>
<path action="M" kind="file" text-mods="true">/trunk/docs/a.txt</path>
</paths>
<msg>docs</msg>
</logentry>
</log>`
  const fake = svnAdapter(argv => {
    if (argv[1] === 'log') return success(mixedLogXml)
    if (argv[1] === 'info') return success(INFO_XML)
    return failure('unexpected')
  })
  const page = expectOk(await fake.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 10, includeFiles: true }))

  assert.equal(page.events.length, 2)
  // Paths are mapped onto the working copy prefix (`^/trunk`), the copy whose
  // source disappeared in the same revision becomes a rename, and a live copy
  // stays a copy with its source path.
  assert.deepEqual(page.events[0]!.changedFiles, [
    { path: 'README.md', status: 'modified' },
    { path: 'new name.txt', oldPath: 'old name.txt', status: 'renamed' },
    { path: 'old name.txt', status: 'deleted' },
    { path: 'brand-new.txt', status: 'added' },
    { path: 'dir2', oldPath: 'dir', status: 'copied' },
  ])
  assert.equal(page.events[0]!.changedFilesTruncated, undefined)
  assert.deepEqual(page.events[1]!.changedFiles, [{ path: 'docs/a.txt', status: 'modified' }])

  // One log read plus one local info read; the log still carries `-v`.
  assert.equal(fake.calls.length, 2)
  const logCall = fake.calls.find(call => call.argv[1] === 'log')
  const infoCall = fake.calls.find(call => call.argv[1] === 'info')
  assert.ok(logCall !== undefined)
  assert.ok(infoCall !== undefined)
  assert.ok(logCall.argv.includes('-v'))

  // A failed info probe only loses the prefix mapping: the page still succeeds
  // and files fall back to their repository-relative form (documented fallback).
  const fallback = svnAdapter(argv => (argv[1] === 'log' ? success(mixedLogXml) : failure('svn: E155007: not a working copy')))
  const fallbackPage = expectOk(await fallback.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 10, includeFiles: true }))
  assert.equal(fallbackPage.events[0]!.changedFiles?.[0]?.path, 'trunk/README.md')
})

test('history: without includeFiles the events carry no changed files and svn info is not run', async () => {
  const fake = svnAdapter(argv => (argv[1] === 'log' ? success(logXml([{ revision: 3 }])) : failure('unexpected')))
  const page = expectOk(await fake.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 10 }))
  assert.equal(page.events.length, 1)
  assert.equal('changedFiles' in (page.events[0] ?? {}), false)
  assert.equal(page.events[0]!.changedFilesTruncated, undefined)
  // Only the history read ran: no per-page file work when it was not asked for.
  assert.equal(fake.calls.length, 1)
})

test('history: includeFiles caps a pathological revision at MAX_EVENT_FILES', async () => {
  const paths = Array.from({ length: MAX_EVENT_FILES + 5 }, (_, index) => `/trunk/f-${index}.txt`)
  const fake = svnAdapter(argv => {
    if (argv[1] === 'log') return success(logXml([{ revision: 7, paths }]))
    if (argv[1] === 'info') return success(INFO_XML)
    return failure('unexpected')
  })
  const page = expectOk(await fake.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 10, includeFiles: true }))
  const files = page.events[0]!.changedFiles ?? []
  assert.equal(files.length, MAX_EVENT_FILES)
  assert.equal(page.events[0]!.changedFilesTruncated, true)
  assert.equal(files[0]?.path, 'f-0.txt')
})

test('history: stderr is redacted in the reported error detail', async () => {
  const fake = svnAdapter(() => failure('svn: E170001: authorization failed for https://user:hunter2@svn.example.com/repo?token=zzz'))
  const error = expectErr(await fake.adapter.history(WC_ROOT, REPOSITORY_ID, { limit: 5 }))
  assert.ok(!(error.detail ?? '').includes('hunter2'))
  assert.ok(!(error.detail ?? '').includes('zzz'))
})

// ---------------------------------------------------------------------------
// changeSet
// ---------------------------------------------------------------------------

/** One realistic single-revision log document for the changeset tests. */
const CHANGESET_LOG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<log>
<logentry
   revision="5">
<author>alice</author>
<date>2024-05-05T10:00:00.500000Z</date>
<paths>
<path action="M" kind="file" prop-mods="false" text-mods="true">/trunk/README.md</path>
<path action="D" kind="file" prop-mods="false" text-mods="true">/trunk/old name.txt</path>
<path
   action="A"
   kind="file"
   prop-mods="false"
   text-mods="true"
   copyfrom-path="/trunk/old name.txt"
   copyfrom-rev="1">/trunk/new name.txt</path>
<path
   action="A"
   kind="file"
   prop-mods="false"
   text-mods="true"
   copyfrom-path="/trunk/README.md"
   copyfrom-rev="4">/trunk/copied.txt</path>
<path action="R" kind="file" prop-mods="false" text-mods="true">/trunk/replaced.txt</path>
<path action="M" kind="file" prop-mods="false" text-mods="true">/branches/other.txt</path>
</paths>
<msg>rename and copy</msg>
</logentry>
</log>`

/** The summarize output for {@link CHANGESET_LOG_XML}. */
const CHANGESET_SUMMARIZE = `M       README.md
D       old name.txt
A  +    new name.txt (from /trunk/old name.txt:1)
A  +    copied.txt (from /trunk/README.md:4)
M       replaced.txt
M       branches/other.txt
A       summarize-only.txt
`

test('changeSet: maps log paths plus summarize statuses into a ChangeSet', async () => {
  const fake = svnAdapter(argv => {
    switch (argv[1]) {
      case 'log': return success(CHANGESET_LOG_XML)
      case 'info': return success(INFO_XML)
      case 'diff': return success(CHANGESET_SUMMARIZE)
      default: return failure('unexpected command')
    }
  })
  const changeSet = expectOk(await fake.adapter.changeSet(WC_ROOT, REPOSITORY_ID, '5'))
  assert.ok(isChangeSet(changeSet))
  assert.equal(changeSet.id, `${REPOSITORY_ID}:5`)
  assert.equal(changeSet.revision, '5')
  assert.equal(changeSet.parentRevision, '4')
  assert.equal(changeSet.createdAt, '2024-05-05T10:00:00.500Z')

  const byPath = new Map(changeSet.files.map(file => [file.path, file]))
  assert.equal(byPath.get('README.md')?.status, 'modified')
  assert.equal(byPath.get('old name.txt')?.status, 'deleted')
  const renamed = byPath.get('new name.txt')
  assert.equal(renamed?.status, 'renamed')
  assert.equal(renamed?.oldPath, 'old name.txt')
  const copied = byPath.get('copied.txt')
  assert.equal(copied?.status, 'copied')
  assert.equal(copied?.oldPath, 'README.md')
  assert.equal(byPath.get('replaced.txt')?.status, 'modified')
  assert.equal(byPath.get('branches/other.txt')?.status, 'modified')
  assert.equal(byPath.get('summarize-only.txt')?.status, 'added')
  assert.equal(byPath.get('new name.txt')?.additions, undefined)
  assert.equal(byPath.get('new name.txt')?.deletions, undefined)
  assert.equal(byPath.get('new name.txt')?.binary, undefined)
  assert.equal(changeSet.truncated, undefined)
})

test('changeSet: merges summarize paths printed without a leading slash (repo-relative output)', async () => {
  const log = `<?xml version="1.0" encoding="UTF-8"?>
<log>
<logentry
   revision="5">
<author>alice</author>
<date>2024-05-05T10:00:00.000000Z</date>
<paths>
<path action="M" kind="file" prop-mods="false" text-mods="true">/trunk/README.md</path>
<path action="A" kind="file" prop-mods="false" text-mods="true">/trunk/added.txt</path>
</paths>
<msg>repo relative summarize output</msg>
</logentry>
</log>`
  const fake = svnAdapter(argv => {
    switch (argv[1]) {
      case 'log': return success(log)
      case 'info': return success(INFO_XML)
      case 'diff': return success('M       trunk/README.md\nA       trunk/added.txt\n')
      default: return failure('unexpected command')
    }
  })
  const changeSet = expectOk(await fake.adapter.changeSet(WC_ROOT, REPOSITORY_ID, '5'))
  assert.deepEqual(changeSet.files.map(file => file.path), ['README.md', 'added.txt'])
  assert.deepEqual(changeSet.files.map(file => file.status), ['modified', 'added'])
})

test('changeSet: tolerates a failed summarize/info and falls back to repository paths', async () => {
  const fake = svnAdapter(argv => {
    switch (argv[1]) {
      case 'log': return success(CHANGESET_LOG_XML)
      default: return failure("svn: E155007: not a working copy")
    }
  })
  const changeSet = expectOk(await fake.adapter.changeSet(WC_ROOT, REPOSITORY_ID, '5'))
  const paths = changeSet.files.map(file => file.path)
  assert.ok(paths.includes('trunk/README.md'))
  assert.ok(paths.includes('trunk/new name.txt'))
  assert.equal(changeSet.truncated, undefined)
})

test('changeSet: rejects revision injection before running anything', async () => {
  const fake = svnAdapter(() => failure('must not be called'))
  for (const revision of ['1-2', '1:2', '../5', 'HEAD', '', '12345678901234']) {
    const error = expectErr(await fake.adapter.changeSet(WC_ROOT, REPOSITORY_ID, revision))
    assert.equal(error.code, 'invalid-request', `expected rejection for ${JSON.stringify(revision)}`)
  }
  assert.equal(fake.calls.length, 0)
})

test('changeSet: maps a log failure and a missing revision to stable errors', async () => {
  const failing = svnAdapter(() => failure('svn: E170001: Authorization failed'))
  assert.equal(expectErr(await failing.adapter.changeSet(WC_ROOT, REPOSITORY_ID, '5')).code, 'network-unknown')

  const missingRevision = svnAdapter(argv => (argv[1] === 'log' ? success(CHANGESET_LOG_XML) : failure('unexpected')))
  const error = expectErr(await missingRevision.adapter.changeSet(WC_ROOT, REPOSITORY_ID, '9'))
  assert.equal(error.code, 'operation-failed')
  assert.match(error.message, /r9/)
})

test('changeSet: caps the file list and marks it truncated', async () => {
  const manyPaths = Array.from(
    { length: MAX_CHANGESET_FILES + 5 },
    (_, index) => `<path action="M" kind="file" prop-mods="false" text-mods="true">/trunk/file-${index}.txt</path>`,
  ).join('\n')
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<log>\n<logentry\n   revision="5">\n<author>alice</author>\n<date>2024-05-05T10:00:00.000000Z</date>\n<paths>\n${manyPaths}\n</paths>\n<msg>bulk</msg>\n</logentry>\n</log>`
  const fake = svnAdapter(argv => {
    switch (argv[1]) {
      case 'log': return success(xml)
      case 'info': return failure('no info')
      case 'diff': return failure('no summarize')
      default: return failure('unexpected')
    }
  })
  const changeSet = expectOk(await fake.adapter.changeSet(WC_ROOT, REPOSITORY_ID, '5'))
  assert.equal(changeSet.files.length, MAX_CHANGESET_FILES)
  assert.equal(changeSet.truncated, true)
  assert.match(changeSet.truncationReason ?? '', /truncated/)
})

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

test('diff: single revision uses -c and returns the text with byte count', async () => {
  const text = 'Index: a.txt\n===================================================================\n--- a.txt\t(revision 4)\n+++ a.txt\t(revision 5)\n@@ -1 +1 @@\n-old\n+new\n'
  const fake = svnAdapter(argv => (argv[1] === 'diff' ? success(text) : failure('unexpected')))
  const result = expectOk(await fake.adapter.diff(WC_ROOT, REPOSITORY_ID, { revisionB: '5', maxBytes: 64 * 1024 }))
  assert.equal(result.revisionA, null)
  assert.equal(result.revisionB, '5')
  assert.equal(result.binary, false)
  assert.equal(result.truncated, false)
  assert.equal(result.text, text)
  assert.equal(result.bytes, Buffer.byteLength(text, 'utf8'))
  const argv = firstArgv(fake.calls)
  assert.ok(argv.includes('-c'))
  assert.equal(argv[argv.indexOf('-c') + 1], '5')
  assert.equal(argv[argv.length - 2], '--')
  assert.equal(argv[argv.length - 1], resolve(WC_ROOT))
})

test('diff: a range uses -r A:B and reports both revisions', async () => {
  const fake = svnAdapter(() => success('diff body\n'))
  const result = expectOk(await fake.adapter.diff(WC_ROOT, REPOSITORY_ID, {
    revisionA: '3',
    revisionB: '5',
    maxBytes: 4096,
  }))
  assert.equal(result.revisionA, '3')
  assert.equal(result.revisionB, '5')
  const argv = firstArgv(fake.calls)
  assert.equal(argv[argv.indexOf('-r') + 1], '3:5')
})

test('diff: a validated filePath is appended as an absolute target', async () => {
  const fake = svnAdapter(() => success('file diff\n'))
  const result = expectOk(await fake.adapter.diff(WC_ROOT, REPOSITORY_ID, {
    revisionB: '5',
    filePath: 'sub/a.txt',
    maxBytes: 4096,
  }))
  assert.equal(result.filePath, 'sub/a.txt')
  const argv = firstArgv(fake.calls)
  assert.equal(argv[argv.length - 2], '--')
  assert.equal(argv[argv.length - 1], join(resolve(WC_ROOT), 'sub', 'a.txt'))
})

test('diff: rejects path escapes and revision injection without running commands', async () => {
  const fake = svnAdapter(() => failure('must not be called'))
  for (const filePath of ['../outside.txt', '/etc/passwd', 'C:\\Windows\\win.ini', '']) {
    const error = expectErr(await fake.adapter.diff(WC_ROOT, REPOSITORY_ID, { revisionB: '5', filePath, maxBytes: 4096 }))
    assert.equal(error.code, 'path-not-allowed', `expected path rejection for ${JSON.stringify(filePath)}`)
  }
  for (const revision of ['1-2', '1:2', '--command', 'HEAD']) {
    const error = expectErr(await fake.adapter.diff(WC_ROOT, REPOSITORY_ID, { revisionB: revision, maxBytes: 4096 }))
    assert.equal(error.code, 'invalid-request')
  }
  const missing = expectErr(await fake.adapter.diff(WC_ROOT, REPOSITORY_ID, { maxBytes: 4096 }))
  assert.equal(missing.code, 'invalid-request')
  assert.equal(fake.calls.length, 0)
})

test('diff: truncates on a UTF-8 code-point boundary and marks the result', async () => {
  const text = '中文中文中文中文中文'
  const fake = svnAdapter(() => success(text))
  const result = expectOk(await fake.adapter.diff(WC_ROOT, REPOSITORY_ID, { revisionB: '5', maxBytes: 4 }))
  assert.equal(result.truncated, true)
  assert.ok(result.bytes <= 4)
  assert.equal(result.text, '中')
  assert.match(result.truncationReason ?? '', /4 byte limit/)
})

test('diff: detects binary output by svn marker and by NUL bytes', async () => {
  const marker = svnAdapter(() => success('Index: a.bin\n===================================================================\nCannot display: file marked as a binary type.\nsvn:mime-type = application/octet-stream\n'))
  const markerResult = expectOk(await marker.adapter.diff(WC_ROOT, REPOSITORY_ID, { revisionB: '5', maxBytes: 4096 }))
  assert.equal(markerResult.binary, true)
  assert.equal(markerResult.text, '')
  assert.equal(markerResult.bytes, 0)

  const nul = svnAdapter(() => success('Index: a.bin\nBinary\0content'))
  const nulResult = expectOk(await nul.adapter.diff(WC_ROOT, REPOSITORY_ID, { revisionB: '5', maxBytes: 4096 }))
  assert.equal(nulResult.binary, true)
  assert.equal(nulResult.text, '')
})

test('diff: maps a deadline kill and a non-working-copy failure', async () => {
  const timedOut = svnAdapter(() => ({ exitCode: null, stdout: '', stderr: '', timedOut: true }))
  assert.equal(expectErr(await timedOut.adapter.diff(WC_ROOT, REPOSITORY_ID, { revisionB: '5', maxBytes: 4096 })).code, 'timeout')

  const notRepo = svnAdapter(() => failure("svn: E155007: '/tmp/x' is not a working copy"))
  assert.equal(expectErr(await notRepo.adapter.diff(WC_ROOT, REPOSITORY_ID, { revisionB: '5', maxBytes: 4096 })).code, 'not-a-repository')
})

// ---------------------------------------------------------------------------
// status / beforeState
// ---------------------------------------------------------------------------

test('status: reports dirty state, conflicts and property-only modifications', async () => {
  const fake = svnAdapter(argv => {
    switch (argv[1]) {
      case 'status': return success(STATUS_XML)
      case 'info': return success(INFO_XML)
      default: return failure('unexpected')
    }
  })
  const status = expectOk(await fake.adapter.status(WC_ROOT, REPOSITORY_ID))
  assert.equal(status.vcsType, 'svn')
  assert.equal(status.clean, false)
  assert.equal(status.head, '4')
  assert.equal(status.branch, undefined)
  assert.deepEqual(status.conflicts, ['conflicted.txt'])
  const byPath = new Map(status.entries.map(entry => [entry.path, entry.status]))
  assert.equal(byPath.get('modified.txt'), 'modified')
  assert.equal(byPath.get('deleted.txt'), 'deleted')
  assert.equal(byPath.get('conflicted.txt'), 'conflicted')
  assert.equal(byPath.get('untracked.txt'), 'unversioned')
  assert.equal(byPath.get('ignored.log'), 'ignored')
  assert.equal(byPath.get('props-only.txt'), 'modified')
  assert.ok(status.warnings?.some(warning => warning.includes('unversioned')))
})

test('status: unversioned-only trees stay clean and are surfaced as a warning', async () => {
  const fake = svnAdapter(argv => {
    switch (argv[1]) {
      case 'status': return success(statusXml([{ path: 'new.txt', item: 'unversioned' }, { path: 'cache.tmp', item: 'ignored' }]))
      case 'info': return success(INFO_XML)
      default: return failure('unexpected')
    }
  })
  const status = expectOk(await fake.adapter.status(WC_ROOT, REPOSITORY_ID))
  assert.equal(status.clean, true)
  assert.equal(status.entries.length, 2)
  assert.ok(status.warnings?.some(warning => warning.includes('1 unversioned path')))
})

test('status: caps a pathological entry list', async () => {
  const entries = Array.from({ length: 2005 }, (_, index) => ({ path: `file-${index}.txt`, item: 'modified' }))
  const fake = svnAdapter(argv => {
    switch (argv[1]) {
      case 'status': return success(statusXml(entries))
      case 'info': return success(INFO_XML)
      default: return failure('unexpected')
    }
  })
  const status = expectOk(await fake.adapter.status(WC_ROOT, REPOSITORY_ID))
  assert.equal(status.entries.length, 2000)
  assert.equal(status.truncated, true)
  assert.ok(status.warnings?.some(warning => warning.includes('truncated')))
})

test('status: maps a missing client and a status failure', async () => {
  const missing = svnAdapter(() => success(STATUS_XML), null)
  assert.equal(expectErr(await missing.adapter.status(WC_ROOT, REPOSITORY_ID)).code, 'vcs-not-installed')

  const failing = svnAdapter(() => failure('svn: E155004: Working copy is locked'))
  assert.equal(expectErr(await failing.adapter.status(WC_ROOT, REPOSITORY_ID)).code, 'operation-failed')
})

test('beforeState: reports base revision, cleanliness and redacted remotes without a staging area', async () => {
  const fake = svnAdapter(argv => {
    switch (argv[1]) {
      case 'status': return success(STATUS_XML)
      case 'info': return success(INFO_XML)
      default: return failure('unexpected')
    }
  })
  const before = expectOk(await fake.adapter.beforeState(WC_ROOT, 'commit'))
  assert.equal(before.revision, '4')
  assert.equal(before.head, '4')
  assert.equal(before.clean, false)
  assert.equal(before.stagedFiles, undefined)
  assert.deepEqual(before.remoteUrls, ['https://svn.example.com/repos/trunk?token=***'])
})

// ---------------------------------------------------------------------------
// planOperation
// ---------------------------------------------------------------------------

test('plan: update plans svn update with postponed conflicts and warns when dirty', async () => {
  const fake = svnAdapter(() => success(''))
  const plan = expectOk(await fake.adapter.planOperation(WC_ROOT, 'update', {}, { revision: '4', clean: true }))
  assert.equal(plan.allowed, true)
  assert.equal(plan.network, true)
  assert.deepEqual(plan.argv, [SVN_EXECUTABLE, 'update', '--non-interactive', '--accept', 'postpone', '--', resolve(WC_ROOT)])
  assert.equal(plan.cwd, resolve(WC_ROOT))
  assert.deepEqual(plan.warnings, [])
  assert.equal(plan.argv.includes('--username'), false)

  const dirtyPlan = expectOk(await fake.adapter.planOperation(WC_ROOT, 'update', {}, { revision: '4', clean: false }))
  assert.ok(dirtyPlan.warnings.some(warning => warning.includes('local modifications')))
})

test('plan: commit requires a bounded, non-blank message', async () => {
  const fake = svnAdapter(() => success(''))
  const cases: OperationParams[] = [
    {},
    { message: '' },
    { message: '    ' },
    { message: 'x'.repeat(4001) },
    { message: 42 },
  ]
  for (const params of cases) {
    const error = expectErr(await fake.adapter.planOperation(WC_ROOT, 'commit', params, { clean: false }))
    assert.equal(error.code, 'invalid-request', `expected rejection for ${JSON.stringify(params).slice(0, 60)}`)
  }
  assert.equal(fake.calls.length, 0)
})

test('plan: commit plans validated explicit paths after -- and warns on no modifications', async () => {
  let clean = false
  const fake = svnAdapter(argv => {
    if (argv[1] !== 'status') return failure('unexpected')
    return success(clean ? statusXml([]) : STATUS_XML)
  })
  const plan = expectOk(await fake.adapter.planOperation(
    WC_ROOT,
    'commit',
    { message: 'fix: parser', paths: 'src/a.ts, docs/b.md' },
    { clean: false },
  ))
  assert.equal(plan.allowed, true)
  assert.equal(plan.network, true)
  assert.equal(plan.argv[0], SVN_EXECUTABLE)
  assert.deepEqual(plan.argv.slice(1, 6), ['commit', '--non-interactive', '-m', 'fix: parser', '--'])
  assert.deepEqual(plan.argv.slice(6), [
    join(resolve(WC_ROOT), 'src', 'a.ts'),
    join(resolve(WC_ROOT), 'docs', 'b.md'),
  ])
  assert.ok(plan.summary.includes('fix: parser'))
  assert.ok(!plan.warnings.some(warning => warning.includes('no local modifications')))

  clean = true
  const cleanPlan = expectOk(await fake.adapter.planOperation(
    WC_ROOT,
    'commit',
    { message: 'nothing to do' },
    { clean: true },
  ))
  assert.deepEqual(cleanPlan.argv.slice(6), [resolve(WC_ROOT)])
  assert.ok(cleanPlan.warnings.some(warning => warning.includes('no local modifications')))
  assert.ok(cleanPlan.warnings.some(warning => warning.includes('no explicit paths')))
})

test('plan: commit refuses empty explicit path lists and path escapes', async () => {
  const fake = svnAdapter(() => success(STATUS_XML))
  const emptyString = expectErr(await fake.adapter.planOperation(WC_ROOT, 'commit', { message: 'm', paths: '' }, { clean: false }))
  assert.equal(emptyString.code, 'invalid-request')

  for (const paths of ['../outside.txt', '/etc/passwd', 'C:\\Windows\\win.ini', 'src/../../escape']) {
    const error = expectErr(await fake.adapter.planOperation(WC_ROOT, 'commit', { message: 'm', paths }, { clean: false }))
    assert.equal(error.code, 'path-not-allowed', `expected path rejection for ${paths}`)
  }
})

test('plan: unsupported SVN write operations are refused without running a command', async () => {
  const fake = svnAdapter(() => {
    throw new Error('must not run a command while planning an unsupported operation')
  })
  for (const operation of ['fetch', 'pull', 'push', 'merge', 'rebase', 'switch'] as const) {
    const plan = expectOk(await fake.adapter.planOperation(WC_ROOT, operation, {}, {}))
    assert.equal(plan.allowed, false, `${operation} must be refused`)
    assert.ok((plan.blockedReason ?? '').length > 0)
    assert.deepEqual(plan.argv, [])
    assert.equal(plan.network, false)
  }
  assert.equal(fake.calls.length, 0)
})

test('plan: update and commit report vcs-not-installed when svn is missing', async () => {
  const missing = svnAdapter(() => success(''), null)
  assert.equal(expectErr(await missing.adapter.planOperation(WC_ROOT, 'update', {}, { clean: true })).code, 'vcs-not-installed')
  assert.equal(expectErr(await missing.adapter.planOperation(WC_ROOT, 'commit', { message: 'm' }, { clean: true })).code, 'vcs-not-installed')
})
