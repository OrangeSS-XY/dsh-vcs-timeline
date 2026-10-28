/**
 * dsh-vcs-timeline — commit graph gutter renderer.
 *
 * One small SVG per row: pass-through lane segments, the commit node, and a
 * curve for every merge parent. Colors come from lane hues (HSL), so branches
 * are distinguishable in both themes while node fills use the theme base so the
 * graph never paints a white halo in dark mode.
 * @module dsh-vcs-timeline/client/ui/graph
 */

import * as React from 'react'
import {
  GRAPH_ROW_HEIGHT,
  graphWidth,
  laneHue,
  laneX,
  type GraphRow,
} from '../graph.ts'

const h = React.createElement

/** Theme-safe lane stroke. */
function laneColor(lane: number): string {
  return `hsl(${laneHue(lane)} 55% 52%)`
}

/** Props of one graph gutter. */
export interface GraphGutterProps {
  row: GraphRow
  /** Total lanes on the page, so every row keeps the same gutter width. */
  lanes: number
}

/** Render the graph gutter for one commit row. */
export function renderGraphGutter(props: GraphGutterProps): React.ReactElement {
  const { row, lanes } = props
  const width = graphWidth(lanes)
  const center = GRAPH_ROW_HEIGHT / 2
  const bottom = GRAPH_ROW_HEIGHT
  const nodeX = laneX(row.lane)
  const columns = Math.max(row.before.length, row.after.length, row.lane + 1, lanes)
  const segments: React.ReactElement[] = []
  for (let column = 0; column < columns; column += 1) {
    const x = laneX(column)
    const color = laneColor(column)
    // Only a lane opened at the page boundary lacks a line from above; every
    // other row was pointed at by its parent's edge and must connect upward.
    const hasTop = row.before[column] !== undefined
      && row.before[column] !== null
      && !(row.opened && column === row.lane)
    const hasBottom = row.after[column] !== undefined && row.after[column] !== null
    if (hasTop) {
      segments.push(h('line', {
        key: `t${column}`,
        x1: x,
        y1: 0,
        x2: x,
        y2: center,
        stroke: color,
        strokeWidth: 2,
        strokeLinecap: 'round',
      }))
    }
    if (hasBottom) {
      segments.push(h('line', {
        key: `b${column}`,
        x1: x,
        y1: center,
        x2: x,
        y2: bottom,
        stroke: color,
        strokeWidth: 2,
        strokeLinecap: 'round',
      }))
    }
  }
  for (const [index, target] of row.mergeLanes.entries()) {
    segments.push(h('path', {
      key: `m${index}`,
      d: `M ${nodeX} ${center} C ${nodeX} ${center + 10}, ${laneX(target)} ${bottom - 10}, ${laneX(target)} ${bottom}`,
      fill: 'none',
      stroke: laneColor(target),
      strokeWidth: 2,
      strokeLinecap: 'round',
    }))
  }
  return h('span', {
    className: 'dvt-tl-graph',
    'aria-hidden': 'true',
    style: { width: `${width}px` },
  },
  h('svg', {
    className: 'dvt-tl-graph-svg',
    width,
    height: GRAPH_ROW_HEIGHT,
    viewBox: `0 0 ${width} ${GRAPH_ROW_HEIGHT}`,
    'data-dvt-lane': row.lane,
  },
  segments,
  h('circle', {
    className: 'dvt-tl-graph-node',
    cx: nodeX,
    cy: center,
    r: 4.2,
    fill: row.merge ? 'var(--dsw-alias-bg-base)' : laneColor(row.lane),
    stroke: laneColor(row.lane),
    strokeWidth: row.merge ? 2 : 0,
  }),
  ),
  )
}
