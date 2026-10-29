/**
 * Small presentational primitives shared by every panel view.
 *
 * Pure functions of props: no state, no effects. They encode the visual rules
 * of the redesign (hairline sections, 24px controls, one dominant action) so
 * individual views only describe content.
 * @module dsh-vcs-timeline/client/ui/primitives
 */

import * as React from 'react'
import type { ApiError, EventSource, OperationState } from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type { TranslateFn } from '../i18n.ts'
import {
  IconClose,
  IconError,
  IconWarning,
  type IconProps,
} from './icons.ts'
import { SkeletonBlock, SkeletonLine } from './skeleton.ts'

const h = React.createElement

/** Props of an icon-only button. */
export interface IconButtonProps {
  label: string
  onClick?: () => void
  icon: React.ComponentType<IconProps>
  expanded?: boolean
  pressed?: boolean
  disabled?: boolean
  extraClass?: string
}

/** 24px icon-only button with an accessible label. */
export function IconButton(props: IconButtonProps): React.ReactElement {
  const Icon = props.icon
  return h('button', {
    type: 'button',
    className: `dvt-iconbtn${props.extraClass === undefined ? '' : ` ${props.extraClass}`}`,
    'aria-label': props.label,
    title: props.label,
    ...(props.expanded === undefined ? {} : { 'aria-expanded': props.expanded }),
    ...(props.pressed === undefined ? {} : { 'aria-pressed': props.pressed }),
    ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
    ...(props.onClick === undefined ? {} : { onClick: props.onClick }),
  }, h(Icon, { size: 14 }))
}

/** Props of the inline banner. */
export interface BannerProps {
  kind: 'info' | 'warn' | 'error'
  title?: string
  text: string
  action?: React.ReactElement | null
  onDismiss?: () => void
  dismissLabel?: string
  key?: string
}

/** One-line banner with a leading icon and an optional action. */
export function Banner(props: BannerProps): React.ReactElement {
  const Icon = props.kind === 'error' ? IconError : IconWarning
  return h('div', {
    key: props.key,
    className: `dvt-banner dvt-banner-${props.kind}`,
    role: props.kind === 'error' ? 'alert' : 'status',
  },
  h('span', { className: 'dvt-banner-icon' }, h(Icon, { size: 13 })),
  h('span', { className: 'dvt-banner-text' },
    props.title === undefined ? null : h('span', { className: 'dvt-banner-title' }, `${props.title} `),
    props.text,
  ),
  props.action ?? null,
  props.onDismiss === undefined
    ? null
    : h('button', {
      type: 'button',
      className: 'dvt-iconbtn',
      style: { width: 18, height: 18 },
      'aria-label': props.dismissLabel ?? 'Close',
      onClick: props.onDismiss,
    }, h(IconClose, { size: 11 })),
  )
}

/** Props of the empty/error state block. */
export interface EmptyStateProps {
  icon: React.ComponentType<IconProps>
  title: string
  hint?: string
  tone?: 'neutral' | 'error' | 'warn'
  actions?: React.ReactNode
}

/** Centered state block used for every "nothing to show" case. */
export function EmptyState(props: EmptyStateProps): React.ReactElement {
  const Icon = props.icon
  const tone = props.tone ?? 'neutral'
  return h('div', { className: 'dvt-state' },
    h('span', { className: `dvt-state-icon${tone === 'error' ? ' dvt-state-icon-error' : tone === 'warn' ? ' dvt-state-icon-warn' : ''}` },
      h(Icon, { size: 16 }),
    ),
    h('span', { className: 'dvt-state-title' }, props.title),
    props.hint === undefined || props.hint === ''
      ? null
      : h('span', { className: 'dvt-state-hint' }, props.hint),
    props.actions === undefined ? null : h('span', { className: 'dvt-state-actions' }, props.actions),
  )
}

/** Loading skeleton shaped like a compact detail list (gray blocks, no text). */
export function SkeletonRows(props: { rows?: number }): React.ReactElement {
  const rows = props.rows ?? 5
  return h('div', { className: 'dvt-skeleton dvt-skel-rows', 'aria-busy': 'true', 'aria-hidden': 'true' },
    Array.from({ length: rows }, (_, index) => h('div', { key: index, className: 'dvt-skel-row' },
      h(SkeletonBlock, { width: 9, height: 9, radius: '50%' }),
      h(SkeletonLine, { width: index % 2 === 0 ? '72%' : '58%', height: 9 }),
      h(SkeletonLine, { width: 34, height: 9 }),
    )),
  )
}

/** Uppercase section header with an optional count and trailing stats. */
export function SectionHeader(props: {
  title: string
  count?: string
  trailing?: React.ReactNode
}): React.ReactElement {
  return h('div', { className: 'dvt-section-head' },
    h('span', { className: 'dvt-section-title' }, props.title),
    props.count === undefined ? null : h('span', { className: 'dvt-section-count' }, props.count),
    props.trailing === undefined ? null : props.trailing,
  )
}

/** Spinner plus label, used while a write operation runs. */
export function Progress(props: { label: string }): React.ReactElement {
  return h('div', { className: 'dvt-progress', role: 'status' },
    h('span', { className: 'dvt-spinner' }),
    h('span', null, props.label),
  )
}

/** Error sentence for one stable API code. */
export function errorText(error: ApiError | null | undefined, t: TranslateFn): string {
  return F.errorMessage(error, t)
}

/** Operation-state badge: text is always present, color is secondary. */
export function StateBadge(props: { state: OperationState; t: TranslateFn }): React.ReactElement {
  const state = props.state
  const tone = state === 'succeeded'
    ? 'success'
    : state === 'failed'
      ? 'error'
      : state === 'unknown' || state === 'partial'
        ? 'warn'
        : ''
  return h('span', { className: `dvt-badge${tone === '' ? '' : ` dvt-badge-${tone}`}` },
    F.operationStateLabel(state, props.t),
  )
}

/** Source badge that keeps repository facts and plugin audits distinct. */
export function SourceBadge(props: { source: EventSource; t: TranslateFn }): React.ReactElement {
  return h('span', { className: 'dvt-badge dvt-badge-source' }, F.sourceLabel(props.source, props.t))
}

/** `+N / −M` line stats, rendered only for values the Host actually reported. */
export function LineStats(props: {
  additions?: number | null
  deletions?: number | null
  t: TranslateFn
}): React.ReactElement | null {
  const additions = props.additions
  const deletions = props.deletions
  const hasAdd = typeof additions === 'number'
  const hasDel = typeof deletions === 'number'
  if (!hasAdd && !hasDel) return null
  return h('span', { className: 'dvt-commit-stats' },
    hasAdd ? h('span', { className: 'dvt-stat-add', title: props.t('detail.additions', { count: additions as number }) }, `+${additions as number}`) : null,
    hasDel ? h('span', { className: 'dvt-stat-del', title: props.t('detail.deletions', { count: deletions as number }) }, `−${deletions as number}`) : null,
  )
}

/** File-count label with correct singular/plural. */
export function fileCountLabel(count: number, t: TranslateFn): string {
  return count === 1 ? t('timeline.stats.file') : t('timeline.stats.files', { count })
}

/** A subtle middot separator between meta fragments. */
export function DotSep(): React.ReactElement {
  return h('span', { className: 'dvt-dot-sep', 'aria-hidden': 'true' }, '·')
}
