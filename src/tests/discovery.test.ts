/**
 * Discovery tests: bounded workspace scanning, nested-repository strategy,
 * skip directories, the trust gate, and explicit add/remove.
 * @module dsh-vcs-timeline/tests/discovery.test
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Repository } from '../shared/contracts.ts'
import { canonicalize, createRepositoryRegistry, MAX_DISCOVERY_DEPTH } from '../host/discovery.ts'
import { repositoryId } from '../host/security.ts'
import { createFakeAdapter, createMemoryStore, makeTempDir } from './helpers.ts'

/** Build an adapter pair whose `info` reports the root it is asked about. */
function adapters() {
  const info = (vcsType: 'git' | 'svn') => async (root: string): Promise<Repository> => ({
    schemaVersion: 1,
    id: repositoryId(vcsType, root),
    vcsType,
    rootPath: root,
    displayName: basename(root),
    detectedAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  })
  const git = createFakeAdapter({ vcsType: 'git', info: (root) => ({
    schemaVersion: 1,
    id: repositoryId('git', root),
    vcsType: 'git',
    rootPath: root,
    displayName: basename(root),
    detectedAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  }) })
  const svn = createFakeAdapter({ vcsType: 'svn', info: (root) => ({
    schemaVersion: 1,
    id: repositoryId('svn', root),
    vcsType: 'svn',
    rootPath: root,
    displayName: basename(root),
    detectedAt: '2026-01-01T00:00:00.000Z',
    lastSeenAt: '2026-01-01T00:00:00.000Z',
  }), detectRoot: null })
  void info
  return { git, svn }
}

/** Create a directory and mark it as a git root. */
async function makeGitRepo(path: string): Promise<void> {
  await mkdir(join(path, '.git'), { recursive: true })
}

test('discovers a repository under a workspace and reports its root', async () => {
  const dir = await makeTempDir()
  try {
    const project = join(dir.path, 'project')
    await mkdir(project, { recursive: true })
    await makeGitRepo(project)
    const canonicalWorkspace = await canonicalize(dir.path)
    assert.ok(canonicalWorkspace !== null)
    const store = createMemoryStore()
    const registry = createRepositoryRegistry({
      workspaces: () => [{ id: 'w1', path: canonicalWorkspace }],
      adapters: adapters(),
      store,
    })
    const result = await registry.list(null)
    assert.equal(result.repositories.length, 1)
    const canonicalProject = await canonicalize(project)
    assert.equal(result.repositories[0]!.rootPath, canonicalProject)
    assert.equal(result.repositories[0]!.vcsType, 'git')
    assert.equal(typeof result.repositories[0]!.id, 'string')
  } finally {
    await dir.cleanup()
  }
})

test('a workspace that is itself a repository is reported', async () => {
  const dir = await makeTempDir()
  try {
    await makeGitRepo(dir.path)
    const canonicalWorkspace = await canonicalize(dir.path)
    assert.ok(canonicalWorkspace !== null)
    const registry = createRepositoryRegistry({
      workspaces: () => [{ id: 'w1', path: canonicalWorkspace }],
      adapters: adapters(),
    })
    const result = await registry.list(null)
    assert.equal(result.repositories.length, 1)
    assert.equal(result.repositories[0]!.rootPath, canonicalWorkspace)
  } finally {
    await dir.cleanup()
  }
})

test('nested repositories are not double-listed', async () => {
  const dir = await makeTempDir()
  try {
    await makeGitRepo(dir.path)
    const inner = join(dir.path, 'inner')
    await mkdir(inner, { recursive: true })
    await makeGitRepo(inner)
    const canonicalWorkspace = await canonicalize(dir.path)
    assert.ok(canonicalWorkspace !== null)
    const registry = createRepositoryRegistry({
      workspaces: () => [{ id: 'w1', path: canonicalWorkspace }],
      adapters: adapters(),
    })
    const result = await registry.list(null)
    assert.equal(result.repositories.length, 1)
    assert.equal(result.repositories[0]!.rootPath, canonicalWorkspace)
  } finally {
    await dir.cleanup()
  }
})

test('skips node_modules and dot directories', async () => {
  const dir = await makeTempDir()
  try {
    await makeGitRepo(join(dir.path, 'node_modules', 'dep'))
    await makeGitRepo(join(dir.path, '.hidden', 'repo'))
    const canonicalWorkspace = await canonicalize(dir.path)
    assert.ok(canonicalWorkspace !== null)
    const registry = createRepositoryRegistry({
      workspaces: () => [{ id: 'w1', path: canonicalWorkspace }],
      adapters: adapters(),
    })
    const result = await registry.list(null)
    assert.equal(result.repositories.length, 0)
  } finally {
    await dir.cleanup()
  }
})

test('respects the discovery depth bound', async () => {
  const dir = await makeTempDir()
  try {
    const nested = join(dir.path, 'a', 'b', 'c')
    await mkdir(nested, { recursive: true })
    await makeGitRepo(nested)
    const deeper = join(nested, 'd', 'e')
    await mkdir(deeper, { recursive: true })
    await makeGitRepo(deeper)
    const canonicalWorkspace = await canonicalize(dir.path)
    assert.ok(canonicalWorkspace !== null)
    const registry = createRepositoryRegistry({
      workspaces: () => [{ id: 'w1', path: canonicalWorkspace }],
      adapters: adapters(),
    })
    const result = await registry.list(null)
    assert.equal(result.repositories.length, 1, `expected only the depth-${MAX_DISCOVERY_DEPTH} repository`)
    const canonicalNested = await canonicalize(nested)
    assert.equal(result.repositories[0]!.rootPath, canonicalNested)
  } finally {
    await dir.cleanup()
  }
})

test('the gate accepts known repositories and rejects unknown or out-of-workspace ids', async () => {
  const dir = await makeTempDir()
  try {
    await makeGitRepo(dir.path)
    const canonicalWorkspace = await canonicalize(dir.path)
    assert.ok(canonicalWorkspace !== null)
    let workspaces = [{ id: 'w1', path: canonicalWorkspace }]
    const registry = createRepositoryRegistry({
      workspaces: () => workspaces,
      adapters: adapters(),
    })
    const listed = await registry.list(null)
    const id = listed.repositories[0]!.id
    const accepted = await registry.gate(id)
    assert.equal(accepted.ok, true)

    const unknown = await registry.gate('git:c:/definitely/not/known')
    assert.equal(unknown.ok, false)
    assert.equal(unknown.ok === false ? unknown.error.code : '', 'unknown-repository')

    workspaces = []
    const denied = await registry.gate(id)
    assert.equal(denied.ok, false)
    assert.equal(denied.ok === false ? denied.error.code : '', 'path-not-allowed')
  } finally {
    await dir.cleanup()
  }
})

test('explicit add then remove controls a repository outside the workspaces', async () => {
  const dir = await makeTempDir()
  try {
    await makeGitRepo(dir.path)
    const registry = createRepositoryRegistry({
      workspaces: () => [],
      adapters: adapters(),
    })
    const added = await registry.add(dir.path)
    assert.equal(added.ok, true)
    const id = added.ok ? added.repository.id : ''
    assert.ok(id !== '')
    const gated = await registry.gate(id)
    assert.equal(gated.ok, true)
    assert.equal(await registry.remove(id), true)
    const after = await registry.gate(id)
    assert.equal(after.ok, false)
  } finally {
    await dir.cleanup()
  }
})

test('add refuses a directory without VCS metadata', async () => {
  const dir = await makeTempDir()
  try {
    await writeFile(join(dir.path, 'readme.txt'), 'hello', 'utf8')
    const registry = createRepositoryRegistry({ workspaces: () => [], adapters: adapters() })
    const added = await registry.add(dir.path)
    assert.equal(added.ok, false)
    assert.equal(added.ok === false ? added.error.code : '', 'not-a-repository')
  } finally {
    await dir.cleanup()
  }
})
