/**
 * Unit tests for the JSONL {@link TimelineStore}.
 *
 * Every test uses a throw-away directory under `os.tmpdir()`; nothing here
 * touches the user's DSH data directory or a real repository.
 * @module dsh-vcs-timeline/tests/storage
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SCHEMA_VERSION } from '../shared/contracts.ts'
import type {
  ChangeSet,
  OperationAttempt,
  Repository,
  TimelineQuery,
  VcsEvent,
} from '../shared/contracts.ts'
import { createJsonlStore } from '../host/storage/jsonl.ts'
import type { JsonlStoreOptions, JsonlTimelineStore } from '../host/storage/jsonl.ts'
import { StoreError } from '../host/storage/interface.ts'

const BASE_TIME = Date.UTC(2026, 0, 1, 0, 0, 0)

/** ISO timestamp `minutes` after the fixed test epoch. */
function isoAt(minutes: number): string {
  return new Date(BASE_TIME + minutes * 60_000).toISOString()
}

/** One timeline event with deterministic, increasing timestamps. */
function makeEvent(index: number, overrides: Partial<VcsEvent> = {}): VcsEvent {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `evt-${String(index).padStart(4, '0')}`,
    repositoryId: 'git:/repo/alpha',
    vcsType: 'git',
    eventType: 'commit',
    source: 'repository',
    timestamp: isoAt(index),
    actor: 'alice',
    summary: `commit ${index}`,
    commitHash: `hash-${String(index).padStart(4, '0')}`,
    ...overrides,
  }
}

/** One repository snapshot. */
function makeRepository(overrides: Partial<Repository> = {}): Repository {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'git:/repo/alpha',
    vcsType: 'git',
    rootPath: 'C:/work/alpha',
    displayName: 'alpha',
    detectedAt: isoAt(0),
    lastSeenAt: isoAt(0),
    ...overrides,
  }
}

/** One change set. */
function makeChangeSet(overrides: Partial<ChangeSet> = {}): ChangeSet {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'cs-0001',
    repositoryId: 'git:/repo/alpha',
    vcsType: 'git',
    revision: 'hash-0001',
    createdAt: isoAt(1),
    files: [{ path: 'src/a.ts', status: 'modified', additions: 2, deletions: 1 }],
    ...overrides,
  }
}

/** One operation attempt record. */
function makeOperation(overrides: Partial<OperationAttempt> = {}): OperationAttempt {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'op-0001',
    repositoryId: 'git:/repo/alpha',
    vcsType: 'git',
    operation: 'commit',
    state: 'started',
    startedAt: isoAt(0),
    actor: 'user-via-plugin',
    requestSummary: 'commit staged changes',
    correlationId: 'corr-0001',
    ...overrides,
  }
}

/** Temp store plus its cleanup hook. */
interface TempStore {
  dir: string
  store: JsonlTimelineStore
  cleanup(): Promise<void>
}

/** Create a store in a fresh temp directory. */
async function makeStore(options: Omit<JsonlStoreOptions, 'dir'> = {}): Promise<TempStore> {
  const dir = await mkdtemp(join(tmpdir(), 'dvt-jsonl-'))
  const store = createJsonlStore({ dir, ...options })
  return {
    dir,
    store,
    async cleanup(): Promise<void> {
      await store.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** Run one test body against a throw-away store and always clean up. */
async function withStore(
  body: (context: TempStore) => Promise<void>,
  options: Omit<JsonlStoreOptions, 'dir'> = {},
): Promise<void> {
  const context = await makeStore(options)
  try {
    await body(context)
  } finally {
    await context.cleanup()
  }
}

/** Page through every matching event. */
async function collectEvents(
  store: JsonlTimelineStore,
  query: TimelineQuery,
  pageSize = 50,
): Promise<{ events: VcsEvent[]; warnings: string[] }> {
  const events: VcsEvent[] = []
  const warnings: string[] = []
  let cursor: string | null = null
  for (let guard = 0; guard < 500; guard += 1) {
    const page = await store.queryEvents({ ...query, cursor, limit: pageSize })
    events.push(...page.events)
    warnings.push(...(page.warnings ?? []))
    if (!page.hasMore) {
      assert.equal(page.nextCursor, null)
      return { events, warnings }
    }
    assert.notEqual(page.nextCursor, null)
    cursor = page.nextCursor
  }
  throw new Error('event pagination did not terminate')
}

/** Parse every line of one JSONL generation. */
async function readJsonLines(path: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(path, 'utf8')
  return raw
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

test('queries on an empty store return empty pages and create no files', async () => {
  await withStore(async ({ dir, store }) => {
    const page = await store.queryEvents({ repositoryId: 'git:/repo/alpha' })
    assert.deepEqual(page.events, [])
    assert.equal(page.hasMore, false)
    assert.equal(page.nextCursor, null)

    const operations = await store.queryOperations({})
    assert.deepEqual(operations.operations, [])
    assert.equal(operations.hasMore, false)

    assert.deepEqual(await store.listRepositories(), [])
    assert.equal(await store.getRepository('git:/repo/alpha'), undefined)
    assert.equal(await store.getOperation('op-absent'), undefined)

    await assert.rejects(stat(join(dir, 'events.jsonl')))
    await store.close()
  })
})

test('rejects unusable store options', () => {
  assert.throws(() => createJsonlStore({ dir: '   ' }), (error: unknown) => error instanceof StoreError)
  assert.throws(() => createJsonlStore({ dir: 'x', maxFileBytes: 0 }), (error: unknown) => error instanceof StoreError)
  assert.throws(() => createJsonlStore({ dir: 'x', maxScanRecords: 0 }), (error: unknown) => error instanceof StoreError)
})

test('appends and reads back every record type with schemaVersion 1 lines', async () => {
  await withStore(async ({ dir, store }) => {
    assert.equal(store.location(), dir)
    await store.init()
    assert.equal((await stat(dir)).isDirectory(), true)

    const repository = makeRepository()
    const event = makeEvent(0)
    const changeSet = makeChangeSet()
    const operation = makeOperation()

    await store.appendRepository(repository)
    await store.appendEvent(event)
    await store.appendChangeSet(changeSet)
    await store.appendOperation(operation)

    assert.deepEqual(await store.getRepository(repository.id), repository)
    assert.deepEqual(await store.listRepositories(), [repository])

    const page = await store.queryEvents({ repositoryId: event.repositoryId })
    assert.deepEqual(page.events, [event])

    const operations = await store.queryOperations({})
    assert.equal(operations.operations.length, 1)
    assert.deepEqual(operations.operations[0], operation)
    assert.deepEqual(await store.getOperation(operation.id), operation)

    // Raw layout: one JSON object per line, newline terminated, stamped version 1.
    for (const name of ['repositories.jsonl', 'events.jsonl', 'changesets.jsonl', 'operations.jsonl']) {
      const raw = await readFile(join(dir, name), 'utf8')
      assert.equal(raw.endsWith('\n'), true)
      const lines = raw.split('\n').filter(line => line !== '')
      assert.equal(lines.length, 1)
      for (const line of lines) {
        const record = JSON.parse(line) as Record<string, unknown>
        assert.equal(record.schemaVersion, 1)
      }
    }
    const changeSetLines = await readJsonLines(join(dir, 'changesets.jsonl'))
    assert.equal(changeSetLines[0]?.id, changeSet.id)
  })
})

test('200 concurrent event appends are each readable exactly once, newest first', async () => {
  await withStore(async ({ store }) => {
    const repositoryId = 'git:/repo/alpha'
    const events = Array.from({ length: 200 }, (_, index) => makeEvent(index))
    await Promise.all(events.map(event => store.appendEvent(event)))

    const collected = await collectEvents(store, { repositoryId }, 50)
    assert.deepEqual(collected.warnings, [])
    assert.equal(collected.events.length, 200)
    const ids = collected.events.map(event => event.id)
    assert.equal(new Set(ids).size, 200)
    assert.equal(ids[0], 'evt-0199')
    assert.equal(ids[199], 'evt-0000')

    // Strictly descending timestamps across page boundaries.
    for (let index = 1; index < collected.events.length; index += 1) {
      const previous = collected.events[index - 1]
      const current = collected.events[index]
      assert.ok(previous !== undefined && current !== undefined)
      assert.ok(Date.parse(previous.timestamp) >= Date.parse(current.timestamp))
    }
  })
})

test('tolerates a corrupt trailing partial line and repairs the newline on the next append', async () => {
  await withStore(async ({ dir, store }) => {
    const repositoryId = 'git:/repo/alpha'
    for (const index of [0, 1, 2]) await store.appendEvent(makeEvent(index))

    const file = join(dir, 'events.jsonl')
    await appendFile(file, '{"schemaVersion":1,"id":"trunc', 'utf8')

    const before = await collectEvents(store, { repositoryId })
    assert.equal(before.events.length, 3)
    assert.equal(before.warnings.length, 1)
    assert.match(before.warnings[0] ?? '', /skipped 1 unreadable record\(s\) in events\.jsonl/)

    // A write after the damaged fragment must not be swallowed by it.
    await store.appendEvent(makeEvent(3))
    const after = await collectEvents(store, { repositoryId })
    assert.equal(after.events.length, 4)
    assert.deepEqual(after.events.map(event => event.id), ['evt-0003', 'evt-0002', 'evt-0001', 'evt-0000'])
    assert.equal(after.warnings.length, 1)

    // Four records plus the damaged fragment sit on disk; only the fragment is bad.
    const rawLines = (await readFile(file, 'utf8')).split('\n').filter(line => line !== '')
    assert.equal(rawLines.length, 5)
    assert.equal(rawLines[3], '{"schemaVersion":1,"id":"trunc')
    const lastLine = rawLines[4]
    assert.ok(lastLine !== undefined)
    assert.equal((JSON.parse(lastLine) as Record<string, unknown>).id, 'evt-0003')
  })
})

test('skips corrupt middle lines and reports one summary warning', async () => {
  await withStore(async ({ dir, store }) => {
    const repositoryId = 'git:/repo/alpha'
    for (const index of [0, 1, 2]) await store.appendEvent(makeEvent(index))

    const file = join(dir, 'events.jsonl')
    const raw = await readFile(file, 'utf8')
    const lines = raw.split('\n').filter(line => line !== '')
    lines.splice(1, 0, '{"schemaVersion":1, broken')
    lines.splice(3, 0, 'not-json-at-all')
    await writeFile(file, `${lines.join('\n')}\n`, 'utf8')

    const collected = await collectEvents(store, { repositoryId })
    assert.equal(collected.events.length, 3)
    assert.equal(collected.warnings.length, 1)
    assert.match(collected.warnings[0] ?? '', /skipped 2 unreadable record\(s\) in events\.jsonl/)
    assert.deepEqual(collected.events.map(event => event.id), ['evt-0002', 'evt-0001', 'evt-0000'])
  })
})

test('ignores records with an unsupported schemaVersion but keeps valid ones', async () => {
  await withStore(async ({ dir, store }) => {
    const repositoryId = 'git:/repo/alpha'
    await store.appendEvent(makeEvent(0))
    const future = { ...makeEvent(1), schemaVersion: 2 }
    await appendFile(join(dir, 'events.jsonl'), `${JSON.stringify(future)}\n`, 'utf8')

    const page = await store.queryEvents({ repositoryId })
    assert.equal(page.events.length, 1)
    assert.equal(page.events[0]?.id, 'evt-0000')
    assert.equal(page.warnings?.length, 1)
    assert.match(page.warnings?.[0] ?? '', /incompatible-schema/)
  })
})

test('pages newest first with stable cursors: no duplicates, no skips', async () => {
  await withStore(async ({ store }) => {
    const repositoryId = 'git:/repo/alpha'
    for (let index = 0; index < 25; index += 1) await store.appendEvent(makeEvent(index))

    const collected = await collectEvents(store, { repositoryId }, 7)
    assert.equal(collected.events.length, 25)
    assert.equal(new Set(collected.events.map(event => event.id)).size, 25)
    assert.deepEqual(
      collected.events.map(event => event.id),
      Array.from({ length: 25 }, (_, index) => `evt-${String(24 - index).padStart(4, '0')}`),
    )

    // Explicit page-by-page cursor walk.
    const first = await store.queryEvents({ repositoryId, limit: 7 })
    assert.equal(first.events.length, 7)
    assert.equal(first.hasMore, true)
    assert.notEqual(first.nextCursor, null)
    const second = await store.queryEvents({ repositoryId, limit: 7, cursor: first.nextCursor })
    assert.equal(second.events.length, 7)
    assert.equal(second.events[0]?.id, 'evt-0017')
    assert.equal(second.hasMore, true)

    // Default page size applies when limit is omitted.
    const defaultPage = await store.queryEvents({ repositoryId })
    assert.equal(defaultPage.events.length, 25)
    assert.equal(defaultPage.hasMore, false)

    // Invalid cursors are ignored with a warning instead of throwing.
    const bogus = await store.queryEvents({ repositoryId, cursor: 'not-a-cursor', limit: 3 })
    assert.equal(bogus.events.length, 3)
    assert.equal(bogus.events[0]?.id, 'evt-0024')
    assert.match(bogus.warnings?.[0] ?? '', /malformed pagination cursor/)
  })
})

test('clamps the page size to [1, 100] and caps scanned records', async () => {
  await withStore(async ({ store }) => {
    const repositoryId = 'git:/repo/alpha'
    for (let index = 0; index < 120; index += 1) await store.appendEvent(makeEvent(index))

    const clamped = await store.queryEvents({ repositoryId, limit: 500 })
    assert.equal(clamped.events.length, 100)
    assert.equal(clamped.hasMore, true)

    const minimum = await store.queryEvents({ repositoryId, limit: 0 })
    assert.equal(minimum.events.length, 1)
  })

  await withStore(async ({ store }) => {
    const repositoryId = 'git:/repo/alpha'
    for (let index = 0; index < 5; index += 1) await store.appendEvent(makeEvent(index))
    const page = await store.queryEvents({ repositoryId, limit: 5 })
    assert.equal(page.events.length, 2)
    assert.equal(page.hasMore, false)
    assert.match(page.warnings?.join(' ') ?? '', /scan cap/)
  }, { maxScanRecords: 2 })
})

test('filters events by type, author, text and inclusive date bounds', async () => {
  await withStore(async ({ store }) => {
    const alpha = 'git:/repo/alpha'
    const beta = 'git:/repo/beta'
    await store.appendEvent(makeEvent(0, { eventType: 'commit', actor: 'alice', summary: 'Initial commit', timestamp: isoAt(0) }))
    await store.appendEvent(makeEvent(1, { eventType: 'push', actor: 'bob', summary: 'Push to origin', timestamp: isoAt(1440) }))
    await store.appendEvent(makeEvent(2, { eventType: 'update', actor: 'ALICE', summary: 'svn update trunk', timestamp: isoAt(2880) }))
    await store.appendEvent(makeEvent(3, { repositoryId: beta, eventType: 'commit', actor: 'carol', summary: 'other repo commit', timestamp: isoAt(4320) }))

    const ids = async (query: TimelineQuery): Promise<string[]> => (await collectEvents(store, query)).events.map(event => event.id)

    assert.deepEqual(await ids({ repositoryId: alpha, eventTypes: ['commit'] }), ['evt-0000'])
    assert.deepEqual(await ids({ repositoryId: alpha, eventTypes: ['push', 'update'] }), ['evt-0002', 'evt-0001'])
    assert.deepEqual(await ids({ repositoryId: alpha, author: 'alice' }), ['evt-0002', 'evt-0000'])
    assert.deepEqual(await ids({ repositoryId: alpha, author: 'ALICE' }), ['evt-0002', 'evt-0000'])
    assert.deepEqual(await ids({ repositoryId: alpha, text: 'UPDATE' }), ['evt-0002'])
    assert.deepEqual(await ids({ repositoryId: alpha, text: 'push' }), ['evt-0001'])
    assert.deepEqual(await ids({ repositoryId: alpha, since: isoAt(1440) }), ['evt-0002', 'evt-0001'])
    assert.deepEqual(await ids({ repositoryId: alpha, until: isoAt(1440) }), ['evt-0001', 'evt-0000'])
    assert.deepEqual(await ids({ repositoryId: alpha, since: isoAt(1440), until: isoAt(1440) }), ['evt-0001'])
    assert.deepEqual(await ids({ repositoryId: beta }), ['evt-0003'])
    assert.deepEqual(await ids({ repositoryId: alpha, text: 'no-such-text' }), [])
    assert.deepEqual(await ids({ repositoryId: alpha, eventTypes: ['push'], author: 'alice' }), [])
  })
})

test('folds repository snapshots to the latest lastSeenAt per id, newest first', async () => {
  await withStore(async ({ store }) => {
    await store.appendRepository(makeRepository({ displayName: 'alpha-old', lastSeenAt: isoAt(0) }))
    await store.appendRepository(makeRepository({ id: 'git:/repo/beta', displayName: 'beta', rootPath: 'C:/work/beta', lastSeenAt: isoAt(2) }))
    await store.appendRepository(makeRepository({ displayName: 'alpha-new', lastSeenAt: isoAt(5) }))

    const repositories = await store.listRepositories()
    assert.deepEqual(repositories.map(repository => repository.id), ['git:/repo/alpha', 'git:/repo/beta'])
    assert.equal(repositories[0]?.displayName, 'alpha-new')

    const alpha = await store.getRepository('git:/repo/alpha')
    assert.equal(alpha?.displayName, 'alpha-new')
    assert.equal((await store.getRepository('git:/repo/missing')), undefined)
  })
})

test('folds operations started -> succeeded/failed and orders by first startedAt', async () => {
  await withStore(async ({ dir, store }) => {
    const alpha = 'git:/repo/alpha'
    const beta = 'git:/repo/beta'
    const attemptA = makeOperation({ id: 'op-A', repositoryId: alpha, startedAt: isoAt(0) })
    const attemptB = makeOperation({ id: 'op-B', repositoryId: beta, startedAt: isoAt(2), operation: 'push' })
    await store.appendOperation(attemptA)
    await store.appendOperation(attemptB)
    await store.appendOperation({
      ...attemptA,
      state: 'succeeded',
      finishedAt: isoAt(1),
      exitCode: 0,
      afterRevision: 'hash-0100',
    })
    await store.appendOperation({
      ...attemptB,
      state: 'failed',
      finishedAt: isoAt(4),
      exitCode: 1,
      errorCode: 'operation-failed',
      safeErrorMessage: 'push rejected',
    })

    const page = await store.queryOperations({})
    assert.equal(page.operations.length, 2)
    assert.equal(page.hasMore, false)
    assert.deepEqual(page.operations.map(operation => operation.id), ['op-B', 'op-A'])
    assert.equal(page.operations[0]?.state, 'failed')
    assert.equal(page.operations[0]?.exitCode, 1)
    assert.equal(page.operations[0]?.errorCode, 'operation-failed')
    assert.equal(page.operations[1]?.state, 'succeeded')
    assert.equal(page.operations[1]?.startedAt, isoAt(0))
    assert.equal(page.operations[1]?.finishedAt, isoAt(1))
    assert.equal(page.operations[1]?.afterRevision, 'hash-0100')

    assert.equal((await store.getOperation('op-A'))?.state, 'succeeded')
    assert.equal((await store.getOperation('op-B'))?.state, 'failed')
    assert.equal(await store.getOperation('op-missing'), undefined)

    const betaOnly = await store.queryOperations({ repositoryId: beta })
    assert.deepEqual(betaOnly.operations.map(operation => operation.id), ['op-B'])

    const firstPage = await store.queryOperations({ limit: 1 })
    assert.equal(firstPage.operations.length, 1)
    assert.equal(firstPage.hasMore, true)
    const secondPage = await store.queryOperations({ limit: 1, cursor: firstPage.nextCursor })
    assert.equal(secondPage.operations.length, 1)
    assert.equal(secondPage.operations[0]?.id, 'op-A')
    assert.equal(secondPage.hasMore, false)

    // Append-only: four records on disk, two of them terminal.
    const lines = await readJsonLines(join(dir, 'operations.jsonl'))
    assert.equal(lines.length, 4)
    assert.deepEqual(lines.map(line => line.state), ['started', 'started', 'succeeded', 'failed'])
  })
})

test('rotates an oversized generation to <name>.1.jsonl before appending', async () => {
  const sample = makeEvent(0)
  const lineBytes = Buffer.byteLength(`${JSON.stringify({ ...sample, schemaVersion: SCHEMA_VERSION })}\n`, 'utf8')
  await withStore(async ({ dir, store }) => {
    const repositoryId = 'git:/repo/alpha'
    const maxFileBytes = lineBytes + 4
    assert.ok(maxFileBytes > 0)
    await store.appendEvent(makeEvent(0))
    await store.appendEvent(makeEvent(1))
    // Two lines are already over the threshold; the third append rotates first.
    assert.equal((await collectEvents(store, { repositoryId })).events.length, 2)

    await store.appendEvent(makeEvent(2))

    const current = await readJsonLines(join(dir, 'events.jsonl'))
    assert.deepEqual(current.map(line => line.id), ['evt-0002'])
    const rotated = await readJsonLines(join(dir, 'events.1.jsonl'))
    assert.deepEqual(rotated.map(line => line.id), ['evt-0000', 'evt-0001'])

    const page = await store.queryEvents({ repositoryId })
    assert.deepEqual(page.events.map(event => event.id), ['evt-0002'])
    assert.equal(page.hasMore, false)
  }, { maxFileBytes: lineBytes + 4 })
})

test('redacts secrets from operation summaries before writing', async () => {
  await withStore(async ({ dir, store }) => {
    const secret = 'supersecretvalue'
    await store.appendOperation(makeOperation({
      requestSummary: `push https://user:pass@example.com/repo token=${secret}`,
      outputSummary: `remote: counting\ntoken=${secret}\nremote: done`,
      safeErrorMessage: `fatal: password=hunter2 token=${secret}`,
    }))

    const raw = await readFile(join(dir, 'operations.jsonl'), 'utf8')
    assert.equal(raw.includes(secret), false)
    assert.equal(raw.includes('hunter2'), false)
    assert.equal(raw.includes('user:pass'), false)
    assert.equal(raw.includes('***'), true)

    const page = await store.queryOperations({})
    const operation = page.operations[0]
    assert.ok(operation !== undefined)
    assert.equal(operation.requestSummary.includes(secret), false)
    assert.equal(operation.requestSummary.includes('***'), true)
    assert.equal(operation.outputSummary?.includes(secret), false)
    assert.equal(operation.safeErrorMessage?.includes('hunter2'), false)
  })
})

test('bounds requestSummary to 500 characters', async () => {
  await withStore(async ({ store }) => {
    await store.appendOperation(makeOperation({ requestSummary: 'x'.repeat(600) }))
    const page = await store.queryOperations({})
    assert.equal(page.operations[0]?.requestSummary.length, 500)
  })
})

test('a failed write rejects with StoreError and the write queue recovers', async () => {
  await withStore(async ({ dir, store }) => {
    const repositoryId = 'git:/repo/alpha'
    await store.init()
    // A directory where the file belongs makes the append itself fail.
    await mkdir(join(dir, 'events.jsonl'))
    await assert.rejects(
      store.appendEvent(makeEvent(0)),
      (error: unknown) => error instanceof StoreError && error.code === 'storage-failure',
    )

    await rm(join(dir, 'events.jsonl'), { recursive: true, force: true })
    await store.appendEvent(makeEvent(1))
    const collected = await collectEvents(store, { repositoryId })
    assert.deepEqual(collected.events.map(event => event.id), ['evt-0001'])
  })
})
