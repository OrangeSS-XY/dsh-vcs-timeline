/**
 * dsh-vcs-timeline — commit graph lanes (pure).
 *
 * A timeline page is newest-first, so the graph can be reconstructed without
 * any extra Host data: each commit knows its parent hashes, and one forward
 * sweep assigns every commit to a lane, carrying the expected parent hashes
 * downward like `git log --graph` does. Multi-parent commits open merge lanes;
 * a commit whose lane carries several parents keeps them side by side until
 * each parent appears in the page.
 *
 * The renderer consumes {@link GraphRow} values; nothing here touches React or
 * the DOM, so the lane rules are unit-testable.
 * @module dsh-vcs-timeline/client/graph
 */

import type { VcsEvent } from '../shared/contracts.ts'

/** Most lanes one page will draw; extra ancestors are folded into the last lane. */
export const MAX_GRAPH_LANES = 8

/** Lane width used by the renderer, in px. */
export const GRAPH_LANE_WIDTH = 12

/** Left padding of the graph gutter, in px. */
export const GRAPH_PAD_LEFT = 6

/** Height of one timeline row, in px (shared with the stylesheet). */
export const GRAPH_ROW_HEIGHT = 52

/** Revision identity of one commit inside the graph. */
function hashOf(event: VcsEvent): string {
  if (typeof event.commitHash === 'string' && event.commitHash !== '') return event.commitHash
  if (typeof event.revision === 'string' && event.revision !== '') return `r${event.revision}`
  return event.id
}

/** One commit placed on the graph. */
export interface GraphRow {
  /** Event id (stable React key). */
  id: string
  /** Commit identity used for lane matching (hash or revision). */
  hash: string
  /** Lane the commit node sits in. */
  lane: number
  /** Lane state above this row (expected hashes per column). */
  before: ReadonlyArray<string | null>
  /** Lane state below this row. */
  after: ReadonlyArray<string | null>
  /** Lanes the extra parents were assigned to (merge edges). */
  mergeLanes: ReadonlyArray<number>
  /** True when the commit has more than one parent. */
  merge: boolean
  /** True when this row opened its lane (nothing pointed at it from above). */
  opened: boolean
}

/** The whole page's graph. */
export interface GraphModel {
  rows: GraphRow[]
  /** Highest lane count any row needs. */
  lanes: number
}

/**
 * Assign lanes to one newest-first history page.
 * @param events - history page, newest first.
 * @returns one row per event plus the lane count the gutter must reserve.
 */
export function computeGraph(events: readonly VcsEvent[]): GraphModel {
  const state: Array<string | null> = []
  const rows: GraphRow[] = []
  let lanes = 1
  for (const event of events) {
    const hash = hashOf(event)
    const parents = (event.parentHashes ?? []).slice(0, MAX_GRAPH_LANES)
    let lane = state.indexOf(hash)
    const opened = lane < 0
    if (lane < 0) {
      // A commit whose record is missing from this page (shallow/filtered page)
      // still needs a lane: reuse a free column before opening a new one.
      lane = state.indexOf(null)
      if (lane < 0) {
        lane = state.length
        state.push(hash)
      } else {
        state[lane] = hash
      }
    }
    const before = state.slice()
    state[lane] = null
    const mergeLanes: number[] = []
    const firstParent = parents.length > 0 ? parents[0] ?? null : null
    if (firstParent !== null) {
      // A parent that already continues in another lane is a lane merge: let
      // the line collapse into that lane instead of duplicating the hash on
      // two lanes (duplicates leave stale lines running forever).
      const existing = state.indexOf(firstParent)
      if (existing >= 0) mergeLanes.push(existing)
      else state[lane] = firstParent
    }
    for (const parent of parents.slice(1)) {
      let parentLane = state.indexOf(parent)
      if (parentLane < 0) {
        parentLane = Math.min(lane + 1, MAX_GRAPH_LANES - 1)
        if (state[parentLane] === null || state[parentLane] === undefined) {
          state[parentLane] = parent
        } else {
          const free = state.indexOf(null)
          if (free < 0) {
            if (state.length >= MAX_GRAPH_LANES) continue
            state.push(parent)
            parentLane = state.length - 1
          } else {
            state[free] = parent
            parentLane = free
          }
        }
      }
      mergeLanes.push(parentLane)
    }
    while (state.length > 0 && state[state.length - 1] === null) state.pop()
    const after = state.slice()
    lanes = Math.max(lanes, before.length, after.length, lane + 1, ...mergeLanes.map((value) => value + 1))
    rows.push({ id: event.id, hash, lane, before, after, mergeLanes, merge: parents.length > 1, opened })
  }
  return { rows, lanes: Math.min(MAX_GRAPH_LANES, Math.max(1, lanes)) }
}

/** The row matching one event id, or null. */
export function graphRowFor(model: GraphModel, id: string): GraphRow | null {
  return model.rows.find((row) => row.id === id) ?? null
}

/** X coordinate (px) of one lane inside the gutter. */
export function laneX(lane: number): number {
  return GRAPH_PAD_LEFT + lane * GRAPH_LANE_WIDTH
}

/** Total gutter width (px) the renderer needs for a given lane count. */
export function graphWidth(lanes: number): number {
  return GRAPH_PAD_LEFT * 2 + Math.max(1, lanes - 1) * GRAPH_LANE_WIDTH + 8
}

/**
 * Stable color hue for one lane.
 *
 * A single hue per column keeps a branch recognisable across rows without
 * inventing branch names; the renderer turns it into a theme-safe HSL string.
 * @param lane - lane index.
 * @returns hue in degrees.
 */
export function laneHue(lane: number): number {
  const palette = [212, 275, 338, 22, 152, 186, 48, 300]
  return palette[Math.abs(lane) % palette.length] ?? 212
}
