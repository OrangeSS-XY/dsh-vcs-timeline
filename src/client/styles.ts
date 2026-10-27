/**
 * dsh-vcs-timeline — component-local stylesheet (IDE-density redesign).
 *
 * Rendered exactly once inside the panel tree (`<style>{STYLES}</style>`), so
 * nothing global escapes the tab. The design language is a compact developer
 * tool: a 34px toolbar, a 30px tab/filter strip, dense 46px history rows with
 * a graph gutter, hairline separators instead of cards, and a 24px status bar.
 *
 * Colors come only from DSH theme tokens (`--dsw-alias-*`,
 * `--dsw-specific-*`), which is what makes light and dark themes work without
 * a second stylesheet. `client.render.test.ts` enforces "no literal color".
 * @module dsh-vcs-timeline/client/styles
 */

/** The whole panel stylesheet, scoped under the `dvt-` class prefix. */
export const STYLES = `
.dvt-root {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.45;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  -webkit-font-smoothing: antialiased;
}
.dvt-root, .dvt-root * { box-sizing: border-box; min-width: 0; }
.dvt-root button, .dvt-root input, .dvt-root select, .dvt-root textarea { font: inherit; color: inherit; margin: 0; }
.dvt-root :focus-visible { outline: 1.5px solid var(--dsw-alias-brand-primary); outline-offset: 1px; border-radius: 4px; }

/* ---------- primitives ---------- */
.dvt-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dvt-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dvt-grow { flex: 1 1 auto; min-width: 0; }
.dvt-mono { font-family: ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace; font-variant-ligatures: none; }
.dvt-muted { color: var(--dsw-alias-label-secondary); }
.dvt-faint { color: var(--dsw-alias-label-tertiary); }
.dvt-clip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-break { overflow-wrap: anywhere; word-break: break-word; }
.dvt-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.dvt-sep { height: 1px; margin: 0; border: 0; background: var(--dsw-alias-border-l1); }

/* ---------- buttons ---------- */
.dvt-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  flex: 0 0 auto; height: 24px; padding: 0 9px;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 5px;
  background: var(--dsw-specific-button-secondary-fill);
  color: var(--dsw-alias-label-primary);
  font-size: 11.5px; font-weight: 500; white-space: nowrap; cursor: pointer;
}
.dvt-btn:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-btn:active { background: var(--dsw-alias-interactive-pressed); }
.dvt-btn:disabled { cursor: not-allowed; opacity: .5; }
.dvt-btn-primary {
  border-color: var(--dsw-alias-brand-primary);
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-bg-base);
}
.dvt-btn-primary:hover { background: var(--dsw-alias-brand-primary); opacity: .92; }
.dvt-btn-ghost { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); }
.dvt-btn-ghost:hover { background: var(--dsw-alias-interactive-hover); color: var(--dsw-alias-label-primary); }
.dvt-btn-sm { height: 22px; padding: 0 7px; font-size: 11px; }
.dvt-iconbtn {
  display: inline-flex; align-items: center; justify-content: center;
  flex: 0 0 auto; width: 24px; height: 24px; padding: 0;
  border: 1px solid transparent; border-radius: 5px;
  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dvt-iconbtn:hover { background: var(--dsw-alias-interactive-hover); color: var(--dsw-alias-label-primary); }
.dvt-iconbtn[aria-expanded="true"], .dvt-iconbtn[aria-pressed="true"] {
  background: var(--dsw-alias-interactive-selected); color: var(--dsw-alias-label-primary);
}
.dvt-iconbtn:disabled { cursor: not-allowed; opacity: .45; }

/* ---------- inputs ---------- */
.dvt-input, .dvt-textarea, .dvt-select {
  width: 100%; max-width: 100%;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 5px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
}
.dvt-input, .dvt-select { height: 24px; padding: 0 7px; font-size: 11.5px; }
.dvt-select { appearance: none; padding-right: 20px; cursor: pointer; }
.dvt-textarea { padding: 6px 7px; font-size: 12px; line-height: 1.5; min-height: 62px; resize: vertical; }
.dvt-input::placeholder, .dvt-textarea::placeholder { color: var(--dsw-alias-label-tertiary); }

/* ---------- chrome: toolbar / tabs / filters ---------- */
.dvt-chrome { flex: 0 0 auto; display: flex; flex-direction: column; background: var(--dsw-specific-sidebar-fill); }
.dvt-toolbar { display: flex; align-items: center; gap: 4px; height: 34px; padding: 0 6px 0 8px; flex: 0 0 auto; }
.dvt-repo {
  display: flex; align-items: center; gap: 5px; flex: 1 1 auto; min-width: 0;
  position: relative;
  height: 24px; padding: 0 4px; border: 1px solid transparent; border-radius: 5px;
  background: transparent; color: var(--dsw-alias-label-primary);
  cursor: pointer; text-align: left;
}
.dvt-repo:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-repo-icon { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); display: inline-flex; }
.dvt-repo-name { flex: 0 1 auto; min-width: 0; font-weight: 600; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-repo-vcs { flex: 0 0 auto; font-size: 10px; font-weight: 600; letter-spacing: .03em; color: var(--dsw-alias-label-tertiary); text-transform: uppercase; }
.dvt-repo-caret { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); display: inline-flex; }
.dvt-repo-native { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; }
.dvt-branch {
  display: inline-flex; align-items: center; gap: 3px; flex: 0 1 auto; min-width: 0;
  max-width: 116px; height: 20px; padding: 0 6px;
  border-radius: 4px; background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10.5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dvt-branch > span { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-toolbar-actions { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; margin-left: auto; }

.dvt-tabstrip { display: flex; align-items: stretch; gap: 0; height: 30px; padding: 0 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dvt-tab {
  display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto;
  height: 30px; padding: 0 9px; border: 0; border-bottom: 1.5px solid transparent;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 11.5px; font-weight: 500; cursor: pointer; white-space: nowrap;
}
.dvt-tab:hover { color: var(--dsw-alias-label-primary); }
.dvt-tab[aria-selected="true"] { color: var(--dsw-alias-label-primary); border-bottom-color: var(--dsw-alias-brand-primary); }
.dvt-tab-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary);
  font-size: 9.5px; font-weight: 600;
}
.dvt-tab-tail { display: flex; align-items: center; gap: 2px; margin-left: auto; }

.dvt-filterbar { display: flex; align-items: center; gap: 4px; padding: 4px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dvt-search { position: relative; display: flex; align-items: center; flex: 1 1 auto; min-width: 84px; }
.dvt-search > svg { position: absolute; left: 6px; color: var(--dsw-alias-label-tertiary); pointer-events: none; }
.dvt-search-input {
  width: 100%; height: 24px; padding: 0 22px 0 24px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 11.5px;
}
.dvt-search-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.dvt-search-input:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: none; }
.dvt-search-clear {
  position: absolute; right: 2px; display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; padding: 0; border: 0; border-radius: 4px;
  background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer;
}
.dvt-search-clear:hover { background: var(--dsw-alias-interactive-hover); color: var(--dsw-alias-label-primary); }
.dvt-chips { display: flex; align-items: center; gap: 3px; flex: 0 0 auto; }
.dvt-chip {
  display: inline-flex; align-items: center; height: 22px; padding: 0 7px;
  border: 1px solid transparent; border-radius: 4px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 11px; white-space: nowrap; cursor: pointer;
}
.dvt-chip:hover { background: var(--dsw-alias-interactive-hover); color: var(--dsw-alias-label-primary); }
.dvt-chip[aria-pressed="true"] {
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary); font-weight: 600;
}
.dvt-author-row { display: flex; align-items: center; gap: 4px; padding: 0 6px 5px; }
.dvt-author-row .dvt-input { height: 23px; }

/* ---------- body / scroll ---------- */
.dvt-body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.dvt-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; }

/* ---------- history list ---------- */
.dvt-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.dvt-commit { position: relative; margin: 0; padding: 0; }
.dvt-commit-btn {
  display: flex; align-items: stretch; gap: 0; width: 100%; padding: 0;
  border: 0; border-radius: 0; background: transparent; text-align: left; cursor: pointer;
}
.dvt-commit-btn:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-commit-btn[data-selected="true"] {
  background: var(--dsw-alias-interactive-selected);
  box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary);
}
.dvt-graph { position: relative; flex: 0 0 auto; width: 22px; align-self: stretch; }
.dvt-graph::before {
  content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px;
  transform: translateX(-.5px); background: var(--dsw-alias-border-l2);
}
.dvt-commit:first-child .dvt-graph::before { top: 19.5px; }
.dvt-commit:last-child .dvt-graph::before { bottom: calc(100% - 19.5px); }
.dvt-node {
  position: absolute; left: 50%; top: 15px; width: 9px; height: 9px;
  transform: translateX(-50%); border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-base);
}
.dvt-node-merge {
  width: 9px; height: 9px; background: var(--dsw-alias-bg-base);
  border: 1.5px solid var(--dsw-alias-brand-primary);
}
.dvt-commit-body { flex: 1 1 auto; min-width: 0; padding: 7px 8px 7px 0; display: flex; flex-direction: column; gap: 2px; }
.dvt-commit-top { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.dvt-summary {
  flex: 1 1 auto; min-width: 0; font-size: 12px; font-weight: 500; line-height: 1.35;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dvt-commit-stats { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10.5px; }
.dvt-stat-add { color: var(--dsw-alias-state-success-primary); white-space: nowrap; }
.dvt-stat-del { color: var(--dsw-alias-state-error-primary); white-space: nowrap; }
.dvt-stat-files { color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.dvt-commit-bottom { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.dvt-commit-bottom .dvt-stat-files { margin-left: auto; flex: 0 0 auto; }
.dvt-hash { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
.dvt-author { flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-time { flex: 0 0 auto; }
.dvt-dot-sep { flex: 0 0 auto; opacity: .55; }
.dvt-tag {
  display: inline-flex; align-items: center; gap: 2px; flex: 0 1 auto; max-width: 104px;
  height: 16px; padding: 0 4px; border-radius: 3px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 9.5px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dvt-tag > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-tag-merge { color: var(--dsw-alias-brand-primary); background: transparent; padding: 0 2px; }
.dvt-list-more { display: flex; justify-content: center; padding: 6px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dvt-list-count { padding: 4px 8px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }

/* ---------- states: empty / error / loading ---------- */
.dvt-state { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 30px 18px; text-align: center; }
.dvt-state-icon { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary); }
.dvt-state-icon-error { color: var(--dsw-alias-state-error-primary); }
.dvt-state-icon-warn { color: var(--dsw-alias-state-warn-primary); }
.dvt-state-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dvt-state-hint { max-width: 300px; font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.dvt-state-actions { display: flex; gap: 6px; margin-top: 2px; }
.dvt-skeleton { display: flex; flex-direction: column; padding: 8px; gap: 8px; }
.dvt-skel-row { display: flex; align-items: center; gap: 8px; height: 30px; }
.dvt-skel-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--dsw-alias-bg-layer-2); animation: dvt-pulse 1.3s ease-in-out infinite; }
.dvt-skel-line { flex: 1 1 auto; height: 9px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2); animation: dvt-pulse 1.3s ease-in-out infinite; }
.dvt-skel-line.short { flex: 0 1 42%; }
@keyframes dvt-pulse { 0%, 100% { opacity: .85; } 50% { opacity: .4; } }

/* ---------- banners ---------- */
.dvt-banner { display: flex; align-items: flex-start; gap: 6px; padding: 5px 8px; margin: 6px; border-radius: 5px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 11px; }
.dvt-banner-icon { flex: 0 0 auto; display: inline-flex; margin-top: 1px; }
.dvt-banner-warn { color: var(--dsw-alias-label-secondary); box-shadow: inset 2px 0 0 var(--dsw-alias-state-warn-primary); }
.dvt-banner-warn .dvt-banner-icon { color: var(--dsw-alias-state-warn-primary); }
.dvt-banner-error { box-shadow: inset 2px 0 0 var(--dsw-alias-state-error-primary); }
.dvt-banner-error .dvt-banner-icon { color: var(--dsw-alias-state-error-primary); }
.dvt-banner-info { box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary); }
.dvt-banner-info .dvt-banner-icon { color: var(--dsw-alias-brand-primary); }
.dvt-banner-text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.dvt-banner-title { font-weight: 600; color: var(--dsw-alias-label-primary); }
.dvt-banner-action { flex: 0 0 auto; }

/* ---------- detail: subbar / hero / meta / sections ---------- */
.dvt-pinned { flex: 0 0 auto; }
.dvt-subbar { display: flex; align-items: center; gap: 4px; height: 32px; padding: 0 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-specific-sidebar-fill); }
.dvt-subbar-title { flex: 1 1 auto; min-width: 0; font-size: 12px; font-weight: 600; }
.dvt-subbar-sub { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); font-size: 10.5px; }
.dvt-hero { display: flex; flex-direction: column; gap: 4px; padding: 9px 10px 7px; }
.dvt-hero-summary { font-size: 12.5px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
.dvt-hero-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.dvt-meta { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 3px 10px; margin: 0; padding: 7px 10px; }
.dvt-meta-key { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.dvt-meta-val { font-size: 11px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; margin: 0; }
.dvt-meta-val.mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10.5px; }
.dvt-section { display: flex; flex-direction: column; border-top: 1px solid var(--dsw-alias-border-l1); }
.dvt-section-head { display: flex; align-items: center; gap: 6px; padding: 5px 8px 4px 10px; }
.dvt-section-title { font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
.dvt-section-count { flex: 0 0 auto; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dvt-section-stats { margin-left: auto; display: inline-flex; gap: 5px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; }

/* ---------- changed files ---------- */
.dvt-files { display: flex; flex-direction: column; margin: 0; padding: 0 0 2px; list-style: none; }
.dvt-file { margin: 0; padding: 0; }
.dvt-file-btn {
  display: flex; align-items: center; gap: 7px; width: 100%;
  height: 26px; padding: 0 8px 0 10px; border: 0; background: transparent;
  text-align: left; cursor: pointer; color: var(--dsw-alias-label-secondary);
}
.dvt-file-btn:hover { background: var(--dsw-alias-interactive-hover); color: var(--dsw-alias-label-primary); }
.dvt-file-status {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 3px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 9.5px; font-weight: 700;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
}
.dvt-status-added { color: var(--dsw-alias-state-success-primary); }
.dvt-status-deleted { color: var(--dsw-alias-state-error-primary); }
.dvt-status-renamed, .dvt-status-copied { color: var(--dsw-alias-state-warn-primary); }
.dvt-file-path { flex: 1 1 auto; min-width: 0; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-file-dir { color: var(--dsw-alias-label-tertiary); }
.dvt-file-name { color: var(--dsw-alias-label-primary); }
.dvt-file-stats { flex: 0 0 auto; display: inline-flex; gap: 5px; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; }
.dvt-bin { flex: 0 0 auto; padding: 0 4px; border-radius: 3px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary); font-size: 9px; font-weight: 600; }
.dvt-file-old { color: var(--dsw-alias-label-tertiary); }

/* ---------- diff ---------- */
.dvt-diff { display: flex; flex-direction: column; overflow-x: auto; overflow-y: hidden; font-family: ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace; font-size: 10.5px; line-height: 1.55; }
.dvt-diff-row { display: flex; align-items: stretch; width: max-content; min-width: 100%; }
.dvt-diff-row:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-diff-gutter {
  position: sticky; left: 0; z-index: 2;
  flex: 0 0 auto; display: inline-flex; align-items: stretch; justify-content: flex-end;
  width: 66px; padding: 0 4px; border-right: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-tertiary); font-size: 9.5px; user-select: none;
}
.dvt-diff-old, .dvt-diff-new { width: 28px; text-align: right; padding: 0 2px; }
.dvt-diff-code { flex: 0 0 auto; padding: 0 12px 0 8px; white-space: pre; }
.dvt-diff-added { background: var(--dsw-alias-bg-layer-2); }
.dvt-diff-added .dvt-diff-code { color: var(--dsw-alias-state-success-primary); }
.dvt-diff-removed { background: var(--dsw-alias-bg-layer-2); }
.dvt-diff-removed .dvt-diff-code { color: var(--dsw-alias-state-error-primary); }
.dvt-diff-added > .dvt-diff-gutter, .dvt-diff-removed > .dvt-diff-gutter, .dvt-diff-hunk > .dvt-diff-gutter { background: var(--dsw-alias-bg-layer-2); }
.dvt-diff-hunk .dvt-diff-code { color: var(--dsw-alias-brand-primary); }
.dvt-diff-hunk { background: var(--dsw-alias-bg-layer-2); }
.dvt-diff-meta .dvt-diff-code { color: var(--dsw-alias-label-tertiary); }
.dvt-diff-context .dvt-diff-code { color: var(--dsw-alias-label-secondary); }
.dvt-diff-foot { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 10px; color: var(--dsw-alias-label-tertiary); }

/* ---------- audit ---------- */
.dvt-audit-row { display: flex; width: 100%; }
.dvt-audit-btn {
  display: flex; align-items: flex-start; gap: 8px; width: 100%;
  padding: 7px 8px 7px 10px; border: 0; background: transparent; text-align: left; cursor: pointer;
}
.dvt-audit-btn:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-audit-icon { flex: 0 0 auto; display: inline-flex; margin-top: 1px; color: var(--dsw-alias-label-tertiary); }
.dvt-audit-icon-success { color: var(--dsw-alias-state-success-primary); }
.dvt-audit-icon-error { color: var(--dsw-alias-state-error-primary); }
.dvt-audit-icon-warn { color: var(--dsw-alias-state-warn-primary); }
.dvt-audit-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dvt-audit-title { font-size: 11.5px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-audit-meta { display: flex; align-items: center; gap: 5px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dvt-badge {
  display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto;
  height: 17px; padding: 0 5px; border-radius: 3px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  font-size: 9.5px; font-weight: 600; white-space: nowrap;
}
.dvt-badge-success { color: var(--dsw-alias-state-success-primary); }
.dvt-badge-error { color: var(--dsw-alias-state-error-primary); }
.dvt-badge-warn { color: var(--dsw-alias-state-warn-primary); }
.dvt-badge-source { border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-tertiary); font-weight: 500; }
.dvt-kv { display: flex; flex-direction: column; gap: 1px; padding: 5px 0; }
.dvt-kv-key { font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dvt-kv-val { font-size: 11.5px; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }

/* ---------- status bar + diagnostics ---------- */
.dvt-statusbar {
  flex: 0 0 auto; display: flex; align-items: center; gap: 6px;
  height: 24px; padding: 0 6px 0 8px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill);
  font-size: 10.5px; color: var(--dsw-alias-label-tertiary);
}
.dvt-status-item { display: inline-flex; align-items: center; gap: 4px; min-width: 0; white-space: nowrap; }
.dvt-status-item .dvt-clip { max-width: 132px; }
.dvt-dot { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); }
.dvt-dot-clean { background: var(--dsw-alias-state-success-primary); }
.dvt-dot-dirty { background: var(--dsw-alias-state-warn-primary); }
.dvt-dot-conflict { background: var(--dsw-alias-state-error-primary); }
.dvt-dot-none { background: var(--dsw-alias-label-tertiary); opacity: .5; }
.dvt-status-spacer { flex: 1 1 auto; }
.dvt-statusbtn {
  display: inline-flex; align-items: center; gap: 3px; height: 18px; padding: 0 5px;
  border: 0; border-radius: 4px; background: transparent;
  color: var(--dsw-alias-label-tertiary); font-size: 10.5px; cursor: pointer; white-space: nowrap;
}
.dvt-statusbtn:hover { background: var(--dsw-alias-interactive-hover); color: var(--dsw-alias-label-primary); }
.dvt-statusbtn[aria-expanded="true"] { background: var(--dsw-alias-interactive-selected); color: var(--dsw-alias-label-primary); }
.dvt-diag { flex: 0 0 auto; max-height: 40%; overflow-y: auto; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); padding: 5px 8px 6px; }
.dvt-diag-title { font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); margin-bottom: 3px; }
.dvt-diag-grid { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 2px 10px; }
.dvt-diag-key { font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dvt-diag-val { font-size: 10.5px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dvt-diag-warn { color: var(--dsw-alias-state-warn-primary); }

/* ---------- popover menu ---------- */
.dvt-menu-overlay { position: absolute; inset: 0; z-index: 15; }
.dvt-menu {
  position: absolute; top: 32px; right: 6px; z-index: 16;
  width: 232px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px;
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 6px 20px var(--dsw-alias-bg-mask-drop);
}
.dvt-menu-group { padding: 4px 6px 2px; font-size: 9.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
.dvt-menu-item {
  display: flex; align-items: center; gap: 7px; width: 100%;
  padding: 5px 6px; border: 0; border-radius: 5px; background: transparent;
  text-align: left; cursor: pointer; color: var(--dsw-alias-label-primary);
}
.dvt-menu-item:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-menu-item:disabled { cursor: not-allowed; opacity: .5; }
.dvt-menu-icon { flex: 0 0 auto; display: inline-flex; color: var(--dsw-alias-label-tertiary); }
.dvt-menu-labels { display: flex; flex-direction: column; gap: 0; min-width: 0; }
.dvt-menu-label { font-size: 11.5px; font-weight: 500; }
.dvt-menu-hint { font-size: 10px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-menu-sep { height: 1px; margin: 3px 4px; background: var(--dsw-alias-border-l1); }

/* ---------- dialog ---------- */
.dvt-overlay {
  position: absolute; inset: 0; z-index: 20;
  display: flex; align-items: flex-start; justify-content: center;
  padding: 14px 10px; background: var(--dsw-alias-bg-mask-drop); overflow-y: auto;
}
.dvt-dialog {
  display: flex; flex-direction: column; width: 100%; max-width: 400px; max-height: 100%;
  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 10px 30px var(--dsw-alias-bg-mask-drop);
  overflow: hidden;
}
.dvt-dialog-head { display: flex; align-items: center; gap: 6px; padding: 7px 6px 7px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dvt-dialog-title { flex: 1 1 auto; min-width: 0; font-size: 12px; font-weight: 600; }
.dvt-dialog-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.dvt-dialog-section { padding: 7px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dvt-dialog-section:last-child { border-bottom: 0; }
.dvt-dialog-label { font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); margin-bottom: 3px; }
.dvt-dialog-summary { font-size: 11.5px; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.dvt-argv { margin: 0; padding: 5px 6px; max-height: 88px; overflow: auto; border-radius: 4px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.dvt-warnings { margin: 0; padding-left: 14px; color: var(--dsw-alias-state-warn-primary); font-size: 10.5px; overflow-wrap: anywhere; }
.dvt-dialog-foot { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); }
.dvt-dialog-foot .dvt-grow { flex: 1 1 auto; }
.dvt-dialog-note { flex: 1 1 auto; font-size: 10px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.dvt-result { display: flex; flex-direction: column; gap: 4px; }
.dvt-progress { display: flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dvt-spinner {
  width: 11px; height: 11px; border-radius: 50%;
  border: 1.5px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-brand-primary);
  animation: dvt-spin .8s linear infinite;
}
@keyframes dvt-spin { to { transform: rotate(360deg); } }
.dvt-kbd { padding: 0 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 3px; font-size: 9.5px; color: var(--dsw-alias-label-tertiary); }

/* Narrow sidebars: drop optional chrome before anything can overflow. */
@media (max-width: 380px) {
  .dvt-branch { display: none; }
  .dvt-repo-vcs { display: none; }
  .dvt-statusbar > .dvt-status-item.dvt-faint { display: none; }
}
@media (max-width: 360px) {
  .dvt-commit-bottom .dvt-tag { display: none; }
  .dvt-statusbar .dvt-status-item .dvt-clip { max-width: 92px; }
}
@media (max-width: 330px) {
  .dvt-diff-gutter { width: 54px; }
  .dvt-diff-old, .dvt-diff-new { width: 22px; }
}
`
