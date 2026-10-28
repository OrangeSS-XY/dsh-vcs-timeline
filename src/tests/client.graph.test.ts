/**
 * Commit graph lanes: linear pages, merge branches, missing parents and the
 * geometry helpers the SVG gutter uses.
 * @module dsh-vcs-timeline/tests/client.graph.test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { VcsEvent } from '../shared/contracts.ts'
import {
  GRAPH_LANE_WIDTH,
  GRAPH_PAD_LEFT,
  computeGraph,
  graphWidth,
  laneHue,
  laneX,
} from '../client/graph.ts'

function event(id: string, parents: string[], timestamp = '2026-01-02T03:04:05.000Z'): VcsEvent {
  return {
    schemaVersion: 1,
    repositoryId: 'git:c:/repo',
    vcsType: 'git',
    eventType: 'commit',
    source: 'repository',
    timestamp,
    id: `commit:${id}`,
    summary: id,
    commitHash: id,
    parentHashes: parents,
  }
}

test('a linear page stays on one lane and carries the first parent down', () => {
  const model = computeGraph([
    event('c3', ['c2']),
    event('c2', ['c1']),
    event('c1', []),
  ])
  assert.equal(model.lanes, 1)
  assert.deepEqual(model.rows.map((row) => row.lane), [0, 0, 0])
  assert.deepEqual(model.rows[0]?.before, ['c3'], 'the boundary commit opens its own lane')
  assert.equal(model.rows[0]?.opened, true)
  assert.deepEqual(model.rows[0]?.after, ['c2'])
  assert.deepEqual(model.rows[2]?.after, [])
  for (const row of model.rows) assert.equal(row.merge, false)
})

test('a merge commit opens a second lane for its extra parent', () => {
  const model = computeGraph([
    event('m', ['a', 'b']),
    event('a', []),
    event('b', []),
  ])
  assert.equal(model.lanes, 2)
  assert.equal(model.rows[0]?.lane, 0)
  assert.equal(model.rows[0]?.merge, true)
  assert.deepEqual(model.rows[0]?.mergeLanes, [1])
  assert.deepEqual(model.rows[0]?.after, ['a', 'b'])
  assert.equal(model.rows[1]?.lane, 0)
  assert.equal(model.rows[2]?.lane, 1)
  assert.deepEqual(model.rows[2]?.before, [null, 'b'])
})

test('a page that starts mid-history assigns an unclaimed commit to a lane', () => {
  const model = computeGraph([event('x', ['y']), event('y', [])])
  assert.equal(model.rows[0]?.lane, 0)
  assert.deepEqual(model.rows[0]?.after, ['y'])
  assert.equal(model.rows[1]?.lane, 0)
})

test('a commit whose parent already continues elsewhere collapses into that lane', () => {
  const model = computeGraph([
    event('m', ['a', 'b']),
    event('a', ['b']),
    event('b', []),
  ])
  assert.equal(model.lanes, 2)
  assert.equal(model.rows[0]?.mergeLanes[0], 1)
  assert.deepEqual(model.rows[1]?.mergeLanes, [1], 'a merges back into the b lane')
  assert.deepEqual(model.rows[1]?.after, [null, 'b'])
  assert.equal(model.rows[2]?.lane, 1)
})

test('a commit already expected by a parent keeps its reserved lane', () => {
  const model = computeGraph([
    event('m', ['a', 'b']),
    event('b', []),
    event('a', []),
  ])
  assert.equal(model.rows[1]?.lane, 1, 'b keeps the lane its merge created')
  assert.equal(model.rows[2]?.lane, 0, 'a stays on the main lane')
})

test('extra parents beyond the page never create unbounded lanes', () => {
  const many = Array.from({ length: 12 }, (_, index) => `p${index}`)
  const model = computeGraph([event('wide', many)])
  assert.ok(model.lanes <= 8, 'lane count is capped')
  assert.ok(model.rows[0] !== undefined)
})

test('geometry helpers are pure arithmetic over the lane index', () => {
  assert.equal(laneX(0), GRAPH_PAD_LEFT)
  assert.equal(laneX(2), GRAPH_PAD_LEFT + 2 * GRAPH_LANE_WIDTH)
  assert.ok(graphWidth(1) > 0)
  assert.ok(graphWidth(3) > graphWidth(1))
  assert.equal(laneHue(0), laneHue(8), 'hue palette cycles')
  assert.ok(laneHue(1) >= 0 && laneHue(1) < 360)
})
