/**
 * Pre-commit checks service tests: the service must run the rule engine over a
 * real adapter diff, add the untracked-file truth, and state SVN's missing
 * staging area instead of faking one.
 * @module dsh-vcs-timeline/tests/checks-service.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Repository } from '../shared/contracts.ts'
import { createChecksService } from '../host/checks/service.ts'
import { createFakeAdapter } from './helpers.ts'
import type { RepositoryResolver } from '../host/services/timeline-service.ts'

const gitRepository: Repository = {
  schemaVersion: 1,
  id: 'git:repo',
  vcsType: 'git',
  rootPath: '/repo',
  displayName: 'repo',
  currentBranch: 'main',
  detectedAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
}

const svnRepository: Repository = { ...gitRepository, id: 'svn:repo', vcsType: 'svn', currentBranch: undefined }

/** Resolver over one scripted adapter + repository. */
function resolverFor(repository: Repository, adapter: RepositoryResolver['adapters']['git']): RepositoryResolver {
  return {
    adapters: { git: adapter, svn: adapter },
    async resolve() {
      return { ok: true, value: { repository, root: '/repo', adapter } }
    },
  }
}

const conflictDiff = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,7 @@',
  '+<<<<<<< HEAD',
  ' ours',
  '+=======',
  ' theirs',
  '+>>>>>>> feature',
  'diff --git a/package-lock.json b/package-lock.json',
  '--- a/package-lock.json',
  '+++ b/package-lock.json',
  '@@ -1 +1 @@',
  '-{"lockfileVersion": 2}',
  '+{"lockfileVersion": 3}',
].join('\n')

test('checks run over the real diff and report blocking findings plus untracked truth', async () => {
  const adapter = createFakeAdapter({
    worktreeDiff: async () => ({
      repositoryId: gitRepository.id,
      filePath: null,
      staged: false,
      kind: 'tracked',
      text: conflictDiff,
      truncated: false,
      binary: false,
      bytes: conflictDiff.length,
    }),
    status: {
      ok: true,
      value: {
        repositoryId: gitRepository.id,
        vcsType: 'git',
        clean: false,
        entries: [{ path: 'src/new.ts', status: '?' }],
        conflicts: [],
      },
    },
  })
  const service = createChecksService({ resolver: resolverFor(gitRepository, adapter), now: () => new Date('2026-01-02T00:00:00.000Z') })
  const report = await service.checks({ repositoryId: gitRepository.id })
  assert.equal(report.scope, 'worktree')
  assert.equal(report.filesChecked, 2)
  const rules = report.findings.map(finding => finding.rule)
  assert.ok(rules.includes('conflict-marker'))
  assert.ok(rules.includes('lockfile'))
  assert.ok(rules.includes('untracked-skipped'))
  assert.equal(report.findings.find(finding => finding.rule === 'conflict-marker')?.severity, 'blocking')
  assert.equal(report.findings.find(finding => finding.rule === 'untracked-skipped')?.count, 1)
  assert.ok((report.warnings ?? []).some(warning => warning.includes('untracked')))
  assert.equal(report.generatedAt, '2026-01-02T00:00:00.000Z')
})

test('the staged side asks the adapter for the index and never inspects untracked files', async () => {
  let seenStaged: boolean | null = null
  const adapter = createFakeAdapter({
    worktreeDiff: async (query) => {
      seenStaged = query.staged
      return {
        repositoryId: gitRepository.id,
        filePath: null,
        staged: query.staged,
        kind: 'tracked',
        text: 'diff --git a/x b/x\n+one\n',
        truncated: false,
        binary: false,
        bytes: 10,
      }
    },
  })
  const service = createChecksService({ resolver: resolverFor(gitRepository, adapter) })
  const report = await service.checks({ repositoryId: gitRepository.id, staged: true })
  assert.equal(seenStaged, true)
  assert.equal(report.scope, 'staged')
  assert.ok(!report.findings.some(finding => finding.rule === 'untracked-skipped'))
})

test('SVN always answers for the working copy and says so', async () => {
  let seenStaged: boolean | null = null
  const adapter = createFakeAdapter({
    vcsType: 'svn',
    worktreeDiff: async (query) => {
      seenStaged = query.staged
      return {
        repositoryId: svnRepository.id,
        filePath: null,
        staged: query.staged,
        kind: 'tracked',
        text: '',
        truncated: false,
        binary: false,
        bytes: 0,
      }
    },
  })
  const service = createChecksService({ resolver: resolverFor(svnRepository, adapter) })
  const report = await service.checks({ repositoryId: svnRepository.id, staged: true })
  assert.equal(seenStaged, false)
  assert.equal(report.scope, 'worktree')
  assert.equal(report.empty, true)
  assert.ok((report.warnings ?? []).some(warning => warning.includes('svn-has-no-staging-area')))
})
