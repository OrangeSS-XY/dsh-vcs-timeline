/**
 * Write-operation request builders.
 *
 * The Host binds its single-use confirmation token to a hash of the request
 * params, so preview and execute must build those params through the same code
 * path. These tests pin that contract without a DOM.
 * @module dsh-vcs-timeline/tests/client.panel.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Repository } from '../shared/contracts.ts'
import {
  buildExecuteRequest,
  buildPreviewRequest,
  createOperationDraft,
  operationParams,
} from '../client/panel.ts'

const repository: Repository = {
  schemaVersion: 1,
  id: 'git:c:/fake/repo',
  vcsType: 'git',
  rootPath: 'C:/fake/repo',
  displayName: 'repo',
  currentBranch: 'main',
  defaultBranch: 'main',
  detectedAt: '2026-01-01T00:00:00.000Z',
  lastSeenAt: '2026-01-01T00:00:00.000Z',
}

test('a new commit dialog starts with an empty message and no prefilled secret', () => {
  const draft = createOperationDraft('commit', repository, null)
  assert.equal(draft.operation, 'commit')
  assert.equal(draft.message, '')
})

test('a new push dialog defaults to origin and the current branch', () => {
  const draft = createOperationDraft('push', repository, null)
  assert.equal(draft.remote, 'origin')
  assert.equal(draft.branch, 'main')
})

test('re-previewing the same operation preserves typed inputs', () => {
  const draft = createOperationDraft('commit', repository, {
    operation: 'commit',
    message: 'fix: keep me',
    remote: 'origin',
    branch: 'main',
  })
  assert.equal(draft.message, 'fix: keep me')
})

test('switching to a different operation resets the inputs', () => {
  const draft = createOperationDraft('push', repository, {
    operation: 'commit',
    message: 'fix: keep me',
    remote: 'upstream',
    branch: 'release',
  })
  assert.equal(draft.message, '')
  assert.equal(draft.remote, 'origin')
  assert.equal(draft.branch, 'main')
})

test('operationParams carries only the parameters the operation needs', () => {
  assert.deepEqual(operationParams({ operation: 'commit', message: 'msg', remote: '', branch: '' }), { message: 'msg' })
  assert.deepEqual(operationParams({ operation: 'push', message: '', remote: ' origin ', branch: ' main ' }), {
    remote: 'origin',
    branch: 'main',
  })
  assert.equal(operationParams({ operation: 'fetch', message: '', remote: 'origin', branch: 'main' }), undefined)
  assert.equal(operationParams({ operation: 'pull', message: '', remote: 'origin', branch: 'main' }), undefined)
})

test('preview and execute send identical params, with the token only on execute', () => {
  const draft = createOperationDraft('commit', repository, null)
  draft.message = 'feat: staged'
  const preview = buildPreviewRequest(repository.id, draft)
  const execute = buildExecuteRequest(repository.id, draft, 'token-1')
  assert.deepEqual(preview.params, execute.params)
  assert.deepEqual(preview.params, { message: 'feat: staged' })
  assert.equal(preview.confirmationToken, undefined)
  assert.equal(execute.confirmationToken, 'token-1')
  assert.equal(preview.repositoryId, repository.id)
  assert.equal(preview.operation, 'commit')
})

test('parameterless operations still bind repository and token', () => {
  const draft = createOperationDraft('fetch', repository, null)
  const preview = buildPreviewRequest(repository.id, draft)
  const execute = buildExecuteRequest(repository.id, draft, 'token-2')
  assert.equal(preview.params, undefined)
  assert.equal(execute.params, undefined)
  assert.equal(execute.confirmationToken, 'token-2')
})
