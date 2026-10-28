/**
 * dsh-vcs-timeline — file operation panel (right column of the file view).
 *
 * When one file is selected the layout becomes three columns: tree | diff |
 * this panel. It answers "who touched this file, when, how much" for the
 * loaded window and lets the reader switch the diff to any of those commits.
 * Everything is derived from the same filtered events the diff list uses; the
 * uncommitted flag comes from the working-tree snapshot.
 * @module dsh-vcs-timeline/client/ui/fileinfo
 */

import * as React from 'react'
import type { FileChangeStatus, VcsEvent } from '../../shared/contracts.ts'
import * as F from '../format.ts'
import type { TimelineView } from '../file-index.ts'
import type { PanelDeps, PanelHandlers, PanelState } from '../types.ts'
import { IconAudit, IconCommit } from './icons.ts'

const h = React.createElement

/** One author's share of the file's changes. */
interface AuthorShare {
  actor: string
  commits: number
  additions: number
  deletions: number
  lastAt: string
}

/** Aggregate the commits that touched the selected file by author. */
export function authorShares(events: readonly VcsEvent[], path: string): AuthorShare[] {
  const byActor = new Map<string, AuthorShare>()
  for (const event of events) {
    const files = Array.isArray(event.changedFiles) ? event.changedFiles : []
    const file = files.find((entry) => entry.path === path)
    if (file === undefined) continue
    const actor = typeof event.actor === 'string' && event.actor !== '' ? event.actor : '?'
    const known = byActor.get(actor)
    const additions = typeof file.additions === 'number' ? file.additions : 0
    const deletions = typeof file.deletions === 'number' ? file.deletions : 0
    if (known === undefined) {
      byActor.set(actor, { actor, commits: 1, additions, deletions, lastAt: event.timestamp })
      continue
    }
    known.commits += 1
    known.additions += additions
    known.deletions += deletions
    if (event.timestamp > known.lastAt) known.lastAt = event.timestamp
  }
  return [...byActor.values()].sort((left, right) => right.commits - left.commits || left.actor.localeCompare(right.actor))
}

/** Relative-age label shared with the timeline rows. */
function whenLabel(iso: string, deps: PanelDeps): string {
  const relative = F.relativeTime(iso, Date.now())
  if (relative === null) return F.formatCompactTime(iso, deps.locale)
  const { t } = deps
  switch (relative.unit) {
    case 'justNow': return t('rel.justNow')
    case 'minutes': return t('rel.minutesAgo', { count: relative.count })
    case 'hours': return t('rel.hoursAgo', { count: relative.count })
    default: return t('rel.daysAgo', { count: relative.count })
  }
}

/** Status of the file inside one commit, or null. */
function fileStatusIn(event: VcsEvent, path: string): FileChangeStatus | null {
  const files = Array.isArray(event.changedFiles) ? event.changedFiles : []
  return files.find((entry) => entry.path === path)?.status ?? null
}

/** Per-file stats inside one commit. */
function fileStatsIn(event: VcsEvent, path: string): { additions: number | null; deletions: number | null } {
  const files = Array.isArray(event.changedFiles) ? event.changedFiles : []
  const file = files.find((entry) => entry.path === path)
  if (file === undefined) return { additions: null, deletions: null }
  return F.fileStats(file)
}

/** Right column of the file view. */
export function renderFileInfo(
  state: PanelState,
  deps: PanelDeps,
  handlers: PanelHandlers,
  view: TimelineView,
): React.ReactElement | null {
  const { t } = deps
  const selected = view.selected
  if (selected === null) return null
  const path = selected.path
  const events = view.visibleEvents.filter((event) => fileStatusIn(event, path) !== null)
  const shares = authorShares(events, path)
  const newest = events[0]
  const totalCommits = events.length
  const shownRevision = state.diff.data?.revisionB ?? state.diff.data?.revisionA ?? null
  const uncommitted = state.status?.entries.some((entry) => entry.path === path) === true
  const { dir, name } = F.splitRepoPath(path)
  let totalAdd = 0
  let totalDel = 0
  for (const share of shares) {
    totalAdd += share.additions
    totalDel += share.deletions
  }
  const maxCommits = Math.max(1, ...shares.map((share) => share.commits))
  return h('aside', { className: 'dvt-fileinfo', 'aria-label': t('file.info.title') },
    h('div', { className: 'dvt-fileinfo-head' },
      h('span', { className: 'dvt-fileinfo-title' }, t('file.info.title')),
      h('button', {
        type: 'button',
        className: 'dvt-btn dvt-btn-ghost dvt-btn-sm',
        onClick: () => handlers.onSelectFile(null),
      }, t('tree.showAll')),
    ),
    h('div', { className: 'dvt-fileinfo-path' },
      h('span', { className: `dvt-file-status dvt-status-${selected.status}` }, F.statusLetter(selected.status)),
      h('span', { className: 'dvt-fileinfo-name dvt-mono', title: path },
        dir === '' ? null : h('span', { className: 'dvt-file-dir' }, dir),
        h('span', null, name),
      ),
      uncommitted ? h('span', { className: 'dvt-fileinfo-dirty' }, t('file.info.uncommitted')) : null,
    ),
    h('div', { className: 'dvt-fileinfo-meta' },
      newest === undefined
        ? null
        : h('span', { className: 'dvt-fileinfo-latest' },
          t('file.latestBy', {
            author: newest.actor === undefined || newest.actor === '' ? t('common.unknown') : newest.actor,
            when: whenLabel(newest.timestamp, deps),
          }),
        ),
      h('span', null, t('file.info.counts', { commits: totalCommits, authors: shares.length })),
      h('span', { className: 'dvt-fileinfo-lines' },
        h('span', { className: 'dvt-stat-add' }, `+${totalAdd}`),
        h('span', { className: 'dvt-stat-del' }, `−${totalDel}`),
      ),
    ),
    h('div', { className: 'dvt-fileinfo-section' }, t('file.info.authors')),
    shares.length === 0
      ? h('div', { className: 'dvt-fileinfo-empty' }, t('common.empty'))
      : h('ul', { className: 'dvt-author-list' },
        shares.slice(0, 8).map((share) => h('li', { key: share.actor, className: 'dvt-author-row-item' },
          h('span', {
            className: 'dvt-tl-avatar',
            'aria-hidden': 'true',
            style: {
              background: `hsl(${F.authorHue(share.actor)} 58% 52%)`,
              color: 'var(--dsw-alias-bg-base)',
            },
          }, F.authorInitials(share.actor)),
          h('span', { className: 'dvt-author-name dvt-clip' }, share.actor),
          h('span', { className: 'dvt-author-bar' },
            h('span', {
              className: 'dvt-author-bar-fill',
              style: { width: `${Math.round((share.commits / maxCommits) * 100)}%` },
            }),
          ),
          h('span', { className: 'dvt-author-count' }, String(share.commits)),
        )),
      ),
    h('div', { className: 'dvt-fileinfo-section' }, t('file.info.commits')),
    h('ul', { className: 'dvt-fileinfo-commits' },
      events.slice(0, 20).map((event) => {
        const revision = event.commitHash ?? event.revision ?? ''
        const status = fileStatusIn(event, path)
        const stats = fileStatsIn(event, path)
        const active = shownRevision !== null && (shownRevision === event.commitHash || shownRevision === event.revision)
        return h('li', { key: event.id, className: `dvt-fileinfo-commit${active ? ' dvt-fileinfo-commit-active' : ''}` },
          h('button', {
            type: 'button',
            className: 'dvt-fileinfo-commit-btn',
            title: event.summary,
            onClick: () => handlers.onOpenFileRevision(revision),
          },
          h('span', { className: 'dvt-fileinfo-commit-top' },
            status === null ? null : h('span', { className: `dvt-file-status dvt-status-${status}` }, F.statusLetter(status)),
            h(IconCommit, { size: 10 }),
            h('span', { className: 'dvt-fileinfo-commit-author dvt-clip' },
              event.actor === undefined || event.actor === '' ? t('common.unknown') : event.actor,
            ),
            h('span', { className: 'dvt-fileinfo-commit-time' }, whenLabel(event.timestamp, deps)),
            h('span', { className: 'dvt-fileinfo-commit-hash dvt-mono' }, F.shortHash(revision, 7)),
          ),
          h('span', { className: 'dvt-fileinfo-commit-bottom' },
            h('span', { className: 'dvt-clip' }, F.truncate(event.summary, 60)),
            h('span', { className: 'dvt-fileinfo-commit-stats' },
              stats.additions === null ? null : h('span', { className: 'dvt-stat-add' }, `+${stats.additions}`),
              stats.deletions === null ? null : h('span', { className: 'dvt-stat-del' }, `−${stats.deletions}`),
            ),
          ),
          ),
        )
      }),
    ),
    events.length > 20 ? h('div', { className: 'dvt-fileinfo-more' }, t('file.info.more', { count: events.length - 20 })) : null,
    h('div', { className: 'dvt-fileinfo-section' }, t('file.info.related')),
    h('div', { className: 'dvt-fileinfo-related' },
      h('button', {
        type: 'button',
        className: 'dvt-btn dvt-btn-sm',
        onClick: () => handlers.onSetSource('audit'),
      }, h(IconAudit, { size: 11 }), h('span', null, t('file.info.openAudit'))),
    ),
  )
}
