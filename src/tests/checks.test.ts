/**
 * Pure unit tests for the pre-commit rule engine.
 *
 * Every fixture is a synthetic unified diff shaped like real `git diff`
 * output; no repository, process or filesystem is touched. The tests pin down
 * each rule, the false-positive suppressions (above all the lone `=======`
 * separator), dedupe/sort/cap behaviour and the promise that a secret value is
 * never echoed back in a finding.
 * @module dsh-vcs-timeline/tests/checks.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCheckRules } from '../host/checks/rules.ts'

/** Build one `diff --git` section whose whole body is added lines. */
function addedDiff(path: string, addedLines: readonly string[], startLine = 1): string {
  const count = addedLines.length + 1
  const oldStart = Math.max(1, startLine - 1)
  return [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${oldStart},${count} +${startLine},${count} @@`,
    ...addedLines.map(line => `+${line}`),
    ' trailing context',
  ].join('\n')
}

/** Build one deleted-file section. */
function deletedDiff(path: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    'deleted file mode 100644',
    'index 1111111..0000000',
    `--- a/${path}`,
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-old line one',
    '-old line two',
  ].join('\n')
}

test('runCheckRules reports no-changes for empty and whitespace-only diffs', () => {
  for (const input of ['', '\n', '  \n\t\n']) {
    const result = runCheckRules(input)
    assert.equal(result.empty, true)
    assert.equal(result.filesChecked, 0)
    assert.deepEqual(result.findings, [{ rule: 'no-changes', severity: 'info' }])
  }

  const nonEmpty = runCheckRules(addedDiff('a.txt', ['hello']))
  assert.equal(nonEmpty.empty, false)
  assert.equal(nonEmpty.filesChecked, 1)
  assert.equal(nonEmpty.findings.length, 0)
})

test('runCheckRules reports a conflict block in added lines as blocking', () => {
  const diff = [
    'diff --git a/src/conflict.ts b/src/conflict.ts',
    'index 1111111..2222222 100644',
    '--- a/src/conflict.ts',
    '+++ b/src/conflict.ts',
    '@@ -1,3 +1,7 @@',
    '+<<<<<<< HEAD',
    ' const a = 1',
    '+=======',
    '+const b = 2',
    '+>>>>>>> feature/x',
  ].join('\n')

  const result = runCheckRules(diff)
  assert.equal(result.empty, false)
  assert.equal(result.filesChecked, 1)
  assert.equal(result.findings.length, 1)
  assert.deepEqual(result.findings[0], {
    rule: 'conflict-marker',
    severity: 'blocking',
    path: 'src/conflict.ts',
    line: 1,
    count: 3,
  })
})

test('runCheckRules suppresses a lone equals separator that is not a conflict marker', () => {
  const separator = addedDiff('docs/readme.md', ['======='])
  assert.deepEqual(runCheckRules(separator).findings, [])

  // An equals line in a different file must not borrow context from another
  // file's real conflict block.
  const mixed = [
    addedDiff('docs/readme.md', ['=======']),
    addedDiff('src/other.ts', ['=======']),
    addedDiff('src/conflict.ts', ['<<<<<<< HEAD', '=======', '>>>>>>> feature/x']),
  ].join('\n')

  const findings = runCheckRules(mixed).findings
  assert.equal(findings.filter(finding => finding.rule === 'conflict-marker').length, 1)
  const conflict = findings.find(finding => finding.rule === 'conflict-marker')
  assert.ok(conflict !== undefined)
  assert.equal(conflict.path, 'src/conflict.ts')
  assert.equal(conflict.count, 3)
})

test('runCheckRules counts a middle marker once another marker exists in the same file', () => {
  const diff = addedDiff('src/partial.ts', ['=======', '>>>>>>> feature/x'])
  const findings = runCheckRules(diff).findings
  const conflict = findings.find(finding => finding.rule === 'conflict-marker')
  assert.ok(conflict !== undefined)
  assert.equal(conflict.severity, 'blocking')
  assert.equal(conflict.count, 2)
})

test('runCheckRules ignores conflict markers that are only removed', () => {
  const diff = [
    'diff --git a/src/resolved.ts b/src/resolved.ts',
    'index 1111111..2222222 100644',
    '--- a/src/resolved.ts',
    '+++ b/src/resolved.ts',
    '@@ -1,3 +1,1 @@',
    '-<<<<<<< HEAD',
    '-const a = 1',
    '-=======',
    '-const b = 2',
    '->>>>>>> feature/x',
    '+const resolved = 1',
  ].join('\n')

  assert.deepEqual(runCheckRules(diff).findings, [])
})

test('runCheckRules flags private key headers without echoing key material', () => {
  const diff = addedDiff('keys/id_ed25519', [
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW',
    '-----END OPENSSH PRIVATE KEY-----',
    '-----BEGIN RSA PRIVATE KEY-----',
  ])

  const result = runCheckRules(diff)
  assert.equal(result.findings.length, 1)
  const key = result.findings[0]
  assert.ok(key !== undefined)
  assert.equal(key.rule, 'private-key')
  assert.equal(key.severity, 'blocking')
  assert.equal(key.path, 'keys/id_ed25519')
  assert.equal(key.count, 2)
  assert.equal(key.line, 1)
  assert.equal(key.detail, undefined)

  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes('PRIVATE KEY'), false)
  assert.equal(serialized.includes('b3BlbnNzaC1rZXktdjE'), false)
})

test('runCheckRules detects every documented secret pattern and never echoes the value', () => {
  const secrets = {
    aws: 'AKIAIOSFODNN7EXAMPLE',
    github: 'ghp_0123456789abcdefghijABCDEFGHIJ012345',
    fineGrained: 'github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
    slack: 'xoxb-123456789012-abcdefghij',
    openai: 'sk-abcdefghijklmnopqrstuvwxyz012345',
  }

  const diff = addedDiff('.env.local', [
    `const awsKey = "${secrets.aws}"`,
    `const githubToken = "${secrets.github}"`,
    `const fineGrained = "${secrets.fineGrained}"`,
    `const slackToken = "${secrets.slack}"`,
    `const openaiKey = "${secrets.openai}"`,
  ])

  const result = runCheckRules(diff)
  assert.equal(result.findings.length, 1)
  const finding = result.findings[0]
  assert.ok(finding !== undefined)
  assert.equal(finding.rule, 'secret-pattern')
  assert.equal(finding.severity, 'warning')
  assert.equal(finding.path, '.env.local')
  assert.equal(finding.count, 5)
  // `detail` is machine data and carries pattern names only, never the secret.
  assert.equal(
    finding.detail,
    'aws-access-key-id, github-token, github-fine-grained-token, slack-token, openai-api-key',
  )

  const serialized = JSON.stringify(result)
  for (const value of Object.values(secrets)) {
    assert.equal(serialized.includes(value), false, `finding leaked ${value.slice(0, 4)}…`)
  }
})

test('runCheckRules ignores short or lookalike token shapes', () => {
  const diff = addedDiff('src/config.ts', [
    'const aws = "AKIA1234"',
    'const shortOpenAi = "sk-short"',
    'const shortGithub = "ghp_abc"',
    'const slack = "xoxb-"',
    'const prose = "this line mentions a secret but has no token"',
  ])

  assert.deepEqual(runCheckRules(diff).findings, [])
})

test('runCheckRules flags every known lockfile by basename', () => {
  const lockfiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'go.sum', 'Cargo.lock', 'poetry.lock']
  const diff = lockfiles.map(path => addedDiff(path, ['version bump'])).join('\n')

  const result = runCheckRules(diff)
  assert.equal(result.filesChecked, 6)
  assert.equal(result.findings.length, 6)
  assert.deepEqual(
    result.findings.map(finding => finding.path),
    ['Cargo.lock', 'go.sum', 'package-lock.json', 'pnpm-lock.yaml', 'poetry.lock', 'yarn.lock'],
  )
  for (const finding of result.findings) {
    assert.equal(finding.rule, 'lockfile')
    assert.equal(finding.severity, 'warning')
    assert.equal(finding.detail, finding.path)
  }
})

test('runCheckRules flags deleted test files only', () => {
  const newTestFile = [
    'diff --git a/src/fresh.test.ts b/src/fresh.test.ts',
    'new file mode 100644',
    'index 0000000..2222222',
    '--- /dev/null',
    '+++ b/src/fresh.test.ts',
    '@@ -0,0 +1,1 @@',
    "+test('fresh', () => {})",
  ].join('\n')

  const diff = [
    deletedDiff('tests/old.test.ts'),
    deletedDiff('spec/old.spec.ts'),
    deletedDiff('src/app.ts'),
    newTestFile,
  ].join('\n')

  const result = runCheckRules(diff)
  assert.equal(result.filesChecked, 4)
  assert.equal(result.findings.length, 2)
  assert.deepEqual(
    result.findings.map(finding => [finding.rule, finding.severity, finding.path]),
    [
      ['test-deleted', 'warning', 'spec/old.spec.ts'],
      ['test-deleted', 'warning', 'tests/old.test.ts'],
    ],
  )
})

test('runCheckRules reports binary files in both Git output forms', () => {
  const textForm = [
    'diff --git a/bin.dat b/bin.dat',
    'index 1111111..2222222 100644',
    'Binary files a/bin.dat and b/bin.dat differ',
  ].join('\n')
  const patchForm = [
    'diff --git a/image.png b/image.png',
    'new file mode 100644',
    'index 0000000..1111111',
    'GIT binary patch',
    'literal 4',
    'LcmZQzU|?Vb',
  ].join('\n')

  const result = runCheckRules(`${textForm}\n${patchForm}`)
  assert.equal(result.filesChecked, 2)
  assert.deepEqual(
    result.findings.map(finding => [finding.rule, finding.severity, finding.path]),
    [
      ['binary-file', 'info', 'bin.dat'],
      ['binary-file', 'info', 'image.png'],
    ],
  )
})

test('runCheckRules flags files with more than 500 added lines and allows exactly 500', () => {
  const tooMany = Array.from({ length: 501 }, (_, index) => `line ${index}`)
  const atLimit = Array.from({ length: 500 }, (_, index) => `line ${index}`)
  const diff = [addedDiff('big.txt', tooMany), addedDiff('ok.txt', atLimit)].join('\n')

  const result = runCheckRules(diff)
  assert.equal(result.filesChecked, 2)
  assert.equal(result.findings.length, 1)
  const large = result.findings[0]
  assert.ok(large !== undefined)
  assert.equal(large.rule, 'large-file')
  assert.equal(large.severity, 'warning')
  assert.equal(large.path, 'big.txt')
  assert.equal(large.count, 501)
})

test('runCheckRules dedupes repeated rule+path findings and sorts by severity', () => {
  const big = Array.from({ length: 501 }, (_, index) => `row ${index}`)
  const conflict = addedDiff('src/conflict.ts', ['<<<<<<< HEAD', '=======', '>>>>>>> feature/x'])
  const diff = [
    conflict,
    addedDiff('generated/big.txt', big),
    addedDiff('package-lock.json', ['version bump']),
    addedDiff('bin.dat', ['binary-ish']),
    // The same path twice must collapse into one finding with summed counts.
    addedDiff('generated/big.txt', big),
    [
      'diff --git a/bin.dat b/bin.dat',
      'index 1111111..2222222 100644',
      'Binary files a/bin.dat and b/bin.dat differ',
    ].join('\n'),
  ].join('\n')

  const result = runCheckRules(diff)
  // The second `bin.dat` section is a text diff, so it does not merge with the
  // binary one; only `generated/big.txt` is duplicated.
  assert.equal(result.findings.length, 4)
  assert.deepEqual(
    result.findings.map(finding => [finding.rule, finding.severity]),
    [
      ['conflict-marker', 'blocking'],
      ['large-file', 'warning'],
      ['lockfile', 'warning'],
      ['binary-file', 'info'],
    ],
  )
  const large = result.findings.find(finding => finding.rule === 'large-file')
  assert.ok(large !== undefined)
  assert.equal(large.count, 1002)
})

test('runCheckRules clamps findings with maxFindings and the default cap', () => {
  const three = [
    addedDiff('a.ts', ['<<<<<<< HEAD', '=======', '>>>>>>> x']),
    addedDiff('b.ts', ['<<<<<<< HEAD', '=======', '>>>>>>> x']),
    addedDiff('c.ts', ['<<<<<<< HEAD', '=======', '>>>>>>> x']),
  ].join('\n')

  assert.equal(runCheckRules(three).findings.length, 3)
  assert.equal(runCheckRules(three, { maxFindings: 2 }).findings.length, 2)
  assert.equal(runCheckRules(three, { maxFindings: 0 }).findings.length, 0)
  assert.equal(runCheckRules(three, { maxFindings: Number.NaN }).findings.length, 3)

  const many = Array.from({ length: 60 }, (_, index) =>
    addedDiff(`conflict-${index}.ts`, ['<<<<<<< HEAD', '=======', '>>>>>>> x']),
  ).join('\n')
  const capped = runCheckRules(many)
  assert.equal(capped.filesChecked, 60)
  assert.equal(capped.findings.length, 50)
})

test('runCheckRules counts each diff --git section as one checked file', () => {
  const diff = [
    addedDiff('src/a.ts', ['const a = 1']),
    addedDiff('src/b.ts', ['const b = 2']),
    deletedDiff('src/c.ts'),
  ].join('\n')

  const result = runCheckRules(diff)
  assert.equal(result.filesChecked, 3)
  assert.equal(result.empty, false)
})

test('runCheckRules reports added-file line numbers from the hunk header', () => {
  const diff = [
    'diff --git a/config.ts b/config.ts',
    'index 1111111..2222222 100644',
    '--- a/config.ts',
    '+++ b/config.ts',
    '@@ -10,3 +10,5 @@',
    ' line ten',
    ' line eleven',
    '+const token = "sk-abcdefghijklmnopqrstuvwxyz012345"',
    ' line twelve',
  ].join('\n')

  const result = runCheckRules(diff)
  assert.equal(result.findings.length, 1)
  const token = result.findings[0]
  assert.ok(token !== undefined)
  assert.equal(token.rule, 'secret-pattern')
  assert.equal(token.line, 12)
  assert.equal(token.count, 1)
})

test('runCheckRules decodes quoted paths with spaces', () => {
  const diff = [
    'diff --git "a/space dir/bin.dat" "b/space dir/bin.dat"',
    'index 1111111..2222222 100644',
    'Binary files "a/space dir/bin.dat" and "b/space dir/bin.dat" differ',
  ].join('\n')

  const findings = runCheckRules(diff).findings
  assert.equal(findings.length, 1)
  const binary = findings[0]
  assert.ok(binary !== undefined)
  assert.equal(binary.rule, 'binary-file')
  assert.equal(binary.path, 'space dir/bin.dat')
})

test('runCheckRules parses CRLF diffs', () => {
  const diff = addedDiff('src/conflict.ts', ['<<<<<<< HEAD', '=======', '>>>>>>> feature/x']).replace(/\n/g, '\r\n')
  const result = runCheckRules(diff)
  assert.equal(result.filesChecked, 1)
  assert.equal(result.findings.length, 1)
  assert.equal(result.findings[0]?.rule, 'conflict-marker')
})
