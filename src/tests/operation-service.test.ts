/**
 * Operation service tests: preview/execute token binding, argv re-planning,
 * audit ordering, unknown remote outcomes, and one-write-per-repository.
 * @module dsh-vcs-timeline/tests/operation-service.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { OperationBeforeState, OperationPlan } from '../host/adapters/types.ts'
import type { Repository } from '../shared/contracts.ts'
import { ServiceError, type RepositoryResolver } from '../host/services/timeline-service.ts'
import { createOperationService } from '../host/services/operation-service.ts'
import { createFakeAdapter, createFakeAudit, createFakeRunner, createMemoryStore } from './helpers.ts'

const repository: Repository = {
  schemaVersion: 1,
  id: 'git:c:/fake/repo',
  vcsType: 'git',
  rootPath: 'C:/fake/repo',
  displayName: 'repo',
  currentBranch: 'main',
  currentRevision: 'abc123',
  detectedAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
}

const before: OperationBeforeState = {
  branch: 'main',
  head: 'abc123',
  clean: true,
  stagedFiles: ['src/a.ts'],
}

function planOf(overrides: Partial<OperationPlan> = {}): OperationPlan {
  return {
    allowed: true,
    argv: ['git', 'commit', '-m', 'msg'],
    cwd: 'C:/fake/repo',
    summary: 'commit staged changes',
    warnings: [],
    network: false,
    ...overrides,
  }
}

function serviceWith(options: {
  plan?: (operation: string, params: Record<string, string | number | boolean>) => OperationPlan
  run?: Parameters<typeof createFakeRunner>[0]
  failAuditStart?: boolean
} = {}) {
  const store = createMemoryStore()
  const adapter = createFakeAdapter({
    before,
    info: () => repository,
    plan: options.plan as never,
  })
  const resolver: RepositoryResolver = {
    adapters: { git: adapter, svn: adapter },
    async resolve() {
      return { ok: true, value: { repository, root: repository.rootPath, adapter } }
    },
  }
  const runner = createFakeRunner(options.run ?? (() => ({ exitCode: 0, stdout: 'ok', stderr: '' })))
  const audit = createFakeAudit(store, { failStart: options.failAuditStart === true })
  const service = createOperationService({ resolver, runner, store, audit })
  return { service, store, runner }
}

async function expectServiceError(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ServiceError, `expected ServiceError, got ${String(error)}`)
    assert.equal(error.code, code)
    return true
  })
}

test('preview then execute commits with an audit trail and a plugin-audit event', async () => {
  const { service, store, runner } = serviceWith({
    plan: () => planOf(),
  })
  const preview = await service.preview({ repositoryId: repository.id, operation: 'commit', params: { message: 'msg' } })
  assert.equal(preview.allowed, true)
  assert.ok(preview.confirmationToken.length > 10)
  assert.deepEqual(preview.argv, ['git', 'commit', '-m', 'msg'])
  assert.equal(preview.before.branch, 'main')

  const attempt = await service.execute({
    repositoryId: repository.id,
    operation: 'commit',
    params: { message: 'msg' },
    confirmationToken: preview.confirmationToken,
  })
  assert.equal(attempt.state, 'succeeded')
  assert.equal(attempt.exitCode, 0)
  assert.equal(attempt.requestSummary, 'commit staged changes')
  assert.equal(runner.calls.length, 1)
  assert.deepEqual(runner.calls[0]!.argv, ['git', 'commit', '-m', 'msg'])

  // Audit: started persisted before running, then the terminal record.
  assert.equal(store.operations.length, 2)
  assert.equal(store.operations[0]!.state, 'started')
  assert.equal(store.operations[1]!.state, 'succeeded')
  const folded = await store.getOperation(attempt.id)
  assert.equal(folded?.state, 'succeeded')
  // The plugin-audit event is durable too.
  assert.equal(store.events.length, 1)
  assert.equal(store.events[0]!.source, 'plugin-audit')
  assert.equal(store.events[0]!.eventType, 'commit')
  assert.equal(store.events[0]!.outcome, 'success')
})

test('execute without a token is refused', async () => {
  const { service, runner } = serviceWith()
  await expectServiceError(service.execute({ repositoryId: repository.id, operation: 'commit', params: {} }), 'confirmation-required')
  assert.equal(runner.calls.length, 0)
})

test('a token cannot be reused', async () => {
  const { service } = serviceWith()
  const preview = await service.preview({ repositoryId: repository.id, operation: 'commit', params: {} })
  await service.execute({ repositoryId: repository.id, operation: 'commit', params: {}, confirmationToken: preview.confirmationToken })
  await expectServiceError(
    service.execute({ repositoryId: repository.id, operation: 'commit', params: {}, confirmationToken: preview.confirmationToken }),
    'confirmation-invalid',
  )
})

test('changed parameters invalidate the confirmation', async () => {
  const { service, runner } = serviceWith()
  const preview = await service.preview({ repositoryId: repository.id, operation: 'commit', params: { message: 'one' } })
  await expectServiceError(
    service.execute({ repositoryId: repository.id, operation: 'commit', params: { message: 'two' }, confirmationToken: preview.confirmationToken }),
    'confirmation-invalid',
  )
  assert.equal(runner.calls.length, 0)
})

test('a re-planned argv that differs from the previewed one aborts', async () => {
  let counter = 0
  const { service, runner } = serviceWith({
    plan: () => {
      counter += 1
      return planOf({ argv: ['git', 'commit', '-m', `msg-${counter}`] })
    },
  })
  const preview = await service.preview({ repositoryId: repository.id, operation: 'commit', params: { message: 'm' } })
  await expectServiceError(
    service.execute({ repositoryId: repository.id, operation: 'commit', params: { message: 'm' }, confirmationToken: preview.confirmationToken }),
    'confirmation-invalid',
  )
  assert.equal(runner.calls.length, 0)
})

test('a blocked plan yields allowed=false and no token', async () => {
  const { service, runner } = serviceWith({
    plan: () => planOf({ allowed: false, blockedReason: 'nothing staged' }),
  })
  const preview = await service.preview({ repositoryId: repository.id, operation: 'commit', params: {} })
  assert.equal(preview.allowed, false)
  assert.equal(preview.blockedReason, 'nothing staged')
  assert.equal(preview.confirmationToken, '')
  await expectServiceError(
    service.execute({ repositoryId: repository.id, operation: 'commit', params: {}, confirmationToken: '' }),
    'confirmation-required',
  )
  assert.equal(runner.calls.length, 0)
})

test('a timed-out network operation is recorded as unknown, never as success', async () => {
  const { service, store } = serviceWith({
    plan: () => planOf({ argv: ['git', 'fetch'], summary: 'fetch origin', network: true }),
    run: () => ({ exitCode: null, stdout: '', stderr: '', timedOut: true }),
  })
  const preview = await service.preview({ repositoryId: repository.id, operation: 'fetch', params: {} })
  const attempt = await service.execute({
    repositoryId: repository.id,
    operation: 'fetch',
    params: {},
    confirmationToken: preview.confirmationToken,
  })
  assert.equal(attempt.state, 'unknown')
  assert.equal(attempt.remoteOutcome, 'unknown')
  const folded = await store.getOperation(attempt.id)
  assert.equal(folded?.state, 'unknown')
  assert.equal(store.events[0]!.outcome, 'unknown')
})

test('a spawn failure is a definite failure, not an unknown remote result', async () => {
  const { service } = serviceWith({
    plan: () => planOf({ argv: ['git', 'fetch'], network: true }),
    run: () => ({ exitCode: null, stdout: '', stderr: '', spawnFailed: true, failureMessage: 'spawn git ENOENT' }),
  })
  const preview = await service.preview({ repositoryId: repository.id, operation: 'fetch', params: {} })
  const attempt = await service.execute({
    repositoryId: repository.id,
    operation: 'fetch',
    params: {},
    confirmationToken: preview.confirmationToken,
  })
  assert.equal(attempt.state, 'failed')
  assert.equal(attempt.remoteOutcome, undefined)
  assert.equal(attempt.errorCode, 'vcs-not-installed')
})

test('a non-zero push becomes a confirmed remote failure', async () => {
  const { service } = serviceWith({
    plan: () => planOf({ argv: ['git', 'push', 'origin', 'main'], network: true }),
    run: () => ({ exitCode: 1, stdout: '', stderr: 'remote: rejected' }),
  })
  const preview = await service.preview({ repositoryId: repository.id, operation: 'push', params: {} })
  const attempt = await service.execute({
    repositoryId: repository.id,
    operation: 'push',
    params: {},
    confirmationToken: preview.confirmationToken,
  })
  assert.equal(attempt.state, 'failed')
  assert.equal(attempt.remoteOutcome, 'confirmed-failure')
  assert.ok((attempt.safeErrorMessage ?? '').includes('rejected'))
})

test('when the audit record cannot be written, no command runs', async () => {
  const { service, runner } = serviceWith({ failAuditStart: true })
  const preview = await service.preview({ repositoryId: repository.id, operation: 'commit', params: {} })
  await expectServiceError(
    service.execute({ repositoryId: repository.id, operation: 'commit', params: {}, confirmationToken: preview.confirmationToken }),
    'storage-failure',
  )
  assert.equal(runner.calls.length, 0)
})

test('a second concurrent write on one repository is refused', async () => {
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const { service } = serviceWith({
    run: async () => {
      await gate
      return { exitCode: 0, stdout: '', stderr: '' }
    },
  })
  const first = await service.preview({ repositoryId: repository.id, operation: 'commit', params: {} })
  const second = await service.preview({ repositoryId: repository.id, operation: 'commit', params: {} })
  const running = service.execute({ repositoryId: repository.id, operation: 'commit', params: {}, confirmationToken: first.confirmationToken })
  // Let the first execute reach its runner call.
  await new Promise(resolve => setTimeout(resolve, 20))
  await expectServiceError(
    service.execute({ repositoryId: repository.id, operation: 'commit', params: {}, confirmationToken: second.confirmationToken }),
    'operation-blocked',
  )
  release?.()
  const finished = await running
  assert.equal(finished.state, 'succeeded')
})

test('preview refuses read-only operations', async () => {
  const { service } = serviceWith()
  await expectServiceError(service.preview({ repositoryId: repository.id, operation: 'status', params: {} }), 'invalid-request')
})

test('operation audit listing folds terminal state', async () => {
  const { service } = serviceWith()
  const preview = await service.preview({ repositoryId: repository.id, operation: 'commit', params: {} })
  await service.execute({ repositoryId: repository.id, operation: 'commit', params: {}, confirmationToken: preview.confirmationToken })
  const page = await service.listOperations({ repositoryId: repository.id })
  assert.equal(page.operations.length, 1)
  assert.equal(page.operations[0]!.state, 'succeeded')
})
