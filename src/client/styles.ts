/**
 * dsh-vcs-timeline — component-local stylesheet.
 *
 * The panel renders this text exactly once inside its own tree
 * (`<style>{STYLES}</style>`), so no global selector, cascade reset, or id
 * ever escapes the tab. Colors come only from DSH theme tokens; there is no
 * literal color value in this file (enforced by `client.render.test.ts`).
 * @module dsh-vcs-timeline/client/styles
 */

/** The whole panel stylesheet, scoped under the `dvt-` class prefix. */
export const STYLES = `
.dvt-root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding: 10px;
  overflow-x: hidden;
  overflow-y: auto;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.45;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-specific-sidebar-fill);
}
.dvt-root, .dvt-root * { box-sizing: border-box; min-width: 0; }
.dvt-root button, .dvt-root input, .dvt-root select, .dvt-root textarea { font: inherit; color: inherit; }
.dvt-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dvt-row-wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.dvt-grow { flex: 1 1 auto; min-width: 0; }
.dvt-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dvt-muted { color: var(--dsw-alias-label-secondary); }
.dvt-faint { color: var(--dsw-alias-label-tertiary); }
.dvt-clip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-break { overflow-wrap: anywhere; word-break: break-word; }
.dvt-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
.dvt-title { font-size: 13px; font-weight: 600; }
.dvt-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.dvt-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
}
.dvt-section-title { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dvt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: 0 0 auto;
  padding: 3px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-specific-button-secondary-fill);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  white-space: nowrap;
}
.dvt-btn:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-btn:disabled { cursor: not-allowed; color: var(--dsw-alias-label-tertiary); }
.dvt-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dvt-btn-primary {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
}
.dvt-btn-primary:hover { background: var(--dsw-alias-brand-primary); }
.dvt-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-specific-button-secondary-fill);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
.dvt-icon-btn:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-icon-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dvt-icon-btn:disabled { cursor: not-allowed; color: var(--dsw-alias-label-tertiary); }
.dvt-select, .dvt-input, .dvt-textarea {
  width: 100%;
  max-width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
.dvt-select:focus-visible, .dvt-input:focus-visible, .dvt-textarea:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dvt-textarea { min-height: 64px; resize: vertical; }
.dvt-input::placeholder, .dvt-textarea::placeholder { color: var(--dsw-alias-label-tertiary); }
.dvt-tabs { display: flex; gap: 4px; padding: 2px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
.dvt-tab {
  flex: 1 1 0;
  padding: 4px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  white-space: nowrap;
}
.dvt-tab[aria-selected="true"] { background: var(--dsw-alias-interactive-selected); color: var(--dsw-alias-label-primary); font-weight: 600; }
.dvt-tab:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dvt-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  white-space: nowrap;
}
.dvt-chip[aria-pressed="true"] { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-selected); color: var(--dsw-alias-label-primary); }
.dvt-chip:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dvt-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-size: 10px;
  white-space: nowrap;
}
.dvt-badge-source-repository { border-color: var(--dsw-alias-border-l2); }
.dvt-badge-source-plugin-audit { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary); }
.dvt-badge-success { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
.dvt-badge-warn { border-color: var(--dsw-alias-state-warn-primary); color: var(--dsw-alias-state-warn-primary); }
.dvt-badge-error { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.dvt-banner {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-left-width: 3px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
}
.dvt-banner-error { border-left-color: var(--dsw-alias-state-error-primary); }
.dvt-banner-warn { border-left-color: var(--dsw-alias-state-warn-primary); }
.dvt-banner-info { border-left-color: var(--dsw-alias-brand-primary); }
.dvt-banner-title { font-weight: 600; color: var(--dsw-alias-label-primary); }
.dvt-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.dvt-list-item { margin: 0; padding: 0; }
.dvt-row-btn {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.dvt-row-btn:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-row-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.dvt-row-main { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; }
.dvt-glyph { flex: 0 0 auto; width: 12px; text-align: center; color: var(--dsw-alias-brand-primary); }
.dvt-row-summary { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-row-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; width: 100%; padding-left: 18px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dvt-row-meta > span { min-width: 0; overflow-wrap: anywhere; }
.dvt-skeleton { display: flex; flex-direction: column; gap: 6px; }
.dvt-skeleton-row {
  height: 30px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  animation: dvt-pulse 1.2s ease-in-out infinite;
}
@keyframes dvt-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
.dvt-empty { padding: 14px 8px; text-align: center; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dvt-error { color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.dvt-error-code { color: var(--dsw-alias-label-tertiary); font-size: 10px; }
.dvt-detail-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dvt-grid { display: grid; grid-template-columns: minmax(64px, 34%) minmax(0, 1fr); gap: 4px 8px; margin: 0; }
.dvt-grid dt { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dvt-grid dd { margin: 0; overflow-wrap: anywhere; }
.dvt-file-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.dvt-file-row:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-file-row:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -1px; }
.dvt-file-status { flex: 0 0 auto; width: 14px; font-weight: 600; text-align: center; }
.dvt-file-status-added { color: var(--dsw-alias-state-success-primary); }
.dvt-file-status-deleted { color: var(--dsw-alias-state-error-primary); }
.dvt-file-status-renamed, .dvt-file-status-copied { color: var(--dsw-alias-state-warn-primary); }
.dvt-file-path { flex: 1 1 auto; overflow-wrap: anywhere; }
.dvt-file-counts { flex: 0 0 auto; display: flex; gap: 4px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dvt-diff-pre {
  margin: 0;
  padding: 0;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: visible;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
}
.dvt-diff-line { display: block; padding: 0 6px; min-height: 1.5em; white-space: pre; }
.dvt-diff-added { color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-bg-layer-2); }
.dvt-diff-removed { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-2); }
.dvt-diff-hunk { color: var(--dsw-alias-brand-primary); }
.dvt-diff-meta { color: var(--dsw-alias-label-tertiary); }
.dvt-diff-context { color: var(--dsw-alias-label-secondary); }
.dvt-audit-row-state { flex: 0 0 auto; }
.dvt-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 12px;
  overflow-y: auto;
  background: var(--dsw-alias-bg-overlay);
}
.dvt-dialog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 560px;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.dvt-dialog-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dvt-dialog-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.dvt-warning-list { margin: 0; padding-left: 16px; color: var(--dsw-alias-state-warn-primary); overflow-wrap: anywhere; }
.dvt-argv {
  margin: 0;
  padding: 6px;
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dvt-footer {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary);
}
.dvt-footer-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.dvt-footer-line > span { overflow-wrap: anywhere; }
.dvt-opbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
.dvt-kv { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.dvt-link { padding: 0; border: 0; background: transparent; color: var(--dsw-alias-brand-primary); cursor: pointer; }
.dvt-link:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
`
