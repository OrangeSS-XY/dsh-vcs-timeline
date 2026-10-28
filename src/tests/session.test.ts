/**
 * Session attribution tests: only successful file-writing tool calls count, the
 * session cwd resolves relative arguments, paths outside the repository are
 * dropped, and every row stays labelled `inferred`.
 * @module dsh-vcs-timeline/tests/session.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import type { Repository } from '../shared/contracts.ts'
import {
  createSessionChangesService,
  type LiveSessionLike,
  type LiveSessionStoreLike,
  type SessionEventLike,
} from '../host/session/changes.ts'
import { makeTempDir } from './helpers.ts'
import type { RepositoryResolver } from '../host/services/timeline-service.ts'
import { createFakeAdapter } from './helpers.ts'

const repository: Repository = {
  schemaVersion: 1,
  id: 'git:repo',
  vcsType: 'git',
  rootPath: '/repo',
  displayName: 'repo',
  currentBranch: 'main',
  detectedAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
}

/** Resolver that returns one repository rooted at `root`. */
function resolverFor(root: string): RepositoryResolver {
  const adapter = createFakeAdapter()
  return {
    adapters: { git: adapter, svn: adapter },
    async resolve() {
      return {
        ok: true,
        value: {
          repository: { ...repository, rootPath: root },
          root,
          adapter,
        },
      }
    },
  }
}

/** One live session over an in-memory event list. */
function sessionWith(events: SessionEventLike[], cwd?: string): LiveSessionLike {
  return {
    snapshotEvents: () => events,
    ...(cwd === undefined ? {} : { header: { cwd } }),
  }
}

/** A session store holding one session. */
function storeWith(id: string, session: LiveSessionLike): LiveSessionStoreLike {
  return { get: (target: string) => (target === id ? session : undefined) }
}

/** One tool call event. */
function call(callId: string, name: string, args: unknown, time = 1_800_000_000_000): SessionEventLike {
  return {
    type: 'tool/call',
    time,
    data: { name, callId, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  }
}

/** One tool result event. */
function result(callId: string, isError = false): SessionEventLike {
  return { type: 'tool/result', data: { message: { toolCallId: callId, isError } } }
}

test('successful file-writing calls are attributed, failed and read calls are not', async () => {
  const dir = await makeTempDir('dvt-session-')
  try {
    const events: SessionEventLike[] = [
      call('c1', 'write', { file_path: 'a.ts' }, 1_800_000_000_100),
      result('c1'),
      call('c2', 'edit', { filePath: 'src/b.ts' }, 1_800_000_000_200),
      result('c2'),
      call('c3', 'write', { file_path: 'failed.ts' }),
      result('c3', true),
      call('c4', 'read', { file_path: 'read-only.ts' }),
      result('c4'),
      call('c5', 'write', { file_path: join(dir.path, '..', 'outside.ts') }),
      result('c5'),
      call('c6', 'write', { file_path: join(dir.path, 'absolute.ts') }),
      result('c6'),
    ]
    // c2 is relative to the session cwd, which is the repository root.
    const service = createSessionChangesService({
      resolver: resolverFor(dir.path),
      sessions: () => storeWith('session-1', sessionWith(events, dir.path)),
      now: () => new Date('2026-01-02T00:00:00.000Z'),
    })
    const changes = await service.changes({ repositoryId: repository.id, sessionId: 'session-1' })
    assert.equal(changes.available, true)
    assert.deepEqual(changes.files.map(file => file.path), ['a.ts', 'absolute.ts', 'src/b.ts'])
    for (const file of changes.files) {
      assert.equal(file.confidence, 'inferred')
    }
    const relative = changes.files.find(file => file.path === 'src/b.ts')
    assert.equal(relative?.tool, 'edit')
    assert.equal(relative?.lastToolAt, new Date(1_800_000_000_200).toISOString())
  } finally {
    await dir.cleanup()
  }
})

test('a missing session id or a session that is not live is unavailable, never guessed', async () => {
  const dir = await makeTempDir('dvt-session-none-')
  try {
    const service = createSessionChangesService({
      resolver: resolverFor(dir.path),
      sessions: () => storeWith('live', sessionWith([], dir.path)),
    })
    const noId = await service.changes({ repositoryId: repository.id })
    assert.equal(noId.available, false)
    assert.ok((noId.warnings ?? []).some(warning => warning.includes('no session id')))

    const unknown = await service.changes({ repositoryId: repository.id, sessionId: 'archived' })
    assert.equal(unknown.available, false)
    assert.ok((unknown.warnings ?? []).some(warning => warning.includes('not live')))
    assert.deepEqual(unknown.files, [])
  } finally {
    await dir.cleanup()
  }
})

test('touches of the same path are folded into one inferred row', async () => {
  const dir = await makeTempDir('dvt-session-fold-')
  try {
    const events: SessionEventLike[] = [
      call('c1', 'write', { file_path: 'same.ts' }, 1_800_000_000_100),
      result('c1'),
      call('c2', 'edit', { file_path: 'same.ts' }, 1_800_000_000_300),
      result('c2'),
    ]
    const service = createSessionChangesService({
      resolver: resolverFor(dir.path),
      sessions: () => storeWith('s', sessionWith(events, dir.path)),
    })
    const changes = await service.changes({ repositoryId: repository.id, sessionId: 's' })
    assert.equal(changes.files.length, 1)
    assert.equal(changes.files[0]?.touches, 2)
    assert.equal(changes.files[0]?.tool, 'edit')
  } finally {
    await dir.cleanup()
  }
})
