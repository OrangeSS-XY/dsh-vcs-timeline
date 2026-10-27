/**
 * Unit tests for the append-only audit writer.
 *
 * Every test writes into a throw-away directory under `os.tmpdir()`; the real
 * plugin data directory is never touched.
 * @module dsh-vcs-timeline/tests/audit
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAuditService } from '../host/audit/audit-service.ts'
import type { AuditStartInput } from '../host/audit/types.ts'
import { createJsonlStore } from '../host/storage/jsonl.ts'
import type { JsonlTimelineStore } from '../host/storage/jsonl.ts'
import { StoreError } from '../host/storage/interface.ts'
import type { TimelineStore } from '../host/storage/interface.ts'

const BASE_TIME = Date.UTC(2026, 2, 1, 12, 0, 0)

/** Temp store + audit service + cleanup. */
interface AuditContext {
  dir: string
  store: JsonlTimelineStore
  audit: ReturnType<typeof createAuditService>
  cleanup(): Promise<void>
}

/** Build a temp store and an audit service on top of it. */
async function makeContext(clock?: () => Date): Promise<AuditContext> {
  const dir = await mkdtemp(join(tmpdir(), 'dvt-audit-'))
  const store = createJsonlStore({ dir })
  const audit = createAuditService(store, clock === undefined ? {} : { now: clock })
  return {
    dir,
    store,
    audit,
    async cleanup(): Promise<void> {
      await store.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** Run one test body against a throw-away store and always clean up. */
async function withContext(
  body: (context: AuditContext) => Promise<void>,
  clock?: () => Date,
): Promise<void> {
  const context = await makeContext(clock)
  try {
    await body(context)
  } finally {
    await context.cleanup()
  }
}

/** A monotonic test clock: one minute per call. */
function steppingClock(): () => Date {
  let tick = 0
  return () => {
    const value = new Date(BASE_TIME + tick * 60_000)
    tick += 1
    return value
  }
}

/** Default start input. */
function startInput(overrides: Partial<AuditStartInput> = {}): AuditStartInput {
  return {
    repositoryId: 'git:/repo/alpha',
    vcsType: 'git',
    operation: 'push',
    requestSummary: 'push origin main',
    ...overrides,
  }
}

/** Parse every line of the operations generation. */
async function readOperationLines(dir: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(join(dir, 'operations.jsonl'), 'utf8')
  return raw
    .split('\n')
    .filter(line => line !== '')
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

/** A store stub whose only write always fails. */
function failingStore(message: string): TimelineStore {
  return {
    location: () => 'stub',
    init: async () => undefined,
    appendRepository: async () => undefined,
    appendEvent: async () => undefined,
    appendChangeSet: async () => undefined,
    appendOperation: async () => {
      throw new Error(message)
    },
    listRepositories: async () => [],
    getRepository: async () => undefined,
    queryEvents: async () => ({ events: [], nextCursor: null, hasMore: false }),
    queryOperations: async () => ({ operations: [], nextCursor: null, hasMore: false }),
    getOperation: async () => undefined,
    close: async () => undefined,
  }
}

test('start persists the started record before it returns', async () => {
  await withContext(async ({ dir, store, audit }) => {
    const fixed = new Date('2026-02-03T04:05:06.000Z')
    const attempt = await audit.start(startInput({ before: { branch: 'main', head: 'hash-0' } }))

    assert.match(attempt.id, /^op-[0-9a-f]{16}$/)
    assert.match(attempt.correlationId, /^corr-[0-9a-f]{32}$/)
    assert.equal(attempt.schemaVersion, 1)
    assert.equal(attempt.state, 'started')
    assert.equal(attempt.actor, 'user-via-plugin')
    assert.equal(attempt.beforeRevision, 'hash-0')

    // Already readable through the store the moment start() resolved.
    assert.deepEqual(await store.getOperation(attempt.id), attempt)

    const lines = await readOperationLines(dir)
    assert.equal(lines.length, 1)
    assert.equal(lines[0]?.state, 'started')
    assert.equal(lines[0]?.id, attempt.id)
    assert.ok(Number.isFinite(Date.parse(attempt.startedAt)))

    // Fixed clock is honoured exactly.
    let tick = 0
    const clocked = createAuditService(store, {
      now: () => {
        tick += 1
        return fixed
      },
    })
    const second = await clocked.start(startInput({ operation: 'fetch' }))
    assert.equal(second.startedAt, fixed.toISOString())
  })
})

test('finish appends a terminal record that folds over the started record', async () => {
  await withContext(async ({ dir, store, audit }) => {
    const attempt = await audit.start(startInput({ before: { revision: 'rev-1' } }))
    const terminal = await audit.finish(attempt, {
      state: 'succeeded',
      exitCode: 0,
      after: { revision: 'rev-2', branch: 'main' },
      outputSummary: 'Everything up-to-date',
      changedPaths: ['src/a.ts', 'src/b.ts'],
      remoteOutcome: 'confirmed-success',
    })

    assert.equal(terminal.id, attempt.id)
    assert.equal(terminal.correlationId, attempt.correlationId)
    assert.equal(terminal.startedAt, attempt.startedAt)
    assert.equal(terminal.state, 'succeeded')
    assert.equal(terminal.exitCode, 0)
    assert.equal(terminal.afterRevision, 'rev-2')
    assert.equal(terminal.beforeRevision, 'rev-1')
    assert.equal(terminal.remoteOutcome, 'confirmed-success')
    assert.deepEqual(terminal.changedPaths, ['src/a.ts', 'src/b.ts'])
    assert.ok(Number.isFinite(Date.parse(terminal.finishedAt ?? '')))

    // Folded readers see exactly one attempt, in its terminal state.
    assert.deepEqual(await store.getOperation(attempt.id), terminal)
    const page = await store.queryOperations({})
    assert.equal(page.operations.length, 1)
    assert.deepEqual(page.operations[0], terminal)

    // Append-only: the started line is untouched on disk.
    const lines = await readOperationLines(dir)
    assert.equal(lines.length, 2)
    assert.equal(lines[0]?.state, 'started')
    assert.equal(lines[1]?.state, 'succeeded')
    assert.equal(lines[0]?.finishedAt, undefined)
  })
})

test('a failed finish leaves the truthful started record in place', async () => {
  const clock = steppingClock()
  await withContext(async ({ dir, store, audit }) => {
    const attempt = await audit.start(startInput())
    const failed = await audit.finish(attempt, {
      state: 'failed',
      exitCode: 128,
      errorCode: 'operation-failed',
      safeErrorMessage: 'push rejected: non-fast-forward',
      remoteOutcome: 'confirmed-failure',
    })
    assert.equal(failed.state, 'failed')
    assert.equal(failed.exitCode, 128)
    assert.equal(failed.errorCode, 'operation-failed')
    assert.equal(failed.safeErrorMessage, 'push rejected: non-fast-forward')
    assert.equal((await store.getOperation(attempt.id))?.state, 'failed')

    // A crash between start and finish (no finish call) keeps 'started' honest.
    const orphan = await audit.start(startInput({ operation: 'pull' }))
    assert.equal((await store.getOperation(orphan.id))?.state, 'started')

    const lines = await readOperationLines(dir)
    assert.deepEqual(lines.map(line => line.state), ['started', 'failed', 'started'])
    const page = await store.queryOperations({})
    assert.deepEqual(page.operations.map(operation => operation.operation), ['pull', 'push'])
    assert.equal(page.operations[0]?.state, 'started')
    assert.equal(page.operations[1]?.state, 'failed')
  }, clock)
})

test('redacts and bounds requestSummary, outputSummary and safeErrorMessage', async () => {
  const secret = 'supersecretvalue'
  await withContext(async ({ dir, store, audit }) => {
    const attempt = await audit.start(startInput({
      requestSummary: `push https://user:pass@example.com/repo token=${secret}`,
    }))
    assert.equal(attempt.requestSummary.includes(secret), false)
    assert.equal(attempt.requestSummary.includes('***'), true)

    const terminal = await audit.finish(attempt, {
      state: 'failed',
      safeErrorMessage: `fatal: password=hunter2 token=${secret}`,
      outputSummary: `remote: counting\ntoken=${secret}\nremote: done`,
    })
    assert.equal(terminal.safeErrorMessage?.includes('hunter2'), false)
    assert.equal(terminal.safeErrorMessage?.includes(secret), false)
    assert.equal(terminal.outputSummary?.includes(secret), false)
    assert.equal(terminal.outputSummary?.includes('***'), true)

    const raw = await readFile(join(dir, 'operations.jsonl'), 'utf8')
    assert.equal(raw.includes(secret), false)
    assert.equal(raw.includes('hunter2'), false)
    assert.equal(raw.includes('user:pass'), false)
  })
})

test('bounds requestSummary, outputSummary line count and changedPaths', async () => {
  await withContext(async ({ store, audit }) => {
    const attempt = await audit.start(startInput({ requestSummary: 'x'.repeat(600) }))
    assert.equal(attempt.requestSummary.length, 500)

    const outputLines = Array.from({ length: 30 }, (_, index) => `output-line-${index}`).join('\n')
    const changedPaths = [
      ...Array.from({ length: 300 }, (_, index) => `src/file-${index}.ts`),
      'src/file-0.ts',
      '   ',
    ]
    const terminal = await audit.finish(attempt, { state: 'succeeded', outputSummary: outputLines, changedPaths })

    const outputSummary = terminal.outputSummary ?? ''
    assert.equal(outputSummary.includes('output-line-19'), true)
    assert.equal(outputSummary.includes('output-line-20'), false)
    assert.ok(outputSummary.length <= 2000)

    assert.ok(Array.isArray(terminal.changedPaths))
    assert.equal(terminal.changedPaths?.length, 200)
    assert.equal(terminal.changedPaths?.[0], 'src/file-0.ts')
    assert.equal(terminal.changedPaths?.[199], 'src/file-199.ts')

    // A single huge line is still capped.
    const wide = await audit.finish(attempt, { state: 'succeeded', outputSummary: 'y'.repeat(5000) })
    assert.ok((wide.outputSummary ?? '').length <= 2000)

    const persisted = await store.getOperation(attempt.id)
    assert.equal(persisted?.state, 'succeeded')
  })
})

test('finish never mutates the started attempt record', async () => {
  await withContext(async ({ audit }) => {
    const attempt = await audit.start(startInput())
    const snapshot = structuredClone(attempt)
    const terminal = await audit.finish(attempt, { state: 'partial', exitCode: 2 })
    assert.deepEqual(attempt, snapshot)
    assert.equal(attempt.state, 'started')
    assert.equal(attempt.finishedAt, undefined)
    assert.notEqual(terminal, attempt)
    assert.equal(terminal.state, 'partial')
  })
})

test('invalid clock injection rejects without persisting anything', async () => {
  await withContext(async ({ store }) => {
    const invalidClock = createAuditService(store, { now: () => new Date('not-a-date') })
    await assert.rejects(
      invalidClock.start(startInput()),
      (error: unknown) => error instanceof StoreError && error.code === 'storage-failure',
    )
    // Nothing was written: no started record, and no operations file at all.
    assert.deepEqual((await store.queryOperations({})).operations, [])

    let calls = 0
    const nonDateClock = createAuditService(store, {
      now: () => {
        calls += 1
        return undefined as unknown as Date
      },
    })
    await assert.rejects(nonDateClock.start(startInput()), (error: unknown) => error instanceof StoreError)
    assert.equal(calls, 1)
  })

  const stub = failingStore('unused')
  assert.throws(
    () => createAuditService(stub, { now: 42 as unknown as () => Date }),
    (error: unknown) => error instanceof StoreError,
  )
  assert.throws(
    () => createAuditService(null as unknown as TimelineStore),
    (error: unknown) => error instanceof StoreError,
  )
})

test('a store write failure makes start reject so the operation can be refused', async () => {
  const audit = createAuditService(failingStore('disk full'))
  await assert.rejects(
    audit.start(startInput()),
    (error: unknown) => error instanceof StoreError && /disk full/.test(error.message),
  )
})

test('validates audit input before writing', async () => {
  await withContext(async ({ store, audit }) => {
    await assert.rejects(
      audit.start(startInput({ repositoryId: '   ' })),
      (error: unknown) => error instanceof StoreError && error.code === 'invalid-request',
    )
    await assert.rejects(
      audit.start(startInput({ vcsType: 'hg' as never })),
      (error: unknown) => error instanceof StoreError && error.code === 'invalid-request',
    )
    await assert.rejects(
      audit.start(startInput({ operation: '' as never })),
      (error: unknown) => error instanceof StoreError && error.code === 'invalid-request',
    )

    const attempt = await audit.start(startInput())
    await assert.rejects(
      audit.finish(attempt, { state: 'started' as never }),
      (error: unknown) => error instanceof StoreError && error.code === 'invalid-request',
    )
    await assert.rejects(
      audit.finish(null as never, { state: 'succeeded' }),
      (error: unknown) => error instanceof StoreError && error.code === 'invalid-request',
    )
    assert.deepEqual((await store.queryOperations({})).operations.map(operation => operation.state), ['started'])
  })
})

test('keeps a supplied correlationId and derives before/after revisions', async () => {
  await withContext(async ({ audit }) => {
    const attempt = await audit.start(startInput({
      correlationId: 'corr-supplied-123',
      before: { head: 'head-from-before' },
    }))
    assert.equal(attempt.correlationId, 'corr-supplied-123')
    assert.equal(attempt.beforeRevision, 'head-from-before')

    const withRevision = await audit.start(startInput({
      operation: 'commit',
      before: { revision: 'rev-preferred', head: 'head-ignored' },
    }))
    assert.equal(withRevision.beforeRevision, 'rev-preferred')

    const terminal = await audit.finish(attempt, {
      state: 'succeeded',
      after: { head: 'head-after' },
    })
    assert.equal(terminal.afterRevision, 'head-after')
    assert.equal(terminal.correlationId, 'corr-supplied-123')
  })
})
