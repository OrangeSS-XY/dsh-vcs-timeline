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

/* ---------- change timeline (vertical rail, day groups) ---------- */
.dvt-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.dvt-timeline-col { gap: 0; }
.dvt-tl { display: flex; flex-direction: column; }
.dvt-tl-group { display: flex; flex-direction: column; }
.dvt-tl-day {
  position: sticky; top: 0; z-index: 3;
  display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
  font-size: 10px; color: var(--dsw-alias-label-tertiary);
}
.dvt-tl-day-label { font-weight: 600; letter-spacing: .02em; color: var(--dsw-alias-label-secondary); }
.dvt-tl-day-count { font-size: 9.5px; }
.dvt-tl-head {
  height: 15px; padding: 0 4px; font-size: 8.5px; letter-spacing: .04em;
  border: 1px solid var(--dsw-alias-brand-primary); background: transparent;
  color: var(--dsw-alias-brand-primary);
}
.dvt-tl-list { margin: 0; padding: 0; list-style: none; }
.dvt-tl-row { position: relative; display: flex; align-items: stretch; height: 52px; }
.dvt-tl-row:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-tl-graph { flex: 0 0 auto; display: flex; align-items: stretch; justify-content: flex-start; height: 52px; }
.dvt-tl-graph-svg { display: block; }
.dvt-tl-graph-node { transition: r 120ms ease; }
.dvt-tl-row:hover .dvt-tl-graph-node { r: 5px; }
.dvt-tl-card {
  flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0;
  padding: 0 10px 0 2px; border: 0; background: transparent; text-align: left; cursor: pointer;
  overflow: hidden;
}
.dvt-tl-card:focus-visible { outline: none; box-shadow: inset 0 0 0 1.5px var(--dsw-alias-brand-primary); }
.dvt-tl-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dvt-tl-avatar {
  flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 50%;
  font-size: 8.5px; font-weight: 700; letter-spacing: .02em; line-height: 1;
}
.dvt-tl-author {
  flex: 0 0 auto; max-width: 150px; font-size: 11.5px; font-weight: 600;
  color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dvt-tl-summary {
  flex: 1 1 auto; min-width: 0; font-size: 12px; line-height: 1.35;
  color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dvt-tl-stats { flex: 0 0 auto; display: inline-flex; gap: 5px; margin-left: auto; }
.dvt-tl-meta {
  display: flex; align-items: center; gap: 6px; min-width: 0;
  padding-left: 22px; font-size: 10px; color: var(--dsw-alias-label-tertiary);
}
.dvt-tl-when {
  flex: 0 0 auto; display: inline-flex; align-items: center; gap: 3px;
  color: var(--dsw-alias-label-secondary); white-space: nowrap;
}
.dvt-tl-hash { flex: 0 0 auto; }
.dvt-tl-branch { flex: 0 1 auto; }
.dvt-tl-files { flex: 0 0 auto; white-space: nowrap; }
.dvt-tl-go {
  flex: 0 0 auto; margin-left: auto; font-size: 14px; line-height: 1;
  color: var(--dsw-alias-label-tertiary); opacity: 0; transition: opacity 120ms ease;
}
.dvt-tl-row:hover .dvt-tl-go { opacity: 1; }
.dvt-commit-stats { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10.5px; }
.dvt-stat-add { color: var(--dsw-alias-state-success-primary); white-space: nowrap; }
.dvt-stat-del { color: var(--dsw-alias-state-error-primary); white-space: nowrap; }
.dvt-stat-files { color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
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

/* ---------- file-centered dual pane ---------- */
.dvt-split { flex: 1 1 auto; display: flex; align-items: stretch; min-height: 0; min-width: 0; container-type: inline-size; }
.dvt-tree {
  flex: 0 0 auto; width: clamp(160px, 24%, 300px); min-width: 0;
  display: flex; flex-direction: column; min-height: 0;
  border-right: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill);
}
.dvt-pane { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.dvt-list-pane { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.dvt-detail {
  flex: 0 0 auto; display: flex; flex-direction: column; min-width: 0;
  height: 42%; min-height: 150px; max-height: 62%;
  border-top: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-1);
}
.dvt-detail-head { flex: 0 0 auto; }
.dvt-detail-scroll { flex: 1 1 auto; min-height: 0; }
.dvt-detail-section { padding: 7px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dvt-detail-section:last-child { border-bottom: 0; }
.dvt-tree-head { flex: 0 0 auto; display: flex; align-items: center; gap: 4px; height: 28px; padding: 0 4px 0 8px; }
.dvt-tree-title {
  flex: 1 1 auto; min-width: 0; display: inline-flex; align-items: center; gap: 5px;
  font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary); white-space: nowrap;
}
.dvt-tree-total {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary);
  font-size: 9.5px; font-weight: 600; letter-spacing: 0; text-transform: none;
}
.dvt-tree-tools { flex: 0 0 auto; display: flex; gap: 1px; }
.dvt-tree-tools .dvt-iconbtn { width: 20px; height: 20px; }
.dvt-tree-search { position: relative; display: flex; align-items: center; flex: 0 0 auto; margin: 0 6px 4px; }
.dvt-tree-search > svg { position: absolute; left: 6px; color: var(--dsw-alias-label-tertiary); pointer-events: none; }
.dvt-tree-input {
  width: 100%; height: 22px; padding: 0 6px 0 22px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 11px;
}
.dvt-tree-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.dvt-tree-input:focus-visible { border-color: var(--dsw-alias-brand-primary); outline: none; }
.dvt-tree-chips { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; padding: 0 6px 4px; overflow: hidden; }
.dvt-tree-chip {
  display: inline-flex; align-items: center; gap: 3px; flex: 0 1 auto; min-width: 0;
  height: 19px; padding: 0 5px; border: 1px solid transparent; border-radius: 4px;
  background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; font-size: 10px;
}
.dvt-tree-chip:hover { background: var(--dsw-alias-interactive-hover); color: var(--dsw-alias-label-primary); }
.dvt-tree-chip[aria-pressed="true"] {
  background: var(--dsw-alias-bg-layer-2); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-primary); font-weight: 600;
}
.dvt-tree-chip-letter { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 9.5px; }
.dvt-tree-chip-count { font-size: 9.5px; }
.dvt-tree-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; padding: 0 4px 8px; }
.dvt-tree-all {
  display: flex; align-items: center; gap: 6px; width: 100%; height: 24px; padding: 0 6px;
  border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-primary);
  font-size: 11.5px; text-align: left; cursor: pointer;
}
.dvt-tree-all:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-tree-all-active { background: var(--dsw-alias-interactive-selected); box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary); }
.dvt-tree-all-label { flex: 1 1 auto; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-tree-all-meta { flex: 0 0 auto; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dvt-tree-list, .dvt-tree-children { margin: 0; padding: 0; list-style: none; }
.dvt-tree-item { margin: 0; padding: 0; }
.dvt-tree-row {
  display: flex; align-items: center; gap: 4px; width: 100%; height: 23px; padding: 0 4px;
  border: 0; border-radius: 3px; background: transparent;
  color: var(--dsw-alias-label-secondary); font-size: 11.5px; text-align: left; cursor: pointer;
}
.dvt-tree-row:hover { background: var(--dsw-alias-interactive-hover); color: var(--dsw-alias-label-primary); }
.dvt-tree-row:focus-visible { outline: none; box-shadow: inset 0 0 0 1.5px var(--dsw-alias-brand-primary); }
.dvt-tree-file-selected { background: var(--dsw-alias-interactive-selected); color: var(--dsw-alias-label-primary); box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary); }
.dvt-tree-caret { flex: 0 0 auto; display: inline-flex; width: 10px; color: var(--dsw-alias-label-tertiary); transition: transform 100ms ease; }
.dvt-tree-caret-open { transform: rotate(90deg); }
.dvt-tree-icon { flex: 0 0 auto; display: inline-flex; color: var(--dsw-alias-label-tertiary); }
.dvt-tree-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-tree-badge { flex: 0 0 auto; font-size: 9.5px; color: var(--dsw-alias-label-tertiary); }
.dvt-tree-changes { flex: 0 0 auto; font-size: 9.5px; color: var(--dsw-alias-label-tertiary); }
.dvt-tree .dvt-file-status { width: 15px; height: 15px; font-size: 9px; }
.dvt-tree .dvt-state { padding: 18px 10px; }
.dvt-tree .dvt-state-title { font-size: 11px; }
.dvt-tree .dvt-state-hint { font-size: 10px; }

/* Selection header above the narrowed timeline. */
.dvt-selection {
  flex: 0 0 auto; display: flex; align-items: center; gap: 6px; height: 26px;
  padding: 0 4px 0 8px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dvt-selection-path {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 10.5px; color: var(--dsw-alias-label-secondary);
}
.dvt-selection-name { color: var(--dsw-alias-label-primary); }
.dvt-selection-meta { flex: 0 0 auto; font-size: 10px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.dvt-selection-who { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; }
.dvt-selection-authors { color: var(--dsw-alias-label-tertiary); }
.dvt-selection-clear { width: 20px; height: 20px; }
.dvt-list-window { padding: 0 8px 8px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }

/* A narrow split (sidebar) drops the least important row metadata before the
   summary starts ellipsizing; an IDE keeps the summary readable and hides the
   rest. Container queries keep this tied to the pane width, not the window. */
@container (max-width: 520px) {
  .dvt-tl-branch { display: none; }
  .dvt-selection-meta { display: none; }
  .dvt-list-count { display: none; }
}

/* ---------- pull requests ---------- */
.dvt-pr-view { gap: 0; }
.dvt-pr-summary {
  flex: 0 0 auto; display: flex; align-items: center; gap: 8px; min-width: 0;
  height: 30px; padding: 0 6px 0 10px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-specific-sidebar-fill); font-size: 10.5px; color: var(--dsw-alias-label-tertiary);
}
.dvt-pr-summary-counts { flex: 0 1 auto; min-width: 0; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dvt-pr-summary-remote { flex: 1 1 auto; min-width: 0; display: inline-flex; align-items: center; gap: 6px; overflow: hidden; }
.dvt-pr-provider { flex: 0 0 auto; font-size: 9.5px; font-weight: 700; letter-spacing: .03em; color: var(--dsw-alias-label-tertiary); text-transform: uppercase; }
.dvt-pr-path { flex: 0 1 auto; min-width: 0; font-size: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-pr-authstate { flex: 0 0 auto; padding: 0 5px; height: 16px; line-height: 16px; border-radius: 3px; background: var(--dsw-alias-bg-layer-2); font-size: 9.5px; }
.dvt-pr-authstate-ok { color: var(--dsw-alias-state-success-primary); }
.dvt-pr-summary-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; }
.dvt-pr-sections { display: flex; flex-direction: column; }
.dvt-pr-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.dvt-pr-row { position: relative; display: flex; align-items: stretch; }
.dvt-pr-row:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-pr-row-selected { background: var(--dsw-alias-interactive-selected); box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary); }
.dvt-pr-card {
  flex: 1 1 auto; display: flex; flex-direction: column; gap: 3px; min-width: 0;
  padding: 8px 10px; border: 0; background: transparent; text-align: left; cursor: pointer;
}
.dvt-pr-card:focus-visible { outline: none; box-shadow: inset 0 0 0 1.5px var(--dsw-alias-brand-primary); }
.dvt-pr-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dvt-pr-number { flex: 0 0 auto; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.dvt-pr-author { flex: 0 0 auto; max-width: 140px; font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-pr-title { flex: 1 1 auto; min-width: 0; font-size: 12px; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-pr-updated { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 3px; font-size: 10px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.dvt-pr-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; padding-left: 20px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dvt-pr-branch, .dvt-pr-base { flex: 0 1 auto; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.dvt-pr-arrow { flex: 0 0 auto; opacity: .7; }
.dvt-pr-badges { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.dvt-pr-badge { display: inline-flex; align-items: center; height: 15px; padding: 0 4px; border-radius: 3px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 9px; font-weight: 600; white-space: nowrap; }
.dvt-pr-badge-ok { color: var(--dsw-alias-state-success-primary); }
.dvt-pr-badge-warn { color: var(--dsw-alias-state-warn-primary); }
.dvt-pr-badge-error { color: var(--dsw-alias-state-error-primary); }
.dvt-pr-actions { display: inline-flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; }
.dvt-pr-action {
  display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 3px;
  font-size: 9.5px; font-weight: 600; white-space: nowrap;
  background: var(--dsw-alias-interactive-selected); color: var(--dsw-alias-brand-primary);
}
.dvt-pr-action-fix-ci, .dvt-pr-action-fix-conflicts { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-2); }
.dvt-pr-action-merge { color: var(--dsw-alias-state-success-primary); }
.dvt-pr-auth { margin: 8px 10px 10px; padding: 8px 10px; border-radius: 6px; background: var(--dsw-alias-bg-layer-2); }
.dvt-pr-auth-title { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-primary); margin-bottom: 3px; }
.dvt-pr-auth-hint { font-size: 10px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.dvt-pr-empty { gap: 0; }
.dvt-pr-detail { gap: 0; }
.dvt-pr-body { font-size: 11.5px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; white-space: pre-wrap; }
.dvt-pr-link { display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; margin-left: 6px; font-size: 10px; color: var(--dsw-alias-brand-primary); text-decoration: none; white-space: nowrap; }
.dvt-pr-link:hover { text-decoration: underline; }
.dvt-pr-action-list, .dvt-pr-review-list, .dvt-pr-check-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.dvt-pr-action-item { display: flex; align-items: baseline; gap: 6px; font-size: 11px; }
.dvt-pr-action-kind { flex: 0 0 auto; font-weight: 600; color: var(--dsw-alias-brand-primary); }
.dvt-pr-action-reason { flex: 1 1 auto; min-width: 0; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.dvt-pr-review, .dvt-pr-check { display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.dvt-pr-review-state, .dvt-pr-check-state { flex: 0 0 auto; font-weight: 600; }
.dvt-pr-review-approved, .dvt-pr-check-success { color: var(--dsw-alias-state-success-primary); }
.dvt-pr-review-changes-requested, .dvt-pr-check-failure { color: var(--dsw-alias-state-error-primary); }
.dvt-pr-review-pending, .dvt-pr-check-pending { color: var(--dsw-alias-state-warn-primary); }
.dvt-pr-check-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-pr-review-author { flex: 0 0 auto; }
.dvt-pr-review-time { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); }

/* ---------- audit summary / state filter ---------- */
.dvt-audit-chips { display: flex; align-items: center; gap: 3px; padding: 5px 6px 2px; flex-wrap: wrap; }
.dvt-audit-chip {
  display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px;
  border: 1px solid transparent; border-radius: 4px; background: transparent;
  color: var(--dsw-alias-label-secondary); font-size: 10.5px; cursor: pointer;
}
.dvt-audit-chip:hover { background: var(--dsw-alias-interactive-hover); color: var(--dsw-alias-label-primary); }
.dvt-audit-chip[aria-pressed="true"] { background: var(--dsw-alias-bg-layer-2); box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); font-weight: 600; }
.dvt-audit-chip-count { font-size: 9.5px; color: var(--dsw-alias-label-tertiary); }
.dvt-audit-summary { padding: 2px 10px 4px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }

/* Time-range control inside the filter bar. */
.dvt-time {
  display: inline-flex; align-items: center; gap: 3px; flex: 0 0 auto; height: 22px;
  padding: 0 3px; border-radius: 4px; color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.dvt-time:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-time > svg { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); pointer-events: none; }
.dvt-time-select {
  appearance: none; max-width: 76px; border: 0; outline: none; background: transparent;
  color: inherit; font-size: 11px; cursor: pointer;
}

/* ---------- file view: tree | diff | activity ---------- */
.dvt-file-split { align-items: stretch; }
.dvt-file-diffpane { flex: 1 1 auto; min-width: 0; }
.dvt-file-diff-empty { padding: 18px; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dvt-fileinfo {
  flex: 0 0 auto; width: clamp(250px, 23%, 340px); min-width: 0;
  display: flex; flex-direction: column; min-height: 0; overflow-y: auto;
  border-left: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
}
.dvt-fileinfo-head {
  flex: 0 0 auto; display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 4px 0 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dvt-fileinfo-title { flex: 1 1 auto; min-width: 0; font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
.dvt-fileinfo-path { display: flex; align-items: center; gap: 6px; padding: 7px 10px 3px; min-width: 0; }
.dvt-fileinfo-name { flex: 1 1 auto; min-width: 0; font-size: 11px; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-fileinfo-dirty { flex: 0 0 auto; padding: 0 4px; height: 15px; line-height: 15px; border-radius: 3px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-state-warn-primary); font-size: 9px; font-weight: 600; }
.dvt-fileinfo-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 0 10px 7px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dvt-fileinfo-latest { color: var(--dsw-alias-label-secondary); }
.dvt-fileinfo-lines { display: inline-flex; gap: 5px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.dvt-fileinfo-section { padding: 6px 10px 4px; font-size: 9.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); border-top: 1px solid var(--dsw-alias-border-l1); }
.dvt-fileinfo-empty { padding: 4px 10px 8px; font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.dvt-author-list { margin: 0; padding: 0 8px 6px; list-style: none; display: flex; flex-direction: column; gap: 3px; }
.dvt-author-row-item { display: flex; align-items: center; gap: 6px; min-width: 0; height: 20px; }
.dvt-author-row-item .dvt-tl-avatar { width: 15px; height: 15px; font-size: 8px; }
.dvt-author-name { flex: 0 1 auto; max-width: 96px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.dvt-author-bar { flex: 1 1 auto; min-width: 24px; height: 5px; border-radius: 3px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.dvt-author-bar-fill { display: block; height: 100%; border-radius: 3px; background: var(--dsw-alias-brand-primary); opacity: .55; }
.dvt-author-count { flex: 0 0 auto; font-size: 9.5px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.dvt-fileinfo-commits { margin: 0; padding: 0 6px 4px; list-style: none; display: flex; flex-direction: column; gap: 1px; }
.dvt-fileinfo-commit-btn {
  display: flex; flex-direction: column; gap: 1px; width: 100%; padding: 4px 5px;
  border: 0; border-radius: 3px; background: transparent; text-align: left; cursor: pointer;
  color: var(--dsw-alias-label-secondary);
}
.dvt-fileinfo-commit-btn:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-fileinfo-commit-active { background: var(--dsw-alias-interactive-selected); box-shadow: inset 2px 0 0 var(--dsw-alias-brand-primary); }
.dvt-fileinfo-commit-top { display: flex; align-items: center; gap: 4px; min-width: 0; font-size: 9.5px; color: var(--dsw-alias-label-tertiary); }
.dvt-fileinfo-commit-author { flex: 0 1 auto; max-width: 90px; color: var(--dsw-alias-label-secondary); }
.dvt-fileinfo-commit-time { flex: 0 0 auto; }
.dvt-fileinfo-commit-hash { flex: 0 0 auto; margin-left: auto; }
.dvt-fileinfo-commit-bottom { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 10.5px; color: var(--dsw-alias-label-primary); }
.dvt-fileinfo-commit-stats { display: inline-flex; gap: 4px; margin-left: auto; flex: 0 0 auto; }
.dvt-fileinfo-more { padding: 0 10px 6px; font-size: 9.5px; color: var(--dsw-alias-label-tertiary); }
.dvt-fileinfo-related { padding: 0 10px 10px; }

/* ---------- local branch insight (offline PR fallback) ---------- */
.dvt-local-strip {
  flex: 0 0 auto; display: flex; align-items: center; gap: 8px; min-width: 0;
  height: 28px; padding: 0 6px 0 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1); font-size: 10px; color: var(--dsw-alias-label-tertiary);
}
.dvt-local-strip-label { flex: 0 0 auto; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dvt-local-strip .dvt-local-branches { flex: 0 1 auto; }
.dvt-local-chips { display: inline-flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; flex-wrap: wrap; }
.dvt-local-chip { display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 3px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-size: 9.5px; white-space: nowrap; }
.dvt-local-chip-muted { color: var(--dsw-alias-label-tertiary); }
.dvt-local-chip-warn { color: var(--dsw-alias-state-error-primary); }
.dvt-local-actions { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.dvt-local-refresh { margin-left: auto; }
.dvt-local-insight {
  margin: 8px 10px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1); overflow: hidden;
}
.dvt-local-insight-loading { padding: 8px 10px; font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.dvt-local-insight-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 7px 10px 4px; }
.dvt-local-title { font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dvt-local-branches { font-size: 10px; color: var(--dsw-alias-label-secondary); }
.dvt-local-hint { padding: 0 10px 6px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dvt-local-insight .dvt-local-chips { padding: 0 10px 6px; }
.dvt-local-insight .dvt-local-actions { padding: 0 10px 7px; flex-wrap: wrap; }
.dvt-local-empty { padding: 2px 10px 8px; font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.dvt-local-commits { margin: 0; padding: 0 6px 6px; list-style: none; display: flex; flex-direction: column; gap: 1px; }
.dvt-local-commit { display: flex; align-items: center; gap: 6px; min-width: 0; height: 20px; padding: 0 4px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.dvt-local-commit-summary { flex: 1 1 auto; min-width: 0; }
.dvt-local-commit-author { flex: 0 0 auto; max-width: 90px; color: var(--dsw-alias-label-tertiary); }
.dvt-local-commit-time { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); }
.dvt-local-foot { display: flex; justify-content: flex-end; padding: 0 10px 8px; }

/* ---------- add repository dialog ---------- */
.dvt-addrepo-input { width: 100%; margin-top: 3px; }
.dvt-addrepo .dvt-dialog-title { display: inline-flex; align-items: center; gap: 5px; }

/* ---------- wide-view sizing ----------
   The view fills the conversation area (a Conversation View tab), so the
   panel is wide; keep the search field and the tree a control, not a banner. */
.dvt-search { max-width: 380px; }
.dvt-filterbar { gap: 6px; }

/* Narrow sidebars: drop optional chrome before anything can overflow. */
@media (max-width: 380px) {
  .dvt-branch { display: none; }
  .dvt-repo-vcs { display: none; }
  .dvt-statusbar > .dvt-status-item.dvt-faint { display: none; }
}
@media (max-width: 360px) {
  .dvt-tl-branch { display: none; }
  .dvt-statusbar .dvt-status-item .dvt-clip { max-width: 92px; }
}
@media (max-width: 330px) {
  .dvt-diff-gutter { width: 54px; }
  .dvt-diff-old, .dvt-diff-new { width: 22px; }
}

/* ---------- v1.1: pending workbench ---------- */
.dvt-wb-split { align-items: stretch; }
.dvt-wb-list {
  flex: 0 0 auto; width: clamp(190px, 22%, 280px); min-width: 0;
  display: flex; flex-direction: column; min-height: 0;
  border-right: 1px solid var(--dsw-alias-border-l1);
}
.dvt-wb-group { padding: 0 0 2px; }
.dvt-wb-group-title {
  position: sticky; top: 0; z-index: 1;
  display: flex; align-items: center; gap: 6px; height: 22px; padding: 0 8px;
  background: var(--dsw-specific-sidebar-fill);
  font-size: 9.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.dvt-wb-group-count { margin-left: auto; font-weight: 500; }
.dvt-wb-items { margin: 0; padding: 0; list-style: none; }
.dvt-wb-item { min-width: 0; }
.dvt-wb-row {
  display: flex; align-items: center; gap: 6px; width: 100%;
  height: 22px; padding: 0 8px; border: 0; background: transparent;
  color: var(--dsw-alias-label-primary); font-size: 11px; text-align: left; cursor: pointer;
}
.dvt-wb-row:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-wb-row-active { background: var(--dsw-alias-interactive-pressed); }
.dvt-wb-path { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-wb-name { color: var(--dsw-alias-label-primary); }
.dvt-wb-session {
  flex: 0 0 auto; padding: 0 4px; height: 14px; line-height: 14px;
  border-radius: 3px; background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary); font-size: 8.5px; font-weight: 600;
}
.dvt-wb-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.dvt-wb-diff { flex: 1 1 auto; min-height: 0; }
.dvt-wb-side {
  flex: 0 0 auto; width: clamp(230px, 24%, 320px); min-width: 0;
  display: flex; flex-direction: column; min-height: 0; overflow-y: auto;
  border-left: 1px solid var(--dsw-alias-border-l1);
}
.dvt-card { border-bottom: 1px solid var(--dsw-alias-border-l1); padding: 0 0 4px; }
.dvt-card-actions { display: inline-flex; align-items: center; gap: 3px; }
.dvt-card-hint { padding: 3px 10px 6px; font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.dvt-card-foot {
  display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
  padding: 2px 10px 6px; font-size: 10px; color: var(--dsw-alias-label-tertiary);
}
.dvt-danger { color: var(--dsw-alias-state-error-primary); }
.dvt-seg { display: inline-flex; align-items: center; border: 1px solid var(--dsw-alias-border-l1); border-radius: 4px; overflow: hidden; }
.dvt-seg-btn {
  border: 0; background: transparent; color: var(--dsw-alias-label-secondary);
  height: 20px; padding: 0 6px; font-size: 10px; cursor: pointer;
}
.dvt-seg-btn + .dvt-seg-btn { border-left: 1px solid var(--dsw-alias-border-l1); }
.dvt-seg-btn[aria-pressed="true"] { background: var(--dsw-alias-interactive-pressed); color: var(--dsw-alias-label-primary); }
.dvt-checks { margin: 0; padding: 0 8px; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.dvt-checks-compact { padding: 0; }
.dvt-check { display: flex; align-items: flex-start; gap: 5px; min-width: 0; padding: 2px 0; font-size: 10.5px; }
.dvt-check-icon { flex: 0 0 auto; display: inline-flex; padding-top: 1px; }
.dvt-check-blocking .dvt-check-icon { color: var(--dsw-alias-state-error-primary); }
.dvt-check-warning .dvt-check-icon { color: var(--dsw-alias-state-warn-primary); }
.dvt-check-info .dvt-check-icon { color: var(--dsw-alias-label-tertiary); }
.dvt-check-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0; }
.dvt-check-title { color: var(--dsw-alias-label-primary); }
.dvt-check-path { color: var(--dsw-alias-label-tertiary); font-size: 9.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dvt-check-meta { flex: 0 0 auto; display: inline-flex; gap: 5px; color: var(--dsw-alias-label-tertiary); font-size: 9.5px; }
.dvt-ack { display: flex; align-items: center; gap: 6px; margin: 3px 10px 2px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.dvt-session-list { margin: 0; padding: 0 8px; list-style: none; display: flex; flex-direction: column; gap: 1px; }
.dvt-session-row { display: flex; align-items: center; gap: 6px; min-width: 0; height: 19px; font-size: 10px; }
.dvt-session-path { flex: 1 1 auto; min-width: 0; color: var(--dsw-alias-label-secondary); }
.dvt-session-tool { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); font-size: 9px; }
.dvt-compare { padding: 2px 10px 4px; display: flex; flex-direction: column; gap: 3px; }
.dvt-compare-line { display: flex; align-items: center; gap: 5px; min-width: 0; font-size: 10.5px; }
.dvt-compare-branch { min-width: 0; }
.dvt-compare-vs { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); }
.dvt-compare-stats { display: flex; flex-wrap: wrap; gap: 7px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dvt-active-filter {
  display: flex; align-items: center; gap: 4px; height: 24px; padding: 0 8px;
  border-top: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary); font-size: 10.5px;
}

/* ---------- v1.1: hotspot table ---------- */
.dvt-hotspots { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.dvt-hotspot-head {
  display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dvt-hotspot-title-col { flex: 1 1 auto; min-width: 0; }
.dvt-hotspot-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dvt-hotspot-subtitle { margin-top: 1px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dvt-hotspot-controls { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; }
.dvt-hotspot-coverage {
  display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
  padding: 4px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1);
  font-size: 10px; color: var(--dsw-alias-label-secondary);
}
.dvt-hotspot-tablewrap { min-height: 0; }
.dvt-hotspot-cols, .dvt-hotspot-row {
  display: grid; align-items: center; gap: 6px;
  grid-template-columns: minmax(120px, 1fr) 56px 92px 52px 92px;
  padding: 0 10px;
}
.dvt-hotspot-cols {
  position: sticky; top: 0; z-index: 1; height: 24px;
  background: var(--dsw-specific-sidebar-fill);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  font-size: 9.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.dvt-hotspot-list { margin: 0; padding: 0; list-style: none; }
.dvt-hotspot-item { min-width: 0; }
.dvt-hotspot-row {
  width: 100%; height: 25px; border: 0; background: transparent; text-align: left;
  color: var(--dsw-alias-label-primary); font-size: 11px; cursor: pointer;
}
.dvt-hotspot-row:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-hotspot-path { min-width: 0; }
.dvt-hotspot-name { color: var(--dsw-alias-label-primary); }
.dvt-hotspot-num { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; text-align: right; color: var(--dsw-alias-label-secondary); }
.dvt-hotspot-churn { color: var(--dsw-alias-label-secondary); }
.dvt-hotspot-col-path, .dvt-hotspot-col-when { min-width: 0; }
.dvt-hotspot-col-when { text-align: right; }
.dvt-hotspot-when { font-size: 10px; text-align: right; color: var(--dsw-alias-label-tertiary); }
.dvt-hotspot-foot {
  padding: 5px 10px 8px; border-top: 1px solid var(--dsw-alias-border-l1);
  font-size: 10px; color: var(--dsw-alias-label-tertiary);
}

/* ---------- v1.1: interleaved audit nodes and attribution tags ---------- */
.dvt-tl-day-audit { margin-left: 6px; color: var(--dsw-alias-label-tertiary); }
.dvt-tl-audit-li { opacity: .96; }
.dvt-tl-audit-rail { display: inline-flex; align-items: center; justify-content: center; color: var(--dsw-alias-label-tertiary); }
.dvt-tl-audit-card { border-style: dashed; }
.dvt-tl-audit-icon { flex: 0 0 auto; display: inline-flex; color: var(--dsw-alias-label-tertiary); }
.dvt-branch-btn { cursor: pointer; }
.dvt-branch-btn:hover { color: var(--dsw-alias-label-primary); text-decoration: underline; text-underline-offset: 2px; }
.dvt-tag-inferred {
  border: 1px dashed var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
}
.dvt-tag-attrib {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
}

/* ---------- v1.2: pending actions, chart cards, heatmap and bars ---------- */
.dvt-wb-actions {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  padding: 4px 8px 5px; border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dvt-wb-actions-note {
  flex: 1 1 100%; min-width: 0; font-size: 9.5px; color: var(--dsw-alias-label-tertiary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dvt-card-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px 0; }
.dvt-card-title { flex: 1 1 auto; min-width: 0; font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dvt-hotspot-charts { display: flex; flex-direction: column; gap: 0; min-height: 0; }
.dvt-hotspot-chart-meta { flex: 0 0 auto; font-size: 9.5px; }
.dvt-heatmap { display: flex; gap: 4px; padding: 4px 10px 2px; overflow-x: auto; }
.dvt-heatmap-weekdays { display: grid; grid-template-rows: repeat(7, 11px); gap: 2px; flex: 0 0 auto; }
.dvt-heatmap-weekday { font-size: 8px; line-height: 11px; height: 11px; color: var(--dsw-alias-label-tertiary); }
.dvt-heatmap-grid {
  display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, 11px); gap: 2px;
  grid-auto-columns: 11px; flex: 0 0 auto;
}
.dvt-heatmap-cell {
  width: 11px; height: 11px; border-radius: 2px;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid transparent;
}
.dvt-heat-0 { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l1); }
.dvt-heat-1 { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, var(--dsw-alias-bg-base)); }
.dvt-heat-2 { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 42%, var(--dsw-alias-bg-base)); }
.dvt-heat-3 { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 62%, var(--dsw-alias-bg-base)); }
.dvt-heat-4 { background: color-mix(in srgb, var(--dsw-alias-brand-primary) 82%, var(--dsw-alias-bg-base)); }
.dvt-heatmap-legend { display: flex; align-items: center; justify-content: flex-end; gap: 3px; padding: 0 10px 6px; font-size: 9px; }
.dvt-bars { margin: 0; padding: 2px 10px 6px; list-style: none; display: flex; flex-direction: column; gap: 2px; }
.dvt-bar-item { min-width: 0; }
.dvt-bar-row {
  display: grid; grid-template-columns: minmax(80px, 42%) minmax(80px, 1fr) auto;
  align-items: center; gap: 7px; width: 100%; height: 24px; padding: 0;
  border: 0; background: transparent; text-align: left; cursor: pointer;
  color: var(--dsw-alias-label-primary); font-size: 10.5px;
}
.dvt-bar-row:hover .dvt-bar-fill { opacity: .85; }
.dvt-bar-track {
  position: relative; height: 10px; border-radius: 3px;
  background: var(--dsw-alias-bg-layer-2); overflow: hidden;
}
.dvt-bar-fill {
  display: block; height: 100%; min-width: 2px; border-radius: 3px;
  background: var(--dsw-alias-brand-primary); opacity: .62;
}
.dvt-bar-churn { background: var(--dsw-alias-state-warn-primary); }
.dvt-bar-authors { background: var(--dsw-alias-state-success-primary); }
.dvt-bar-recent { background: var(--dsw-alias-brand-primary); }
.dvt-bar-label { min-width: 0; }
.dvt-bar-name { color: var(--dsw-alias-label-primary); }
.dvt-bar-value { flex: 0 0 auto; font-size: 9.5px; color: var(--dsw-alias-label-secondary); }
`
