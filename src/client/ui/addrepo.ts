/**
 * dsh-vcs-timeline — manual "add repository" dialog.
 *
 * Discovery only scans DSH workspaces, so a checkout outside them (an SVN
 * working copy in D:\..., a git clone on another drive) must be added by path.
 * The dialog validates through the normal `/vcs/repos/add` gate; when the VCS
 * client is missing it explains exactly what to install/configure.
 * @module dsh-vcs-timeline/client/ui/addrepo
 */

import * as React from 'react'
import * as F from '../format.ts'
import type { PanelDeps, PanelHandlers, PanelState } from '../types.ts'
import { IconClose, IconRepo } from './icons.ts'
import { Banner } from './primitives.ts'

const h = React.createElement

/** The modal add-repository dialog, or null when closed. */
export function renderAddRepositoryDialog(
  state: PanelState,
  deps: PanelDeps,
  handlers: PanelHandlers,
): React.ReactElement | null {
  const { t } = deps
  const dialog = state.addRepository
  if (!dialog.open) return null
  const missingTool = dialog.error !== null && dialog.error.code === 'vcs-not-installed'
  const submit = (): void => {
    if (!dialog.loading && dialog.path.trim() !== '') handlers.onAddRepositorySubmit()
  }
  return h('div', {
    className: 'dvt-overlay dvt-addrepo-overlay',
    onClick: (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) handlers.onToggleAddRepository()
    },
  },
  h('div', {
    className: 'dvt-dialog dvt-addrepo',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': t('addRepo.title'),
  },
  h('div', { className: 'dvt-dialog-head' },
    h('span', { className: 'dvt-dialog-title' }, h(IconRepo, { size: 12 }), h('span', null, t('addRepo.title'))),
    h('button', {
      type: 'button',
      className: 'dvt-iconbtn',
      'aria-label': t('common.close'),
      onClick: handlers.onToggleAddRepository,
    }, h(IconClose, { size: 12 })),
  ),
  h('div', { className: 'dvt-dialog-body' },
    h('div', { className: 'dvt-dialog-section' },
      h('label', { className: 'dvt-dialog-label', htmlFor: 'dvt-addrepo-path' }, t('addRepo.pathLabel')),
      h('input', {
        id: 'dvt-addrepo-path',
        className: 'dvt-input dvt-addrepo-input',
        type: 'text',
        value: dialog.path,
        placeholder: t('addRepo.placeholder'),
        spellCheck: false,
        autoFocus: true,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => handlers.onAddRepositoryPathChange(event.currentTarget.value),
        onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') submit()
          if (event.key === 'Escape') handlers.onToggleAddRepository()
        },
      }),
      h('div', { className: 'dvt-dialog-note' }, t('addRepo.hint')),
    ),
    missingTool ? h('div', { className: 'dvt-dialog-section' }, h('div', { className: 'dvt-dialog-note' }, t('addRepo.svnHint'))) : null,
    dialog.error === null
      ? null
      : h('div', { className: 'dvt-dialog-section' }, h(Banner, { kind: 'error', text: F.errorMessage(dialog.error, t) })),
  ),
  h('div', { className: 'dvt-dialog-foot' },
    h('span', { className: 'dvt-grow' }),
    h('button', {
      type: 'button',
      className: 'dvt-btn dvt-btn-sm',
      onClick: handlers.onToggleAddRepository,
    }, t('common.cancel')),
    h('button', {
      type: 'button',
      className: 'dvt-btn dvt-btn-primary dvt-btn-sm',
      disabled: dialog.loading || dialog.path.trim() === '',
      onClick: submit,
    }, dialog.loading ? t('common.loading') : t('addRepo.submit')),
  ),
  ),
  )
}
