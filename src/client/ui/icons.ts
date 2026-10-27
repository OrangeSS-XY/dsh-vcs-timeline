/**
 * Inline SVG icons for the timeline panel.
 *
 * Every icon is a 16px stroke glyph drawn with `currentColor`, so it inherits
 * the surrounding label color and both themes without any literal color. No
 * icon library is added: these are the few shapes this panel needs.
 * @module dsh-vcs-timeline/client/ui/icons
 */

import * as React from 'react'

const h = React.createElement

/** Props every icon accepts. */
export interface IconProps {
  size?: number
  className?: string
}

/** Build one icon component from SVG child elements. */
function icon(name: string, children: React.ReactNode): React.ComponentType<IconProps> {
  function Icon(props: IconProps): React.ReactElement {
    const size = props.size ?? 14
    return h('svg', {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
      ...(props.className === undefined ? {} : { className: props.className }),
      'data-dvt-icon': name,
    }, children)
  }
  Icon.displayName = `DvtIcon${name}`
  return Icon
}

/** Refresh: circular arrow. */
export const IconRefresh = icon('refresh', [
  h('path', { key: 'a', d: 'M13.2 7.2A5.4 5.4 0 1 0 13 10' }),
  h('path', { key: 'b', d: 'M13.4 3.6v3.8H9.6' }),
])

/** Chevron pointing down. */
export const IconChevronDown = icon('chevron-down', [
  h('path', { key: 'a', d: 'M4.2 6.2 8 10l3.8-3.8' }),
])

/** Chevron pointing right. */
export const IconChevronRight = icon('chevron-right', [
  h('path', { key: 'a', d: 'M6.2 4.2 10 8l-3.8 3.8' }),
])

/** Back arrow. */
export const IconBack = icon('back', [
  h('path', { key: 'a', d: 'M9.6 3.6 5.2 8l4.4 4.4' }),
])

/** Close cross. */
export const IconClose = icon('close', [
  h('path', { key: 'a', d: 'M4 4l8 8' }),
  h('path', { key: 'b', d: 'M12 4l-8 8' }),
])

/** Overflow menu: three dots. */
export const IconMore = icon('more', [
  h('circle', { key: 'a', cx: 3.4, cy: 8, r: 0.9, fill: 'currentColor', stroke: 'none' }),
  h('circle', { key: 'b', cx: 8, cy: 8, r: 0.9, fill: 'currentColor', stroke: 'none' }),
  h('circle', { key: 'c', cx: 12.6, cy: 8, r: 0.9, fill: 'currentColor', stroke: 'none' }),
])

/** Search magnifier. */
export const IconSearch = icon('search', [
  h('circle', { key: 'a', cx: 7, cy: 7, r: 3.9 }),
  h('path', { key: 'b', d: 'M10.1 10.1 13.6 13.6' }),
])

/** Filter funnel. */
export const IconFilter = icon('filter', [
  h('path', { key: 'a', d: 'M2.6 3.6h10.8L9.2 8.3v4.1l-2.4-1.3V8.3z' }),
])

/** Check mark. */
export const IconCheck = icon('check', [
  h('path', { key: 'a', d: 'M3.4 8.4 6.4 11.4 12.6 4.6' }),
])

/** Warning triangle. */
export const IconWarning = icon('warning', [
  h('path', { key: 'a', d: 'M8 2.6 14 12.8H2z' }),
  h('path', { key: 'b', d: 'M8 6.4v3.2' }),
  h('path', { key: 'c', d: 'M8 11.4h.01' }),
])

/** Error circle. */
export const IconError = icon('error', [
  h('circle', { key: 'a', cx: 8, cy: 8, r: 5.6 }),
  h('path', { key: 'b', d: 'M8 5v3.6' }),
  h('path', { key: 'c', d: 'M8 11h.01' }),
])

/** Commit node: a circle on the history line. */
export const IconCommit = icon('commit', [
  h('circle', { key: 'a', cx: 8, cy: 8, r: 2.8 }),
  h('path', { key: 'b', d: 'M8 1.6v3.6' }),
  h('path', { key: 'c', d: 'M8 10.8v3.6' }),
])

/** Merge commit node. */
export const IconMerge = icon('merge', [
  h('circle', { key: 'a', cx: 8, cy: 11.4, r: 2.2 }),
  h('circle', { key: 'b', cx: 8, cy: 4.4, r: 1.8 }),
  h('path', { key: 'c', d: 'M3.2 3.4c0 3.4 3.4 3 4.8 4.4' }),
  h('path', { key: 'd', d: 'M8 6.2v3' }),
])

/** Branch name chip glyph. */
export const IconBranch = icon('branch', [
  h('circle', { key: 'a', cx: 5, cy: 3.4, r: 1.7 }),
  h('circle', { key: 'b', cx: 5, cy: 12.6, r: 1.7 }),
  h('circle', { key: 'c', cx: 11.4, cy: 5.4, r: 1.7 }),
  h('path', { key: 'd', d: 'M5 5.1v5.8' }),
  h('path', { key: 'e', d: 'M11.4 7.1c0 2.6-2.6 2.4-6.4 3.6' }),
])

/** Changed file. */
export const IconFile = icon('file', [
  h('path', { key: 'a', d: 'M4 2.2h5l3 3v8.6H4z' }),
  h('path', { key: 'b', d: 'M9 2.2v3.2h3' }),
])

/** Diff / side-by-side change glyph. */
export const IconDiff = icon('diff', [
  h('path', { key: 'a', d: 'M4.4 2.4v11.2' }),
  h('path', { key: 'b', d: 'M9.4 5.4h3.2' }),
  h('path', { key: 'c', d: 'M9.4 8h3.2' }),
  h('path', { key: 'd', d: 'M9.4 10.6h3.2' }),
])

/** Copy to clipboard. */
export const IconCopy = icon('copy', [
  h('rect', { key: 'a', x: 5.4, y: 5.4, width: 7.4, height: 8, rx: 1.4 }),
  h('path', { key: 'b', d: 'M10.6 5.4V4A1.4 1.4 0 0 0 9.2 2.6H4.4A1.4 1.4 0 0 0 3 4v6a1.4 1.4 0 0 0 1.4 1.4h1' }),
])

/** Clock (time metadata). */
export const IconClock = icon('clock', [
  h('circle', { key: 'a', cx: 8, cy: 8, r: 5.6 }),
  h('path', { key: 'b', d: 'M8 4.8V8l2.4 1.6' }),
])

/** Author / person. */
export const IconUser = icon('user', [
  h('circle', { key: 'a', cx: 8, cy: 5.6, r: 2.4 }),
  h('path', { key: 'b', d: 'M3.6 13.2c.6-2.4 2.3-3.6 4.4-3.6s3.8 1.2 4.4 3.6' }),
])

/** Repository / folder. */
export const IconRepo = icon('repo', [
  h('path', { key: 'a', d: 'M2.4 4.2A1.2 1.2 0 0 1 3.6 3h3l1.4 1.6h4.4a1.2 1.2 0 0 1 1.2 1.2v6A1.2 1.2 0 0 1 12.4 13H3.6a1.2 1.2 0 0 1-1.2-1.2z' }),
])

/** Diagnostics / sliders. */
export const IconSliders = icon('sliders', [
  h('path', { key: 'a', d: 'M3 4.4h10' }),
  h('path', { key: 'b', d: 'M3 8h10' }),
  h('path', { key: 'c', d: 'M3 11.6h10' }),
  h('circle', { key: 'd', cx: 5.6, cy: 4.4, r: 1.3, fill: 'currentColor', stroke: 'none' }),
  h('circle', { key: 'e', cx: 10.4, cy: 8, r: 1.3, fill: 'currentColor', stroke: 'none' }),
  h('circle', { key: 'f', cx: 7, cy: 11.6, r: 1.3, fill: 'currentColor', stroke: 'none' }),
])

/** Timeline / list. */
export const IconTimeline = icon('timeline', [
  h('path', { key: 'a', d: 'M3.2 3.6v8.8' }),
  h('circle', { key: 'b', cx: 3.2, cy: 4.4, r: 1.2, fill: 'currentColor', stroke: 'none' }),
  h('circle', { key: 'c', cx: 3.2, cy: 8, r: 1.2, fill: 'currentColor', stroke: 'none' }),
  h('circle', { key: 'd', cx: 3.2, cy: 11.6, r: 1.2, fill: 'currentColor', stroke: 'none' }),
  h('path', { key: 'e', d: 'M6.4 4.4h6.4' }),
  h('path', { key: 'f', d: 'M6.4 8h6.4' }),
  h('path', { key: 'g', d: 'M6.4 11.6h6.4' }),
])

/** Audit / shield-check. */
export const IconAudit = icon('audit', [
  h('path', { key: 'a', d: 'M8 2.2 13 4v4.2c0 2.8-2.1 4.7-5 5.6-2.9-.9-5-2.8-5-5.6V4z' }),
  h('path', { key: 'b', d: 'M5.8 7.8 7.4 9.4l3-3.2' }),
])

/** Download (fetch/pull/update). */
export const IconDownload = icon('download', [
  h('path', { key: 'a', d: 'M8 2.6v7.2' }),
  h('path', { key: 'b', d: 'M5 7.4 8 10.4 11 7.4' }),
  h('path', { key: 'c', d: 'M3.4 13.2h9.2' }),
])

/** Upload (push). */
export const IconUpload = icon('upload', [
  h('path', { key: 'a', d: 'M8 10.4V3.2' }),
  h('path', { key: 'b', d: 'M5 6.2 8 3.2 11 6.2' }),
  h('path', { key: 'c', d: 'M3.4 13.2h9.2' }),
])

/** Small filled status dot (decorative; label always accompanies it). */
export function IconDot(props: IconProps): React.ReactElement {
  const size = props.size ?? 8
  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 8 8',
    'aria-hidden': 'true',
    focusable: 'false',
    ...(props.className === undefined ? {} : { className: props.className }),
    'data-dvt-icon': 'dot',
  }, h('circle', { cx: 4, cy: 4, r: 3.2, fill: 'currentColor' }))
}

/** Collapsed directory. */
export const IconFolder = icon('folder', [
  h('path', { key: 'a', d: 'M2.2 4A1.2 1.2 0 0 1 3.4 2.8h2.7l1.3 1.5h5.2A1.2 1.2 0 0 1 13.8 5.5v6A1.2 1.2 0 0 1 12.6 12.7H3.4A1.2 1.2 0 0 1 2.2 11.5z' }),
])

/** Expanded directory. */
export const IconFolderOpen = icon('folder-open', [
  h('path', { key: 'a', d: 'M2.2 4A1.2 1.2 0 0 1 3.4 2.8h2.7l1.3 1.5h4.2A1.2 1.2 0 0 1 12.8 5.5v.7' }),
  h('path', { key: 'b', d: 'M2.2 6.4h11.4l-1.3 5.1a1.2 1.2 0 0 1-1.2 1.2H3.4A1.2 1.2 0 0 1 2.2 11.5z' }),
])

/** Expand every directory. */
export const IconExpandAll = icon('expand-all', [
  h('path', { key: 'a', d: 'M4.6 3.4 8 6.6l3.4-3.2' }),
  h('path', { key: 'b', d: 'M4.6 9 8 12.2 11.4 9' }),
])

/** Collapse every directory. */
export const IconCollapseAll = icon('collapse-all', [
  h('path', { key: 'a', d: 'M4.6 6.6 8 3.4l3.4 3.2' }),
  h('path', { key: 'b', d: 'M4.6 12.2 8 9l3.4 3.2' }),
])
