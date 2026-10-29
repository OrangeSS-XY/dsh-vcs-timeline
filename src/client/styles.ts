/**
 * dsh-vcs-timeline 閳?component-local stylesheet (IDE-density redesign).
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
  /* Data-visualisation accents. The host brand token is intentionally
     monochrome (near-black in light, near-white in dark), so charts and their
     hover markers own an explicit blue/purple that stays readable in both
     themes instead of resolving to a grey ramp. */
  --dvt-data-blue: hsl(217 82% 56%);
  --dvt-data-purple: hsl(262 78% 62%);
}
.dvt-root, .dvt-root * { box-sizing: border-box; min-width: 0; }
/* The reset must not out-rank component classes: an element+class selector
   would be 0,1,1 and silently override the primary button's text colour (white
   on the near-black brand button => invisible label). :where() keeps the reset
   at 0,0,1 so every class-level colour/weight wins, while UA defaults are still
   replaced for bare controls. */
:where(.dvt-root) button, :where(.dvt-root) input, :where(.dvt-root) select, :where(.dvt-root) textarea {
  font: inherit; color: inherit; margin: 0;
}
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
/* Disabled buttons keep a readable muted label; the old opacity:.5 made a
   near-black primary button show light-on-grey text and the whole control read
   as "invisible" in the pending workbench. */
.dvt-btn:disabled {
  cursor: not-allowed;
  opacity: 1;
  background: var(--dsw-alias-bg-layer-2);
  border-color: transparent;
  color: var(--dsw-alias-label-tertiary);
}
.dvt-btn.dvt-btn-primary:disabled {
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary);
}
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

/* ---------- quiet background sync (stale-while-revalidate) ----------
   The chrome owns the only visible feedback of a background revalidation: a
   3px indeterminate bar on the top edge and a spinning refresh control. The bar
   lives in a zero-height positioned slot, so it can appear and disappear
   without moving the toolbar by a single pixel, and it never swallows a click. */
.dvt-syncslot { position: relative; flex: 0 0 auto; height: 0; }
.dvt-syncbar {
  position: absolute; top: 0; left: 0; right: 0; z-index: 4;
  height: 3px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-2);
  pointer-events: none;
}
.dvt-syncbar-fill {
  display: block; width: 100%; height: 100%;
  /* One soft data-blue band inside a transparent track. The whole element is
     swept left-to-right, so the keyframes can stay a plain -100% -> 100% and
     the band still enters and leaves through both edges of the bar. */
  background-image: linear-gradient(90deg,
    transparent 0%,
    transparent 32%,
    color-mix(in srgb, var(--dvt-data-blue) 55%, transparent) 43%,
    var(--dvt-data-blue) 50%,
    color-mix(in srgb, var(--dvt-data-blue) 55%, transparent) 57%,
    transparent 68%,
    transparent 100%);
  background-repeat: no-repeat;
  /* Start mid-cycle: a 3px bar is often on screen for only a few hundred ms, and
     a fresh cycle would show an empty track for its first third. The negative
     delay makes the band visible on the very first painted frame. */
  animation: dvt-sync-slide 1.1s ease-in-out -0.35s infinite;
  will-change: transform;
}
@keyframes dvt-sync-slide {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}
/* The refresh control keeps turning while a quiet refresh runs; the control
   stays clickable because a manual refresh may still be requested. */
.dvt-syncing > svg { animation: dvt-spin .9s linear infinite; }
.dvt-iconbtn.dvt-syncing { cursor: progress; }
/* Live region: empty while idle (:empty hides the pill completely) and one
   short sentence while refreshing, so assistive tech announces the transition
   once instead of on every render. */
.dvt-sync-state {
  display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto;
  height: 18px; padding: 0 7px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px; line-height: 1; white-space: nowrap;
}
.dvt-sync-state:empty { display: none; }
.dvt-sync-state-dot {
  flex: 0 0 auto; width: 5px; height: 5px; border-radius: 50%;
  background: var(--dvt-data-blue);
  animation: dvt-sync-pulse 1.4s ease-in-out infinite;
}
.dvt-sync-state-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
@keyframes dvt-sync-pulse { 0%, 100% { opacity: .4; } 50% { opacity: 1; } }
/* Narrow sidebars keep the dot only: the spinning refresh control already says
   "busy", so the label is the first thing to go. */
@container swl (max-width: 720px) {
  .dvt-sync-state { padding: 0 5px; }
  .dvt-sync-state-text { display: none; }
}

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
/* ---------- loading skeletons: gray layout blocks + soft sheen ----------
   X/Twitter-style loading: the skeleton is the layout itself. Gray rounded
   blocks sit exactly where the real rows will appear, one soft white sheen
   sweeps each block from left to right, and when data lands the skeleton fades
   out while the real content fades in on top of it. No text, no brand, no
   spinner here. The sheen is a pseudo-element so the block itself never needs
   extra DOM or layout. */
.dvt-skeleton { display: flex; flex-direction: column; gap: 8px; padding: 10px; overflow: hidden; }
.dvt-skel-block {
  position: relative; flex: 0 0 auto; min-width: 0; max-width: 100%;
  height: 10px; border-radius: 8px; overflow: hidden;
  background: var(--dsw-alias-bg-layer-2);
}
.dvt-skel-block::after {
  content: "";
  position: absolute; inset: 0;
  background-image: linear-gradient(90deg,
    transparent 0%,
    color-mix(in srgb, white 52%, transparent) 50%,
    transparent 100%);
  transform: translateX(-100%);
  /* Negative delay: the sheen is already mid-sweep on the first painted frame,
     so a short load still shows the soft highlight instead of a flat block. */
  animation: dvt-skel-sheen 1.5s ease-in-out -0.65s infinite;
  pointer-events: none;
}
@keyframes dvt-skel-sheen {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}
/* Card list (X-style rows, no borders, no text). */
.dvt-skel-cards { gap: 0; padding: 4px 0; }
.dvt-skel-card { display: flex; align-items: flex-start; gap: 10px; min-height: 52px; padding: 10px 12px; }
.dvt-skel-avatar { margin-top: 2px; }
.dvt-skel-card-main { flex: 1 1 auto; display: flex; flex-direction: column; gap: 7px; min-width: 0; padding-top: 3px; }
.dvt-skel-card-meta { display: flex; align-items: center; gap: 6px; }
/* Timeline list (sticky day strip + graph gutter + 64px rows). */
.dvt-skel-timeline { gap: 0; padding: 4px 0; }
.dvt-skel-tl-day {
  display: flex; align-items: center; flex: 0 0 auto;
  height: 26px; padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
}
/* The real list reserves the swimlane canvas (~140px) before the row text; the
   skeleton keeps that gap so the cross-fade does not shift the summary line. */
.dvt-skel-tl-row { display: flex; align-items: center; gap: 8px; height: 64px; padding: 0 10px 0 8px; }
.dvt-skel-tl-graph { flex: 0 0 auto; display: flex; align-items: center; justify-content: flex-start; width: 140px; padding-left: 6px; }
.dvt-skel-tl-card { flex: 1 1 auto; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.dvt-skel-tl-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dvt-skel-tl-meta { display: flex; align-items: center; gap: 6px; min-width: 0; padding-left: 22px; }
.dvt-skel-tl-stats { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }
/* File tree skeleton: header, search field, indented file rows. */
.dvt-skel-tree { overflow: hidden; }
.dvt-skel-tree-head { justify-content: space-between; }
.dvt-skel-tree-tools { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; }
.dvt-skel-tree-search { flex: 0 0 auto; padding: 0 6px 4px; }
.dvt-skel-tree-search .dvt-skel-block { width: 100%; }
.dvt-skel-tree-rows { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 3px; padding: 2px 6px 8px; overflow: hidden; }
.dvt-skel-tree-row { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; height: 23px; }
/* Hotspot dashboard skeleton: title block, heat grid, bar ranking. */
.dvt-skel-hs { flex: 1 1 auto; min-height: 0; gap: 14px; padding: 18px 20px; }
.dvt-skel-hs-head { display: flex; align-items: flex-start; gap: 16px; }
.dvt-skel-hs-titles { flex: 1 1 auto; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.dvt-skel-hs-panel {
  flex: 0 0 auto; display: flex; flex-direction: column; gap: 10px;
  padding: 12px 14px; border-radius: 14px; background: var(--dsw-alias-bg-layer-1);
}
.dvt-skel-hs-heat { display: grid; grid-template-columns: repeat(18, minmax(0, 1fr)); gap: 4px; }
.dvt-skel-hs-heat .dvt-skel-block { width: 100%; }
.dvt-skel-hs-bars { display: flex; flex-direction: column; gap: 10px; }
.dvt-skel-hs-bar { display: flex; align-items: center; gap: 12px; }
.dvt-skel-hs-bar .dvt-skel-block { flex: 0 0 auto; }
/* Pending workbench skeleton: list | diff | facts, mirroring dvt-wb-split. */
.dvt-skel-wb { flex: 1 1 auto; min-height: 0; flex-direction: row; gap: 0; padding: 0; }
.dvt-skel-wb-list {
  flex: 0 0 auto; width: clamp(190px, 22%, 280px); min-width: 0;
  display: flex; flex-direction: column; gap: 6px; padding: 10px 10px 8px;
  border-right: 1px solid var(--dsw-alias-border-l1); overflow: hidden;
}
.dvt-skel-wb-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 8px; padding: 14px 14px; overflow: hidden; }
.dvt-skel-wb-side {
  flex: 0 0 auto; width: clamp(230px, 24%, 320px); min-width: 0;
  display: flex; flex-direction: column; gap: 10px; padding: 10px;
  border-left: 1px solid var(--dsw-alias-border-l1); overflow: hidden;
}
.dvt-skel-wb-row { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; height: 22px; }
.dvt-skel-wb-card {
  display: flex; flex-direction: column; gap: 7px; flex: 0 0 auto;
  padding: 10px; border-radius: 12px; background: var(--dsw-alias-bg-layer-1);
}
/* Compact rows used by local panes (detail/diff/checks/session/dialog). */
.dvt-skel-rows { gap: 0; padding: 6px 10px; }
.dvt-skel-row { display: flex; align-items: center; gap: 8px; height: 26px; }
/* Status bar while the layout skeleton is up: blocks instead of text. */
.dvt-skel-statusbar { gap: 8px; padding: 0 10px; }
.dvt-skel-statusbar .dvt-skel-block { margin: 0; }

/* ---------- skeleton cross-fade ----------
   Both layers are grid items in the same cell, so the skeleton and the real
   content always occupy the exact same box: no layout jump when one replaces
   the other. The skeleton is the top layer and fades out; the content fades in
   underneath it. Durations must stay in sync with SKELETON_FADE_MS (260ms). */
.dvt-swap {
  flex: 1 1 auto; min-width: 0; min-height: 0;
  display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr);
}
.dvt-swap-layer { grid-area: 1 / 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.dvt-swap-skel { z-index: 2; overflow: hidden; pointer-events: none; }
.dvt-swap-content { z-index: 1; }
.dvt-skel-out { animation: dvt-skel-out .24s ease-out both; }
.dvt-content-in { animation: dvt-content-in .28s ease-out both; }
@keyframes dvt-skel-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes dvt-content-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

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

/* ---------- v1.5: pull-request analytics dashboard ----------
   Data colours come from the explicit --dvt-data-blue / --dvt-data-purple
   palette, never the monochrome brand token: a chart bar must stay a blue bar
   in both light and dark themes. Neutral surfaces keep the theme tokens. */
.dvt-pr-dash {
  flex: 0 0 auto; display: flex; flex-direction: column; gap: 10px;
  padding: 12px 12px 10px;
}
.dvt-pr-dash-head { display: flex; align-items: flex-start; gap: 10px; }
.dvt-pr-dash-titles { flex: 1 1 auto; min-width: 0; }
.dvt-pr-dash-title {
  font-size: 15px; font-weight: 650; letter-spacing: -.012em;
  color: var(--dsw-alias-label-primary);
}
.dvt-pr-dash-hint {
  margin-top: 2px; font-size: 10.5px;
  color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere;
}
.dvt-pr-dash-tiles {
  display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px;
}
.dvt-root .dvt-pr-dash-tile {
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
  min-width: 0; padding: 9px 11px 8px;
  border: 0; border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary); text-align: left; cursor: pointer;
  transition: background .15s ease, box-shadow .15s ease;
}
.dvt-root .dvt-pr-dash-tile:hover {
  background: var(--dsw-alias-interactive-hover);
  box-shadow: inset 3px 0 0 var(--dvt-data-blue);
}
.dvt-root .dvt-pr-dash-tile[aria-pressed="true"] {
  background: var(--dsw-alias-interactive-selected);
  box-shadow: inset 3px 0 0 var(--dvt-data-blue);
}
.dvt-root .dvt-pr-dash-tile:focus-visible {
  outline: 1.5px solid var(--dvt-data-blue);
  outline-offset: -2px;
}
.dvt-pr-dash-tile-label {
  max-width: 100%; font-size: 10px; font-weight: 600; letter-spacing: .01em;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dvt-pr-dash-tile-value {
  font-size: 20px; font-weight: 650; line-height: 1.05;
  color: var(--dsw-alias-label-primary);
  font-variant-numeric: tabular-nums;
}
.dvt-pr-dash-tile-value-muted {
  font-size: 12px; font-weight: 600;
  color: var(--dsw-alias-label-tertiary);
}
.dvt-pr-dash-grid {
  display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 8px; align-items: stretch;
}
.dvt-pr-dash-card {
  display: flex; flex-direction: column; gap: 7px; min-width: 0;
  padding: 11px 13px 13px; border: 0; border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
  transition: box-shadow .15s ease;
}
.dvt-pr-dash-card:hover { box-shadow: inset 3px 0 0 var(--dvt-data-blue); }
.dvt-pr-dash-card-title {
  font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.dvt-pr-dash-card-hint {
  margin: 0; font-size: 10px;
  color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere;
}
.dvt-pr-dash-empty {
  margin: 0; padding: 6px 0; font-size: 10.5px;
  color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere;
}
.dvt-pr-dash-author-list {
  display: flex; flex-direction: column; gap: 2px;
  margin: 0; padding: 0; list-style: none;
}
.dvt-pr-dash-author {
  display: grid; grid-template-columns: 26px minmax(96px, 1fr) auto minmax(64px, 132px);
  align-items: center; gap: 8px; min-width: 0;
  min-height: 30px; padding: 2px 4px; border-radius: 8px;
  transition: background .15s ease, box-shadow .15s ease;
}
.dvt-pr-dash-author:hover {
  background: var(--dsw-alias-interactive-hover);
  box-shadow: inset 3px 0 0 var(--dvt-data-purple);
}
.dvt-pr-dash-avatar {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 50%;
  background: hsl(var(--dvt-pr-hue, 220) 46% 30%);
  color: hsl(0 0% 100%);
  font-size: 9.5px; font-weight: 700; letter-spacing: .02em;
}
.dvt-pr-dash-author-main { display: flex; flex-direction: column; gap: 0; min-width: 0; }
.dvt-pr-dash-author-name { font-size: 11.5px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dvt-pr-dash-author-meta { font-size: 9.5px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.dvt-pr-dash-lines {
  display: inline-flex; gap: 5px; justify-self: end;
  font-size: 10px; white-space: nowrap;
}
.dvt-pr-dash-lines-muted { font-size: 9.5px; color: var(--dsw-alias-label-tertiary); }
.dvt-pr-dash-bar {
  position: relative; display: block; width: 100%; height: 6px;
  border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden;
}
.dvt-pr-dash-bar-fill {
  display: block; height: 100%; border-radius: 999px;
  background: var(--dvt-data-purple); transition: width .3s ease;
}
.dvt-pr-dash-chart {
  display: grid; grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 5px; align-items: end; min-height: 84px;
}
.dvt-pr-dash-week {
  display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
  gap: 3px; min-width: 0;
}
.dvt-pr-dash-week-value {
  font-size: 9.5px; font-weight: 600; color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.dvt-pr-dash-week-track {
  display: flex; align-items: flex-end; width: 100%; height: 58px;
  border-radius: 6px; background: var(--dsw-alias-bg-layer-2); overflow: hidden;
}
.dvt-pr-dash-week-fill {
  display: block; width: 100%; border-radius: 6px 6px 0 0;
  background: var(--dvt-data-blue); transition: height .3s ease;
}
.dvt-pr-dash-week-out .dvt-pr-dash-week-track {
  background: transparent; box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l1);
}
/* A merged week outside the requested history window was not measured by the
   provider read; keep its bar visible but visibly uncertain. */
.dvt-pr-dash-week-out .dvt-pr-dash-week-fill { opacity: .45; }
.dvt-pr-dash-week-out .dvt-pr-dash-week-value { color: var(--dsw-alias-label-tertiary); }
.dvt-pr-dash-week-label { font-size: 8.5px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.dvt-pr-dash-notes { display: flex; flex-direction: column; gap: 3px; }
.dvt-pr-dash-note {
  margin: 0; font-size: 10px;
  color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere;
}
.dvt-pr-dash-note::before { content: "· "; color: var(--dvt-data-blue); }
.dvt-pr-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
.dvt-root .dvt-pr-chip {
  display: inline-flex; align-items: center; height: 22px; padding: 0 10px;
  border: 1px solid transparent; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.dvt-root .dvt-pr-chip:hover { color: var(--dsw-alias-label-primary); }
.dvt-root .dvt-pr-chip[aria-pressed="true"] {
  background: var(--dsw-alias-interactive-selected);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l1);
}
.dvt-pr-filtered-empty { gap: 0; }
.dvt-pr-filtered-empty .dvt-state { padding: 18px 12px; }

@container swl (max-width: 760px) {
  .dvt-pr-dash { padding: 10px 10px 8px; gap: 8px; }
  .dvt-pr-dash-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dvt-pr-dash-grid { grid-template-columns: minmax(0, 1fr); }
  .dvt-pr-dash-author { grid-template-columns: 24px minmax(0, 1fr) auto; row-gap: 3px; }
  .dvt-pr-dash-author .dvt-pr-dash-avatar { grid-row: 1 / 3; width: 24px; height: 24px; }
  .dvt-pr-dash-author .dvt-pr-dash-author-main { grid-column: 2; grid-row: 1; }
  .dvt-pr-dash-author .dvt-pr-dash-lines { grid-column: 3; grid-row: 1; }
  .dvt-pr-dash-author .dvt-pr-dash-bar { grid-column: 2 / 4; grid-row: 2; }
}

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

/* ---------- v1.3: multi-dimensional hotspot dashboard ---------- */
.dvt-hs {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
  /* Normal block flow: the page surface scrolls, so no flex child can shrink
     and paint over the footer. Spacing comes from margins, not gap. */
  display: block;
  padding: 20px 24px 28px;
  /* Shared purple for the author bars and the push heatmap. */
  --dvt-hs-purple: var(--dvt-data-purple);
}
.dvt-hs > * { margin: 0; }
.dvt-hs > * + * { margin-top: 12px; }
.dvt-hs-head { display: flex; align-items: flex-start; gap: 12px; }
.dvt-hs-title-col { flex: 1 1 auto; min-width: 0; }
.dvt-hs-title { font-size: 18px; font-weight: 650; letter-spacing: -.012em; color: var(--dsw-alias-label-primary); }
.dvt-hs-subtitle { margin-top: 3px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.dvt-hs-coverage {
  display: flex; align-items: center; gap: 5px; margin-top: 6px;
  font-size: 10px; color: var(--dsw-alias-label-secondary);
}
.dvt-hs-head-actions { flex: 0 0 auto; display: inline-flex; gap: 4px; }
.dvt-hs-seg {
  display: inline-flex; align-items: center; gap: 4px; align-self: flex-start;
  padding: 4px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
}
/* The .dvt-root button reset sets color on every button (0,1,1); prefixing the
   segmented controls with .dvt-root keeps inactive options muted at 0,2,0. */
.dvt-root .dvt-hs-seg-btn {
  display: inline-flex; align-items: center; gap: 7px;
  height: 32px; padding: 0 16px; border: 0; border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 12px; font-weight: 550; white-space: nowrap; cursor: pointer;
  transition: color .15s ease, background .15s ease, box-shadow .15s ease;
}
.dvt-root .dvt-hs-seg-btn:hover { color: var(--dsw-alias-label-primary); }
.dvt-root .dvt-hs-seg-btn[aria-selected="true"] {
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-weight: 650;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent),
    0 6px 16px -10px color-mix(in srgb, var(--dsw-alias-label-primary) 30%, transparent);
}
.dvt-hs-seg-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
  color: var(--dsw-alias-label-tertiary); font-size: 9.5px; font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.dvt-hs-seg-btn[aria-selected="true"] .dvt-hs-seg-count {
  background: color-mix(in srgb, var(--dvt-data-blue) 12%, transparent);
  color: color-mix(in srgb, var(--dvt-data-blue) 78%, var(--dsw-alias-label-primary));
}
.dvt-hs-body { min-height: 0; }
.dvt-hs-hint { margin: 0 0 8px; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.dvt-hs-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.dvt-hs-row {
  display: grid; align-items: center; gap: 16px; width: 100%;
  min-height: 52px; padding: 8px 14px; border: 0; border-radius: 14px;
  background: transparent; text-align: left; color: var(--dsw-alias-label-primary);
  font-size: 12px; cursor: pointer;
  transition: background .15s ease, box-shadow .15s ease;
}
.dvt-hs-row:hover {
  background: var(--dsw-alias-interactive-hover);
  box-shadow: inset 3px 0 0 var(--dvt-data-blue);
}
.dvt-hs-row:focus-visible {
  outline: 1.5px solid var(--dvt-data-blue);
  outline-offset: -2px;
  background: var(--dsw-alias-interactive-hover);
  box-shadow: inset 3px 0 0 var(--dvt-data-blue);
}
.dvt-hs-row-file { grid-template-columns: minmax(200px, 380px) minmax(140px, 1fr) 84px; }
.dvt-hs-row-author {
  grid-template-columns: 34px minmax(180px, 340px) minmax(140px, 1fr) 84px;
  cursor: default;
}
.dvt-hs-path { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dvt-hs-pathline { display: flex; align-items: baseline; min-width: 0; overflow: hidden; white-space: nowrap; }
.dvt-hs-dir {
  flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  color: var(--dsw-alias-label-tertiary); font-size: 11px;
}
.dvt-hs-name {
  flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  color: var(--dsw-alias-label-primary); font-size: 12.5px; font-weight: 600;
}
.dvt-hs-sub { font-size: 10px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dvt-hs-meter { min-width: 0; display: flex; align-items: center; }
.dvt-hs-track {
  position: relative; width: 100%; height: 6px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2); overflow: hidden;
}
.dvt-hs-fill { display: block; height: 100%; border-radius: 999px; min-width: 2px; transition: width .35s ease; }
.dvt-hs-fill-blue { background: var(--dvt-data-blue); }
.dvt-hs-fill-purple { background: var(--dvt-data-purple); }
.dvt-hs-value {
  justify-self: end; font-size: 12px; font-weight: 600; text-align: right;
  color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; white-space: nowrap;
}
.dvt-hs-value-muted { color: var(--dsw-alias-label-tertiary); font-weight: 500; }
.dvt-hs-person { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dvt-hs-personline { display: flex; align-items: center; gap: 7px; min-width: 0; }
.dvt-hs-personline .dvt-hs-name {
  /* Name + role read as one sentence: the role pill follows the name instead
     of floating at the far edge of the column. */
  flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dvt-hs-role {
  flex: 0 0 auto; height: 18px; padding: 0 8px; border-radius: 999px;
  background: color-mix(in srgb, var(--dvt-data-blue) 10%, transparent);
  color: color-mix(in srgb, var(--dvt-data-blue) 76%, var(--dsw-alias-label-primary));
  font-size: 9.5px; font-weight: 650; line-height: 18px; white-space: nowrap;
}
.dvt-hs-avatar {
  flex: 0 0 auto; width: 34px; height: 34px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  /* 30% lightness keeps white 11px initials at AA on every hue. */
  background: hsl(var(--dvt-hs-hue, 220) 48% 30%);
  color: hsl(0 0% 100%);
  font-size: 11px; font-weight: 700; letter-spacing: .02em;
}
.dvt-hs-avatar-sm { width: 30px; height: 30px; font-size: 10px; }
.dvt-hs-feed { list-style: none; margin: 0; padding: 0 0 4px; display: flex; flex-direction: column; }
.dvt-hs-event {
  position: relative; display: grid; grid-template-columns: 30px minmax(0, 1fr);
  gap: 14px; padding: 10px 14px 12px 8px; border-radius: 14px;
  transition: background .15s ease, box-shadow .15s ease;
}
.dvt-hs-event:hover {
  background: var(--dsw-alias-interactive-hover);
  box-shadow: inset 3px 0 0 var(--dvt-data-blue);
}
.dvt-hs-rail {
  position: absolute; left: 22px; top: 46px; bottom: -2px; width: 2px;
  border-radius: 2px; background: var(--dsw-alias-border-l1);
}
.dvt-hs-event:last-child .dvt-hs-rail { display: none; }
.dvt-hs-event-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.dvt-hs-action {
  display: flex; align-items: baseline; gap: 6px; min-width: 0;
  font-size: 12px; color: var(--dsw-alias-label-secondary); flex-wrap: wrap;
}
.dvt-hs-action strong { font-weight: 650; color: var(--dsw-alias-label-primary); }
.dvt-hs-when { margin-left: auto; font-size: 10.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dvt-hs-subject {
  font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dvt-hs-files { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; padding-top: 1px; }
.dvt-hs-file {
  max-width: 100%; padding: 1px 7px; border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary);
  font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dvt-hs-filemore { font-size: 10px; color: var(--dsw-alias-label-secondary); }
.dvt-hs-eventmeta {
  display: flex; align-items: center; gap: 8px; min-width: 0;
  font-size: 10px; color: var(--dsw-alias-label-secondary);
}
.dvt-hs-hash { color: var(--dsw-alias-label-secondary); }
.dvt-hs-lines { color: var(--dsw-alias-label-secondary); }
.dvt-hs-merge {
  padding: 0 6px; height: 16px; line-height: 16px; border-radius: 999px;
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);
  color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 78%, var(--dsw-alias-label-primary));
  font-size: 9.5px; font-weight: 650;
}
.dvt-hs-foot { padding-top: 6px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.dvt-hs .dvt-state { padding: 28px 12px; }

/* ---------- v1.4: calendar heatmap (daily churn / audited pushes) ---------- */
.dvt-hs-cal-controls {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
}
.dvt-hs-metric {
  display: inline-flex; align-items: center; gap: 2px; padding: 3px;
  border-radius: 999px; background: var(--dsw-alias-bg-layer-1);
}
.dvt-root .dvt-hs-metric-btn {
  height: 26px; padding: 0 12px; border: 0; border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 11.5px; font-weight: 550; white-space: nowrap; cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.dvt-root .dvt-hs-metric-btn:hover { color: var(--dsw-alias-label-primary); }
.dvt-root .dvt-hs-metric-btn[aria-pressed="true"] {
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-weight: 650;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent);
}
/* Cell size is a variable so the whole 26-week grid can shrink to fit the
   narrow sidebar instead of being scrolled sideways (the columns are the same
   calendar either way, only their size changes). */
.dvt-hs-cal {
  --dvt-hs-cell: 21px;
  --dvt-hs-cell-gap: 3px;
  display: flex; gap: 8px; align-items: flex-start; min-width: 0;
}
.dvt-hs-cal-weekdays {
  display: grid; grid-template-rows: repeat(7, var(--dvt-hs-cell));
  gap: var(--dvt-hs-cell-gap);
  padding-top: calc(var(--dvt-hs-cell) + 1px); flex: 0 0 auto;
}
.dvt-hs-cal-weekday {
  font-size: 9px; line-height: var(--dvt-hs-cell); color: var(--dsw-alias-label-secondary);
  text-align: right; padding-right: 2px; white-space: nowrap;
}
.dvt-hs-cal-scroll { min-width: 0; overflow-x: auto; padding-bottom: 2px; }
.dvt-hs-cal-months {
  display: grid;
  grid-template-columns: repeat(26, var(--dvt-hs-cell));
  column-gap: var(--dvt-hs-cell-gap);
  height: calc(var(--dvt-hs-cell) - 1px); margin-bottom: 2px;
}
.dvt-hs-cal-month {
  font-size: 9.5px; line-height: calc(var(--dvt-hs-cell) - 1px);
  color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden;
}
.dvt-hs-cal-grid {
  display: grid; grid-auto-flow: column;
  grid-template-rows: repeat(7, var(--dvt-hs-cell));
  grid-auto-columns: var(--dvt-hs-cell);
  gap: var(--dvt-hs-cell-gap);
}
.dvt-hs-cal-cell {
  display: block; width: var(--dvt-hs-cell); height: var(--dvt-hs-cell);
  border-radius: 4px;
  background: var(--dsw-alias-bg-layer-1);
  transition: transform .12s ease, box-shadow .12s ease;
}
.dvt-hs-cal-cell:hover {
  transform: scale(1.12);
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-base),
    0 3px 8px -2px color-mix(in srgb, var(--dsw-alias-label-primary) 35%, transparent);
}
/* A day before the scanned window was never measured: leave the cell blank so
   it stays clearly distinct from an in-window day with zero activity. The
   compound selector must out-rank the level-0 heat rule below. */
.dvt-hs-cal-cell.dvt-hs-cal-out {
  background: transparent;
  box-shadow: none;
}
.dvt-hs-cal-future { opacity: .35; }
.dvt-hs-heat-churn-0,
.dvt-hs-heat-pushes-0 { background: var(--dsw-alias-bg-layer-1); }
.dvt-hs-heat-churn-1 { background: color-mix(in srgb, var(--dvt-data-blue) 16%, transparent); }
.dvt-hs-heat-churn-2 { background: color-mix(in srgb, var(--dvt-data-blue) 32%, transparent); }
.dvt-hs-heat-churn-3 { background: color-mix(in srgb, var(--dvt-data-blue) 55%, transparent); }
.dvt-hs-heat-churn-4 { background: color-mix(in srgb, var(--dvt-data-blue) 80%, transparent); }
.dvt-hs-heat-pushes-1 { background: color-mix(in srgb, var(--dvt-hs-purple) 16%, transparent); }
.dvt-hs-heat-pushes-2 { background: color-mix(in srgb, var(--dvt-hs-purple) 34%, transparent); }
.dvt-hs-heat-pushes-3 { background: color-mix(in srgb, var(--dvt-hs-purple) 56%, transparent); }
.dvt-hs-heat-pushes-4 { background: color-mix(in srgb, var(--dvt-hs-purple) 82%, transparent); }
.dvt-hs-cal-legend {
  display: flex; align-items: center; gap: 4px;
  font-size: 9.5px; color: var(--dsw-alias-label-secondary);
}
.dvt-hs-cal-legend-label { margin-right: 2px; }
.dvt-hs-cal-swatch { width: 14px; height: 14px; border-radius: 3px; display: block; }
.dvt-hs-cal-layout {
  display: grid; grid-template-columns: max-content 296px;
  gap: 40px; align-items: start; min-width: 0;
}
.dvt-hs-cal-side { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.dvt-hs-cal-card {
  display: flex; flex-direction: column; gap: 2px;
  padding: 14px 16px; border-radius: 14px;
  background: var(--dsw-alias-bg-layer-1);
}
.dvt-hs-cal-card-title {
  margin-bottom: 6px; font-size: 10px; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase;
  color: var(--dsw-alias-label-secondary);
}
.dvt-hs-cal-stat {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  padding: 3px 0; border-bottom: 1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 50%, transparent);
}
.dvt-hs-cal-stat:last-child { border-bottom: 0; }
.dvt-hs-cal-stat-label { font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.dvt-hs-cal-stat-value {
  min-width: 0; font-size: 11.5px; font-weight: 600;
  color: var(--dsw-alias-label-primary); text-align: right;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dvt-hs-cal-files { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.dvt-hs-cal-file { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.dvt-hs-cal-file-name { flex: 1 1 auto; min-width: 0; font-size: 10.5px; color: var(--dsw-alias-label-primary); }
.dvt-hs-cal-file-value { flex: 0 0 auto; font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.dvt-hs-cal-summary { margin-top: -4px; }
.dvt-hs-cal-note { margin-top: 2px; }

@container swl (max-width: 1080px) {
  .dvt-hs-cal-layout { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .dvt-hs-cal-side { flex-direction: row; flex-wrap: wrap; }
  .dvt-hs-cal-card { flex: 1 1 240px; }
}
@container swl (max-width: 760px) {
  .dvt-hs { padding: 14px 12px 20px; gap: 10px; }
  .dvt-hs-title { font-size: 16px; }
  .dvt-hs-seg { width: 100%; }
  /* Equal columns with min-width:0 keep the four labels from overlapping their
     counts in the narrow sidebar; counts are dropped below 520px. */
  .dvt-hs-seg-btn {
    flex: 1 1 0; min-width: 0; overflow: hidden;
    gap: 4px; padding: 0 6px; font-size: 11px;
    justify-content: center;
  }
  .dvt-hs-seg-count { flex: 0 0 auto; min-width: 16px; }
  .dvt-hs-row { gap: 10px; padding: 8px 10px; }
  .dvt-hs-row-file { grid-template-columns: minmax(0, 1fr) 72px; row-gap: 6px; }
  .dvt-hs-row-file .dvt-hs-meter { grid-column: 1; grid-row: 2; }
  .dvt-hs-row-file .dvt-hs-value { grid-column: 2; grid-row: 1 / 3; }
  .dvt-hs-row-author { grid-template-columns: 30px minmax(0, 1fr) 66px; row-gap: 6px; }
  .dvt-hs-row-author .dvt-hs-avatar { grid-row: 1 / 3; }
  .dvt-hs-row-author .dvt-hs-person { grid-column: 2; grid-row: 1; }
  .dvt-hs-row-author .dvt-hs-meter { grid-column: 2; grid-row: 2; }
  .dvt-hs-row-author .dvt-hs-value { grid-column: 3; grid-row: 1 / 3; }
  .dvt-hs-when { margin-left: 0; }
  .dvt-hs-cal-layout { grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .dvt-hs-cal-side { flex-direction: row; flex-wrap: wrap; }
  .dvt-hs-cal-card { flex: 1 1 220px; }
  .dvt-hs-cal-legend { margin-left: 0; }
  .dvt-hs-cal-summary { white-space: normal; }
  .dvt-hs-cal { --dvt-hs-cell: 15px; --dvt-hs-cell-gap: 2px; }
}
@container swl (max-width: 520px) {
  .dvt-hs-seg-btn { padding: 0 4px; font-size: 10.5px; gap: 3px; }
  .dvt-hs-seg-count { display: none; }
  .dvt-hs-cal-controls { gap: 8px; }
  .dvt-hs-cal { --dvt-hs-cell: 11px; --dvt-hs-cell-gap: 1px; }
  .dvt-hs-cal-weekday { font-size: 8px; }
  .dvt-hs-cal-month { font-size: 8.5px; }
}

/* ---------- reduced motion: loading feedback stops moving ----------
   Every loading animation this panel adds (indeterminate bar, spinning refresh,
   live-region dot, skeleton sheen, skeleton/content cross-fade) opts out when
   the user asked for reduced motion. The progress bar then becomes a static 40%
   bar and the skeleton/content swap is a direct switch: nothing changes state,
   only movement and opacity animation are removed. */
@media (prefers-reduced-motion: reduce) {
  .dvt-syncbar-fill {
    animation: none !important;
    transform: none;
    width: 40%;
    background-image: none;
    background-color: var(--dvt-data-blue);
  }
  .dvt-syncing > svg { animation: none !important; }
  .dvt-sync-state-dot { animation: none !important; opacity: 1; }
  .dvt-skel-block::after { animation: none !important; opacity: 0; }
  .dvt-skel-out { animation: none !important; opacity: 0; }
  .dvt-content-in { animation: none !important; opacity: 1; transform: none; }
}
`
