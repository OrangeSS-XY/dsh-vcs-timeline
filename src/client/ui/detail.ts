/**
 * Commit detail and file diff views.
 *
 * The detail view is the sidebar's "editor pane": a 32px breadcrumb bar, a
 * compact metadata grid, then the changed-file list. Opening a file swaps the
 * body for a line-numbered unified diff without leaving the tab, so the host
 * layout is never touched.
 * @module dsh-vcs-timeline/client/ui/detail
 */

import * as React from 'react'
import type { ChangedFile, VcsEvent } from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type { PanelDeps, PanelHandlers, PanelState } from '../types.ts'
import {
  IconBack,
  IconCopy,
  IconDiff,
  IconFile,
  IconMerge,
} from './icons.ts'
import {
  Banner,
  EmptyState,
  errorText,
  IconButton,
  LineStats,
  SectionHeader,
  SkeletonRows,
  SourceBadge,
} from './primitives.ts'
import { selectedRepository } from './shared.ts'

const h = React.createElement

/** 32px breadcrumb bar shared by detail and diff. */
export function Subbar(props: {
  onBack: () => void
  backLabel: string
  title: string
  subtitle?: string
  trailing?: React.ReactNode
}): React.ReactElement {
  return h('div', { className: 'dvt-subbar' },
    h(IconButton, { label: props.backLabel, icon: IconBack, onClick: props.onBack }),
    h('span', { className: 'dvt-subbar-title dvt-clip', title: props.title }, props.title),
    props.subtitle === undefined || props.subtitle === ''
      ? null
      : h('span', { className: 'dvt-subbar-sub dvt-mono' }, props.subtitle),
    props.trailing ?? null,
  )
}

/** Sum of the reported file stats (undefined when no file reported any). */
function totals(files: readonly ChangedFile[]): { additions: number | null; deletions: number | null } {
  let additions = 0
  let deletions = 0
  let sawAdditions = false
  let sawDeletions = false
  for (const file of files) {
    if (typeof file.additions === 'number') { additions += file.additions; sawAdditions = true }
    if (typeof file.deletions === 'number') { deletions += file.deletions; sawDeletions = true }
  }
  return { additions: sawAdditions ? additions : null, deletions: sawDeletions ? deletions : null }
}

/** One changed-file row. */
function FileRow(props: {
  file: ChangedFile
  index: number
  t: PanelDeps['t']
  handlers: PanelHandlers
}): React.ReactElement {
  const { file, index, t, handlers } = props
  const { dir, name } = F.splitRepoPath(file.path)
  const { additions, deletions } = F.fileStats(file)
  return h('li', { className: 'dvt-file' },
    h('button', {
      type: 'button',
      className: 'dvt-file-btn',
      title: file.oldPath === undefined ? file.path : `${file.oldPath} → ${file.path}`,
      onClick: () => handlers.onOpenFile(file.path),
    },
    h('span', {
      className: `dvt-file-status dvt-status-${file.status}`,
      'aria-label': F.statusLabel(file.status, t),
      title: F.statusLabel(file.status, t),
    }, F.statusLetter(file.status)),
    h('span', { className: 'dvt-file-path' },
      file.oldPath === undefined
        ? null
        : h('span', { className: 'dvt-file-old' }, `${file.oldPath} → `),
      dir === '' ? null : h('span', { className: 'dvt-file-dir' }, dir),
      h('span', { className: 'dvt-file-name' }, name),
    ),
    h('span', { className: 'dvt-file-stats' },
      h(LineStats, {
        ...(additions === null ? {} : { additions }),
        ...(deletions === null ? {} : { deletions }),
        t,
      }),
      file.binary === true ? h('span', { className: 'dvt-bin', title: t('diff.binary') }, 'BIN') : null,
    ),
    h('span', { className: 'dvt-sr-only' }, `#${index + 1}`),
    ),
  )
}

/** Metadata grid of one commit. */
function MetaGrid(props: { event: VcsEvent; deps: PanelDeps }): React.ReactElement {
  const { event, deps } = props
  const { t } = deps
  const rows: Array<[string, React.ReactNode, boolean]> = []
  const time = F.formatTime(event.timestamp, deps.locale)
  rows.push([t('detail.time'), time === '' ? t('common.unknown') : time, false])
  rows.push([t('detail.author'), event.actor === undefined || event.actor === '' ? t('common.unknown') : event.actor, false])
  const revision = event.revision ?? event.commitHash
  if (revision !== undefined && revision !== '') {
    rows.push([t('detail.revision'), event.revision === undefined ? F.shortHash(revision, 12) : `r${revision}`, true])
  }
  if (event.branch !== undefined && event.branch !== '') rows.push([t('detail.branch'), event.branch, false])
  if (event.parentHashes !== undefined && event.parentHashes.length > 0) {
    rows.push([t('detail.parents'), event.parentHashes.map((parent) => F.shortHash(parent, 7)).join(', '), true])
  }
  rows.push([t('detail.source'), F.sourceLabel(event.source, t), false])
  return h('dl', { className: 'dvt-meta' },
    rows.flatMap(([key, value, mono]) => [
      h('dt', { key: `${key}-k`, className: 'dvt-meta-key' }, key),
      h('dd', { key: `${key}-v`, className: `dvt-meta-val${mono ? ' mono' : ''}` }, value),
    ]),
  )
}

/** Pinned breadcrumb of the commit detail. */
export function commitDetailHeader(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  const { t } = deps
  const event = state.changeSet.event
  const revision = event === null ? '' : event.revision ?? event.commitHash ?? ''
  return h(Subbar, {
    onBack: handlers.onBackFromDetail,
    backLabel: t('aria.back'),
    title: F.shortHash(revision, 12) === '' ? t('detail.title') : F.shortHash(revision, 12),
    trailing: event === null ? null : h(SourceBadge, { source: event.source, t }),
  })
}

/** Scrollable commit detail: hero summary, metadata, changed files. */
export function commitDetailBody(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  const { t } = deps
  const event = state.changeSet.event
  if (event === null) {
    return h(EmptyState, { icon: IconFile, title: t('common.empty') })
  }
  const revision = event.revision ?? event.commitHash ?? ''
  const merge = F.isMergeCommit(event)
  const files = state.changeSet.data?.files ?? []
  const sums = totals(files)
  return h('div', { className: 'dvt-col' },
    h('div', { className: 'dvt-hero' },
      h('div', { className: 'dvt-hero-summary' }, F.truncate(event.summary, 500) === '' ? t('timeline.noRevision') : event.summary),
      h('div', { className: 'dvt-hero-meta' },
        merge ? h('span', { className: 'dvt-tag dvt-tag-merge' }, h(IconMerge, { size: 10 }), h('span', null, t('timeline.merge'))) : null,
        event.branch === undefined || event.branch === ''
          ? null
          : h('span', { className: 'dvt-tag', title: event.branch },
            h('span', null, F.truncate(event.branch, 22)),
          ),
        h('span', { className: 'dvt-mono' }, `#${F.shortHash(revision, 9)}`),
      ),
    ),
    h(MetaGrid, { event, deps }),
    h('div', { className: 'dvt-section' },
      h(SectionHeader, {
        title: t('detail.files.header'),
        count: state.changeSet.data === null ? undefined : F.truncate(t('detail.files.stats', { files: files.length }), 40),
        trailing: sums.additions === null && sums.deletions === null
          ? state.changeSet.data === null ? undefined : h('span', { className: 'dvt-section-count' }, t('detail.stats.unavailable'))
          : h('span', { className: 'dvt-section-stats' },
            h(LineStats, {
              ...(sums.additions === null ? {} : { additions: sums.additions }),
              ...(sums.deletions === null ? {} : { deletions: sums.deletions }),
              t,
            }),
          ),
      }),
      state.changeSet.loading ? h(SkeletonRows, { rows: 3 }) : null,
      state.changeSet.error !== null
        ? h(Banner, {
          kind: 'error',
          text: errorText(state.changeSet.error, t),
          action: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: () => handlers.onOpenEvent(event) }, t('common.retry')),
        })
        : null,
      state.changeSet.loading || state.changeSet.data === null
        ? null
        : files.length === 0
          ? h('div', { className: 'dvt-state-hint', style: { padding: '8px 10px' } }, t('detail.emptyFiles'))
          : h('ul', { className: 'dvt-files', 'aria-label': t('detail.files.header') },
            files.map((file, index) => h(FileRow, { key: `${file.path}:${index}`, file, index, t, handlers })),
          ),
    ),
  )
}

/** Pinned breadcrumb of the file diff. */
export function diffHeader(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  const { t } = deps
  const path = state.diff.filePath ?? ''
  const { dir, name } = F.splitRepoPath(path)
  const hasText = state.diff.data !== null && state.diff.data.binary !== true && state.diff.data.text.trim() !== ''
  return h(Subbar, {
    onBack: handlers.onBackFromDiff,
    backLabel: t('aria.back'),
    title: name === '' ? t('diff.title') : name,
    subtitle: dir === '' ? '' : dir,
    trailing: hasText
      ? h(IconButton, {
        label: state.copied ? t('common.copied') : t('aria.copyDiff'),
        icon: IconCopy,
        onClick: handlers.onCopyDiff,
      })
      : null,
  })
}

/** Scrollable diff body with a line-numbered gutter. */
export function diffBody(state: PanelState, deps: PanelDeps, handlers: PanelHandlers): React.ReactElement {
  const { t } = deps
  const diff = state.diff
  const rows = diff.data === null ? [] : F.diffRows(diff.data.text)
  const path = diff.filePath ?? ''
  const repository = selectedRepository(state)
  return h('div', { className: 'dvt-col' },
    repository === null ? null : h('span', { className: 'dvt-sr-only' }, repository.displayName),
    diff.loading ? h(SkeletonRows, { rows: 6 }) : null,
    diff.error !== null
      ? h(Banner, {
        kind: 'error',
        text: errorText(diff.error, t),
        action: h('button', { type: 'button', className: 'dvt-btn dvt-btn-sm', onClick: handlers.onBackFromDiff }, t('aria.back')),
      })
      : null,
    diff.data === null
      ? (diff.loading || diff.error !== null ? null : h(EmptyState, { icon: IconDiff, title: t('diff.empty') }))
      : h('div', { className: 'dvt-col' },
        diff.data.binary === true
          ? h(Banner, { kind: 'info', title: t('diff.binary'), text: t('diff.binary.hint') })
          : null,
        diff.data.truncated === true
          ? h(Banner, { kind: 'warn', title: t('common.warning'), text: t('diff.truncated.generic') })
          : null,
        diff.data.binary === true
          ? null
          : rows.length === 0
            ? h(EmptyState, { icon: IconDiff, title: t('diff.empty') })
            : h('div', { className: 'dvt-diff', 'aria-label': t('diff.title') },
              rows.map((row, index) => h('div', {
                key: `row-${index}`,
                className: `dvt-diff-row dvt-diff-${row.kind}`,
              },
              h('span', { className: 'dvt-diff-gutter', 'aria-label': t('diff.lineNumbers') },
                h('span', { className: 'dvt-diff-old' }, row.oldLine === null ? '' : String(row.oldLine)),
                h('span', { className: 'dvt-diff-new' }, row.newLine === null ? '' : String(row.newLine)),
              ),
              h('span', { className: 'dvt-diff-code' }, row.text === '' ? ' ' : row.text),
              )),
            ),
        diff.data.binary !== true && rows.length > 0
          ? h('div', { className: 'dvt-diff-foot' },
            h('span', { className: 'dvt-mono dvt-clip', title: path }, path),
            h('span', null, t('diff.lines', { count: rows.length })),
            h('span', null, F.formatBytes(diff.data.bytes)),
            diff.data.truncated === true ? h('span', null, t('diff.truncated')) : null,
          )
          : null,
      ),
  )
}
