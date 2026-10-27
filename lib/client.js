window.__ModuleLoader__.load({
  id: "dsh-vcs-timeline",
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;
    (function (module, exports, require) {
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply
});
module.exports = __toCommonJS(index_exports);
var React3 = __toESM(require("react"), 1);

// src/shared/contracts.ts
var SCHEMA_VERSION = 1;
var DEFAULT_PAGE_SIZE = 30;
var DEFAULT_DIFF_MAX_BYTES = 256 * 1024;
var HARD_DIFF_MAX_BYTES = 2 * 1024 * 1024;
function isApiError(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return typeof record.code === "string" && typeof record.message === "string";
}
function isRepository(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return record.schemaVersion === SCHEMA_VERSION && typeof record.id === "string" && (record.vcsType === "git" || record.vcsType === "svn") && typeof record.rootPath === "string" && typeof record.displayName === "string";
}
function isChangeSet(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return record.schemaVersion === SCHEMA_VERSION && typeof record.id === "string" && typeof record.revision === "string" && Array.isArray(record.files);
}
function isTimelinePage(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return Array.isArray(record.events) && (record.nextCursor === null || typeof record.nextCursor === "string");
}
function isDiffResult(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return typeof record.text === "string" && typeof record.truncated === "boolean" && typeof record.binary === "boolean";
}
function isWorkingTreeStatus(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return typeof record.clean === "boolean" && Array.isArray(record.entries) && Array.isArray(record.conflicts);
}
function isOperationAttempt(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return record.schemaVersion === SCHEMA_VERSION && typeof record.id === "string" && typeof record.operation === "string" && typeof record.state === "string" && typeof record.correlationId === "string";
}
function isOperationPage(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return Array.isArray(record.operations) && (record.nextCursor === null || typeof record.nextCursor === "string");
}
function isDiagnostics(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return typeof record.pluginVersion === "string" && typeof record.dataDir === "string" && Array.isArray(record.warnings);
}

// src/client/api.ts
var KNOWN_CODES = /* @__PURE__ */ new Set([
  "invalid-request",
  "unknown-repository",
  "path-not-allowed",
  "vcs-not-installed",
  "not-a-repository",
  "timeout",
  "output-too-large",
  "conflict",
  "operation-failed",
  "operation-blocked",
  "confirmation-required",
  "confirmation-invalid",
  "storage-failure",
  "network-unknown",
  "internal"
]);
function invalidResponse() {
  return { code: "internal", message: "invalid-response" };
}
function hostUnavailable() {
  return { code: "network-unknown", message: "host-unavailable", retryable: true };
}
function normalizeApiError(value) {
  if (isApiError(value) && KNOWN_CODES.has(value.code)) {
    const error = { code: value.code, message: value.message };
    if (typeof value.detail === "string" && value.detail !== "") error.detail = value.detail;
    if (typeof value.retryable === "boolean") error.retryable = value.retryable;
    return error;
  }
  return { code: "internal", message: "invalid-error-payload" };
}
function isRepositoryList(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return Array.isArray(record.repositories) && isDiagnostics(record.diagnostics);
}
function isOperationPreview(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return typeof record.allowed === "boolean" && Array.isArray(record.argv) && typeof record.confirmationToken === "string" && typeof record.summary === "string";
}
async function post(fetchImpl, path, body) {
  let response;
  try {
    response = await fetchImpl(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    return { ok: false, error: hostUnavailable() };
  }
  let envelope;
  try {
    envelope = await response.json();
  } catch {
    return { ok: false, error: invalidResponse() };
  }
  if (typeof envelope !== "object" || envelope === null) {
    return { ok: false, error: invalidResponse() };
  }
  const record = envelope;
  if (record.ok === true) {
    return { ok: true, value: record.value };
  }
  if (record.ok === false) {
    return { ok: false, error: normalizeApiError(record.error) };
  }
  return { ok: false, error: invalidResponse() };
}
async function guarded(pending, guard) {
  const result = await pending;
  if (!result.ok) return result;
  return guard(result.value) ? { ok: true, value: result.value } : { ok: false, error: invalidResponse() };
}
function createVcsApi(fetchImpl) {
  return {
    diagnostics: () => guarded(post(fetchImpl, "vcs/diagnostics", {}), isDiagnostics),
    listRepositories: (workspacePath) => guarded(
      post(fetchImpl, "vcs/repos/list", { workspacePath }),
      isRepositoryList
    ),
    repository: (repositoryId) => guarded(
      post(fetchImpl, "vcs/repository", { repositoryId }),
      isRepository
    ),
    timeline: (query) => guarded(
      post(fetchImpl, "vcs/timeline", { ...query }),
      isTimelinePage
    ),
    changeSet: (repositoryId, revision) => guarded(
      post(fetchImpl, "vcs/changeset", { repositoryId, revision }),
      isChangeSet
    ),
    diff: (query) => guarded(
      post(fetchImpl, "vcs/diff", { ...query }),
      isDiffResult
    ),
    status: (repositoryId) => guarded(
      post(fetchImpl, "vcs/status", { repositoryId }),
      isWorkingTreeStatus
    ),
    previewOperation: (request) => guarded(
      post(fetchImpl, "vcs/op/preview", { ...request }),
      isOperationPreview
    ),
    executeOperation: (request) => guarded(
      post(fetchImpl, "vcs/op/execute", { ...request }),
      isOperationAttempt
    ),
    listOperations: (query) => guarded(
      post(fetchImpl, "vcs/op/list", { ...query }),
      isOperationPage
    ),
    getOperation: (operationId) => guarded(
      post(fetchImpl, "vcs/op/get", { operationId }),
      isOperationAttempt
    )
  };
}

// src/client/panel.ts
var React2 = __toESM(require("react"), 1);

// src/client/components.ts
var React = __toESM(require("react"), 1);

// src/client/format.ts
function intlLocale(locale) {
  return typeof locale === "string" && locale.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}
function formatTime(iso, locale) {
  if (typeof iso !== "string" || iso.trim() === "") return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
function shortHash(value, length = 7) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed === "" || !Number.isFinite(length) || length <= 0) return "";
  return trimmed.length <= length ? trimmed : trimmed.slice(0, length);
}
function formatBytes(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const unit = units[index] ?? "TB";
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${unit}`;
}
function truncate(text, max = 120) {
  if (typeof text !== "string") return "";
  const single = text.replace(/\s+/g, " ").trim();
  if (max <= 0 || single.length <= max) return single;
  return `${single.slice(0, Math.max(1, max - 1)).trimEnd()}\u2026`;
}
function statusLetter(status) {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "type-changed":
      return "T";
    default:
      return "?";
  }
}
function statusLabel(status, t) {
  return t(`file.status.${status}`);
}
function eventTypeLabel(eventType, t) {
  return t(`event.${eventType}`);
}
function typeGlyph(eventType) {
  switch (eventType) {
    case "commit":
      return "\u25CF";
    case "push":
      return "\u2191";
    case "fetch":
      return "\u2193";
    case "pull":
      return "\u21E3";
    case "update":
      return "\u21BB";
    case "merge":
      return "\u22C8";
    case "rebase":
      return "\u2936";
    case "branch":
      return "\u2442";
    case "tag":
      return "\u2691";
    case "switch":
      return "\u21C4";
    default:
      return "\u2022";
  }
}
function sourceLabel(source, t) {
  return t(`source.${source}.badge`);
}
function diffLineKind(line) {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("old mode") || line.startsWith("new mode") || line.startsWith("similarity index") || line.startsWith("rename from") || line.startsWith("rename to") || line.startsWith("Binary files") || line.startsWith("\\ No newline")) {
    return "meta";
  }
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "removed";
  return "context";
}
function diffLines(text) {
  if (typeof text !== "string" || text === "") return [];
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
function operationLabel(operation, t) {
  return t(`op.label.${operation}`);
}
function operationStateLabel(state, t) {
  return t(`op.state.${state}`);
}
function remoteOutcomeLabel(outcome, t) {
  if (outcome === void 0) return "";
  return t(`audit.remote.${outcome}`);
}
function apiErrorKey(error) {
  if (error === null || error === void 0 || typeof error.code !== "string") return "error.generic";
  return `error.${error.code}`;
}
function errorMessage(error, t) {
  if (error === null || error === void 0) return t("error.generic");
  const key = apiErrorKey(error);
  const message = t(key);
  return message === key ? t("error.generic") : message;
}
function repositoryOptionLabel(repository) {
  const vcs = repository.vcsType === "git" ? "Git" : "SVN";
  const hint = repository.currentBranch ?? repository.defaultBranch ?? shortHash(repository.currentRevision, 8);
  const base = `${vcs} \xB7 ${repository.displayName}`;
  return hint === void 0 || hint === "" ? base : `${base} \u2014 ${hint}`;
}
function stagedCount(entries) {
  if (!Array.isArray(entries)) return 0;
  return entries.filter((entry) => entry.staged === true).length;
}
function diffLineClassName(kind) {
  return `dvt-diff-line dvt-diff-${kind}`;
}

// src/client/styles.ts
var STYLES = `
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
`;

// src/client/components.ts
var h = React.createElement;
var WRITE_OPERATIONS = {
  git: ["fetch", "pull", "push"],
  svn: ["update", "commit"]
};
function hasActiveFilters(state) {
  return state.filters.debouncedText.trim() !== "" || state.filters.eventTypes.length > 0 || state.filters.author.trim() !== "";
}
function selectedRepository(state) {
  if (state.selectedRepositoryId === null) return null;
  return state.repositories.find((repository) => repository.id === state.selectedRepositoryId) ?? null;
}
function missingTool(state, repository) {
  if (repository === null || state.diagnostics === null) return null;
  if (repository.vcsType === "git" && state.diagnostics.gitVersion === null) return "git";
  if (repository.vcsType === "svn" && state.diagnostics.svnVersion === null) return "svn";
  return null;
}
function vcsLabel(vcsType, t) {
  return vcsType === "git" ? t("footer.git") : t("footer.svn");
}
function notice(kind, title, body, action, key) {
  return h(
    "div",
    { key, className: `dvt-banner dvt-banner-${kind}`, role: kind === "error" ? "alert" : "status" },
    h("div", { className: "dvt-banner-title" }, title),
    body !== void 0 && body !== null && body !== "" ? h("div", { className: "dvt-break" }, body) : null,
    action ?? null
  );
}
function errorNotice(t, error, onRetry, key) {
  const message = errorMessage(error, t);
  const code = error !== null && error !== void 0 ? error.code : "internal";
  const action = onRetry === void 0 ? null : h(
    "div",
    { className: "dvt-row" },
    h("button", { type: "button", className: "dvt-btn", onClick: onRetry }, t("common.retry"))
  );
  return h(
    "div",
    { key, className: "dvt-banner dvt-banner-error", role: "alert" },
    h("div", { className: "dvt-banner-title" }, t("common.error")),
    h("div", { className: "dvt-break" }, message),
    h("div", { className: "dvt-error-code dvt-mono" }, code),
    action
  );
}
function skeleton(key) {
  return h(
    "div",
    { key, className: "dvt-skeleton", "aria-busy": "true" },
    h("div", { className: "dvt-skeleton-row" }),
    h("div", { className: "dvt-skeleton-row" }),
    h("div", { className: "dvt-skeleton-row" })
  );
}
function emptyBox(message, hint, key) {
  return h(
    "div",
    { key, className: "dvt-empty" },
    h("div", null, message),
    hint !== void 0 && hint !== null && hint !== "" ? h("div", { className: "dvt-faint" }, hint) : null
  );
}
function sourceBadge(source, t) {
  return h("span", { className: `dvt-badge dvt-badge-source-${source}` }, sourceLabel(source, t));
}
function stateBadge(state, t) {
  const tone = state === "succeeded" ? "success" : state === "failed" ? "error" : state === "unknown" || state === "partial" ? "warn" : "";
  return h(
    "span",
    { className: `dvt-badge${tone === "" ? "" : ` dvt-badge-${tone}`}` },
    operationStateLabel(state, t)
  );
}
function repositoryOption(repository) {
  return repositoryOptionLabel(repository);
}
function renderHeader(state, t, handlers) {
  const repository = selectedRepository(state);
  const hint = repository === null ? null : repository.currentBranch !== void 0 && repository.currentBranch !== "" ? t("repo.branchLabel", { branch: repository.currentBranch }) : repository.currentRevision !== void 0 && repository.currentRevision !== "" ? t("repo.revisionLabel", { revision: shortHash(repository.currentRevision, 8) }) : null;
  return h(
    "div",
    { className: "dvt-col" },
    h(
      "div",
      { className: "dvt-row" },
      h("label", { className: "dvt-sr-only", htmlFor: "dvt-repository-select" }, t("aria.repository")),
      h(
        "select",
        {
          id: "dvt-repository-select",
          className: "dvt-select dvt-grow",
          value: state.selectedRepositoryId ?? "",
          "aria-label": t("aria.repository"),
          onChange: (event) => handlers.onSelectRepository(event.currentTarget.value)
        },
        state.repositories.length === 0 ? h("option", { value: "" }, t("repo.select")) : state.repositories.map((entry) => h("option", { key: entry.id, value: entry.id }, repositoryOption(entry)))
      ),
      h("button", {
        type: "button",
        className: "dvt-icon-btn",
        onClick: handlers.onRefreshRepositories,
        disabled: state.boot === "loading",
        "aria-label": t("aria.refresh"),
        title: t("aria.refresh")
      }, "\u27F3")
    ),
    hint === null ? null : h("div", { className: "dvt-row dvt-faint dvt-clip", title: repository?.rootPath ?? "" }, hint),
    h(
      "div",
      { className: "dvt-tabs", role: "tablist", "aria-label": t("tab.title") },
      h("button", {
        type: "button",
        role: "tab",
        className: "dvt-tab",
        "aria-selected": state.source === "timeline",
        onClick: () => handlers.onSetSource("timeline")
      }, t("source.timeline")),
      h("button", {
        type: "button",
        role: "tab",
        className: "dvt-tab",
        "aria-selected": state.source === "audit",
        onClick: () => handlers.onSetSource("audit")
      }, t("source.audit"))
    )
  );
}
function renderFilters(state, t, handlers) {
  const commitOnly = state.filters.eventTypes.includes("commit");
  const active = hasActiveFilters(state);
  return h(
    "div",
    { className: "dvt-col" },
    h(
      "div",
      { className: "dvt-row" },
      h("input", {
        className: "dvt-input dvt-grow",
        type: "search",
        value: state.filters.text,
        placeholder: t("filter.search.placeholder"),
        "aria-label": t("aria.search"),
        onChange: (event) => handlers.onTextChange(event.currentTarget.value)
      }),
      h("button", {
        type: "button",
        className: "dvt-chip",
        "aria-pressed": state.filters.showAuthor,
        "aria-label": t("aria.toggleFilters"),
        title: t("filter.toggle"),
        onClick: handlers.onToggleAuthor
      }, t("filter.toggle"))
    ),
    h(
      "div",
      { className: "dvt-row-wrap" },
      h("button", {
        type: "button",
        className: "dvt-chip",
        "aria-pressed": !commitOnly,
        onClick: handlers.onShowAllEventTypes
      }, t("filter.chip.all")),
      h("button", {
        type: "button",
        className: "dvt-chip",
        "aria-pressed": commitOnly,
        onClick: () => handlers.onToggleEventType("commit")
      }, t("filter.chip.commit")),
      active ? h("button", { type: "button", className: "dvt-btn", onClick: handlers.onClearFilters }, t("filter.clear")) : null
    ),
    state.filters.showAuthor ? h(
      "div",
      { className: "dvt-row" },
      h("label", { className: "dvt-sr-only", htmlFor: "dvt-author-filter" }, t("filter.author")),
      h("input", {
        id: "dvt-author-filter",
        className: "dvt-input dvt-grow",
        type: "text",
        value: state.filters.author,
        placeholder: t("filter.author.placeholder"),
        "aria-label": t("aria.author"),
        onChange: (event) => handlers.onAuthorChange(event.currentTarget.value)
      })
    ) : null
  );
}
function renderOperationBar(repository, t, handlers) {
  const operations = WRITE_OPERATIONS[repository.vcsType];
  return h(
    "div",
    { className: "dvt-card" },
    h(
      "div",
      { className: "dvt-row" },
      h("span", { className: "dvt-section-title dvt-grow" }, t("op.bar.title")),
      h("span", { className: "dvt-faint dvt-clip", title: t("op.neverRetry") }, t("op.neverRetry"))
    ),
    h("div", { className: "dvt-opbar" }, operations.map((operation) => h("button", {
      key: operation,
      type: "button",
      className: "dvt-btn",
      onClick: () => handlers.onStartOperation(operation)
    }, t(`op.${operation}`))))
  );
}
function timelineRow(event, locale, t, handlers) {
  const revision = event.revision ?? event.commitHash ?? "";
  const label = revision === "" ? event.id : shortHash(revision, 8);
  const meta = [];
  if (revision !== "") meta.push(shortHash(revision, 7));
  if (event.eventType !== "commit") meta.push(eventTypeLabel(event.eventType, t));
  if (event.actor !== void 0 && event.actor !== "") meta.push(event.actor);
  const time = formatTime(event.timestamp, locale);
  if (time !== "") meta.push(time);
  return h(
    "li",
    { key: event.id, className: "dvt-list-item" },
    h(
      "button",
      {
        type: "button",
        className: "dvt-row-btn",
        title: event.summary,
        onClick: () => handlers.onOpenEvent(event)
      },
      h(
        "span",
        { className: "dvt-row-main" },
        h("span", { className: "dvt-glyph", "aria-hidden": "true" }, typeGlyph(event.eventType)),
        h("span", { className: "dvt-row-summary", title: event.summary }, truncate(event.summary, 200)),
        sourceBadge(event.source, t)
      ),
      h(
        "span",
        { className: "dvt-row-meta" },
        meta.map((entry, index) => h("span", { key: `meta-${index}` }, entry)),
        h("span", { key: "label", className: "dvt-sr-only" }, label)
      )
    )
  );
}
function renderTimeline(state, locale, t, handlers) {
  const timeline = state.timeline;
  const repository = selectedRepository(state);
  if (state.boot === "loading") return skeleton("timeline-loading");
  if (state.boot === "error") {
    return h(
      "div",
      { className: "dvt-col" },
      errorNotice(t, state.bootError, handlers.onRefreshRepositories),
      notice("info", t("error.hostUnavailable"), null, null)
    );
  }
  if (repository === null) {
    return emptyBox(t("repo.empty"), t("repo.empty.next"));
  }
  const tool = missingTool(state, repository);
  if (tool !== null) {
    const label = vcsLabel(tool, t);
    return notice("error", t("common.error"), t("state.missingTool", { vcs: label, tool: label }), null);
  }
  if (timeline.loading) return skeleton("timeline-loading");
  if (timeline.error !== null) return errorNotice(t, timeline.error, handlers.onRetryTimeline);
  return h(
    "div",
    { className: "dvt-col" },
    timeline.partial ? notice("warn", t("common.warning"), t("timeline.partial"), null) : null,
    timeline.events.length === 0 ? emptyBox(hasActiveFilters(state) ? t("timeline.empty.filtered") : t("timeline.empty")) : h(
      "div",
      { className: "dvt-col" },
      h(
        "div",
        { className: "dvt-row dvt-faint" },
        h("span", { className: "dvt-grow" }, truncate(t("timeline.count", { count: timeline.events.length }), 80))
      ),
      h("ul", { className: "dvt-list" }, timeline.events.map((event) => timelineRow(event, locale, t, handlers)))
    ),
    timeline.hasMore ? h("button", {
      type: "button",
      className: "dvt-btn",
      disabled: timeline.loadingMore,
      onClick: handlers.onLoadMoreTimeline
    }, timeline.loadingMore ? t("common.loadingMore") : t("timeline.more")) : null
  );
}
function fileRow(file, index, t, handlers) {
  const additions = file.additions ?? 0;
  const deletions = file.deletions ?? 0;
  return h(
    "button",
    {
      key: `${file.path}:${index}`,
      type: "button",
      className: "dvt-file-row",
      title: file.path,
      onClick: () => handlers.onOpenFile(file.path)
    },
    h("span", { className: `dvt-file-status dvt-file-status-${file.status}` }, statusLetter(file.status)),
    h("span", { className: "dvt-sr-only" }, statusLabel(file.status, t)),
    h(
      "span",
      { className: "dvt-file-path" },
      file.oldPath !== void 0 && file.oldPath !== "" ? h("span", { className: "dvt-faint" }, `${file.oldPath} \u2192 `) : null,
      file.path
    ),
    h(
      "span",
      { className: "dvt-file-counts" },
      additions > 0 ? h("span", null, t("detail.additions", { count: additions })) : null,
      deletions > 0 ? h("span", null, t("detail.deletions", { count: deletions })) : null,
      file.binary === true ? h("span", null, "bin") : null
    )
  );
}
function renderMetadata(event, locale, t) {
  const pairs = [];
  const time = formatTime(event.timestamp, locale);
  pairs.push(["time", time === "" ? t("common.unknown") : time]);
  pairs.push(["author", event.actor !== void 0 && event.actor !== "" ? event.actor : t("common.unknown")]);
  const revision = event.revision ?? event.commitHash;
  pairs.push(["revision", revision !== void 0 && revision !== "" ? revision : t("common.unknown")]);
  if (event.branch !== void 0 && event.branch !== "") pairs.push(["branch", event.branch]);
  pairs.push(["source", sourceLabel(event.source, t)]);
  if (event.parentHashes !== void 0 && event.parentHashes.length > 0) {
    pairs.push(["parents", event.parentHashes.map((parent) => shortHash(parent, 7)).join(", ")]);
  }
  return h("dl", { className: "dvt-grid" }, pairs.flatMap(([key, value]) => [
    h("dt", { key: `${key}-dt` }, t(`detail.${key}`)),
    h("dd", { key: `${key}-dd` }, value)
  ]));
}
function renderChangeSet(state, locale, t, handlers) {
  const event = state.changeSet.event;
  if (event === null) return emptyBox(t("common.empty"));
  return h(
    "div",
    { className: "dvt-col" },
    h(
      "div",
      { className: "dvt-detail-head" },
      h("button", {
        type: "button",
        className: "dvt-icon-btn",
        "aria-label": t("aria.back"),
        title: t("aria.back"),
        onClick: handlers.onBackFromDetail
      }, "\u2190"),
      h("strong", { className: "dvt-title dvt-grow dvt-clip", title: event.summary }, t("detail.title"))
    ),
    h(
      "div",
      { className: "dvt-card" },
      h(
        "div",
        { className: "dvt-row" },
        h("span", { className: "dvt-glyph", "aria-hidden": "true" }, typeGlyph(event.eventType)),
        h("span", { className: "dvt-grow dvt-break" }, event.summary),
        sourceBadge(event.source, t)
      ),
      h("div", { className: "dvt-row dvt-faint" }, eventTypeLabel(event.eventType, t))
    ),
    h(
      "div",
      { className: "dvt-card" },
      h("div", { className: "dvt-section-title" }, t("detail.metadata")),
      renderMetadata(event, locale, t)
    ),
    h(
      "div",
      { className: "dvt-card" },
      h(
        "div",
        { className: "dvt-row" },
        h("span", { className: "dvt-section-title dvt-grow" }, t("detail.files")),
        state.changeSet.data === null ? null : h("span", { className: "dvt-faint" }, t("detail.files.count", { count: state.changeSet.data.files.length }))
      ),
      state.changeSet.loading ? skeleton("changeset-loading") : null,
      state.changeSet.error !== null ? errorNotice(t, state.changeSet.error, () => {
        if (state.changeSet.event !== null) handlers.onOpenEvent(state.changeSet.event);
      }) : null,
      state.changeSet.data === null ? state.changeSet.loading ? null : emptyBox(t("detail.files.empty")) : h(
        "div",
        { className: "dvt-col" },
        state.changeSet.data.truncated === true ? notice("warn", t("common.warning"), t("detail.files.truncated"), null) : null,
        state.changeSet.data.files.length === 0 ? emptyBox(t("detail.files.empty")) : h(
          "div",
          { className: "dvt-col" },
          state.changeSet.data.files.map((file, index) => fileRow(file, index, t, handlers))
        )
      )
    )
  );
}
function renderDiff(state, t, handlers) {
  const diff = state.diff;
  const lines = diff.data === null ? [] : diffLines(diff.data.text);
  return h(
    "div",
    { className: "dvt-col" },
    h(
      "div",
      { className: "dvt-detail-head" },
      h("button", {
        type: "button",
        className: "dvt-icon-btn",
        "aria-label": t("aria.back"),
        title: t("aria.back"),
        onClick: handlers.onBackFromDiff
      }, "\u2190"),
      h("strong", { className: "dvt-title dvt-grow dvt-clip", title: diff.filePath ?? "" }, t("diff.title")),
      diff.data !== null && diff.data.binary !== true && diff.data.text !== "" ? h("button", {
        type: "button",
        className: "dvt-btn",
        "aria-label": t("aria.copyDiff"),
        title: t("aria.copyDiff"),
        onClick: handlers.onCopyDiff
      }, state.copied ? t("diff.copied") : t("diff.copy")) : null
    ),
    diff.filePath === null ? null : h("div", { className: "dvt-mono dvt-break" }, diff.filePath),
    diff.loading ? skeleton("diff-loading") : null,
    diff.error !== null ? errorNotice(t, diff.error, handlers.onBackFromDiff) : null,
    diff.data === null ? diff.loading || diff.error !== null ? null : emptyBox(t("diff.empty")) : h(
      "div",
      { className: "dvt-col" },
      diff.data.binary === true ? notice("info", t("diff.binary"), null, null) : diff.data.truncated === true ? notice("warn", t("common.warning"), t("diff.truncated.generic"), null) : null,
      diff.data.binary === true ? null : lines.length === 0 ? emptyBox(t("diff.empty")) : h(
        "pre",
        { className: "dvt-diff-pre", "aria-label": t("diff.title") },
        lines.map((line, index) => h("span", {
          key: `line-${index}`,
          className: diffLineClassName(diffLineKind(line))
        }, line === "" ? " " : line))
      ),
      diff.data.binary !== true && lines.length > 0 ? h(
        "div",
        { className: "dvt-row dvt-faint" },
        h("span", null, t("diff.lines", { count: lines.length })),
        h("span", null, formatBytes(diff.data.bytes))
      ) : null
    )
  );
}
function auditRow(attempt, repository, locale, t, handlers) {
  const label = operationLabel(attempt.operation, t);
  const time = formatTime(attempt.startedAt, locale);
  return h(
    "li",
    { key: attempt.id, className: "dvt-list-item" },
    h(
      "button",
      {
        type: "button",
        className: "dvt-row-btn",
        title: attempt.requestSummary,
        onClick: () => handlers.onOpenOperation(attempt)
      },
      h(
        "span",
        { className: "dvt-row-main" },
        h("span", { className: "dvt-glyph", "aria-hidden": "true" }, "\u2699"),
        h("span", { className: "dvt-row-summary" }, label),
        h("span", { className: "dvt-audit-row-state" }, stateBadge(attempt.state, t))
      ),
      h(
        "span",
        { className: "dvt-row-meta" },
        repository === null ? null : h("span", { key: "repo" }, repository.displayName),
        time === "" ? null : h("span", { key: "time" }, time),
        h("span", { key: "source" }, t("source.plugin-audit.badge")),
        attempt.state === "unknown" ? h("span", { key: "unconfirmed", className: "dvt-badge dvt-badge-warn" }, t("audit.unknownResult")) : null
      )
    )
  );
}
function renderAudit(state, locale, t, handlers) {
  const audit = state.audit;
  const repository = selectedRepository(state);
  if (state.boot === "loading") return skeleton("audit-loading");
  if (state.boot === "error") return errorNotice(t, state.bootError, handlers.onRefreshRepositories);
  if (repository === null) return emptyBox(t("repo.empty"), t("repo.empty.next"));
  if (audit.loading) return skeleton("audit-loading");
  if (audit.error !== null) return errorNotice(t, audit.error, handlers.onRetryAudit);
  return h(
    "div",
    { className: "dvt-col" },
    audit.warnings.length > 0 ? notice("warn", t("common.warning"), t("audit.partial"), null) : null,
    audit.operations.length === 0 ? emptyBox(t("audit.empty")) : h("ul", { className: "dvt-list" }, audit.operations.map((attempt) => auditRow(
      attempt,
      state.repositories.find((entry) => entry.id === attempt.repositoryId) ?? null,
      locale,
      t,
      handlers
    ))),
    audit.hasMore ? h("button", {
      type: "button",
      className: "dvt-btn",
      disabled: audit.loadingMore,
      onClick: handlers.onLoadMoreAudit
    }, audit.loadingMore ? t("common.loadingMore") : t("audit.more")) : null
  );
}
function auditField(key, value) {
  return h(
    "div",
    { key, className: "dvt-col" },
    h("div", { className: "dvt-faint" }, key),
    h("div", { className: "dvt-break" }, value)
  );
}
function renderAuditDetail(state, locale, t, handlers) {
  const attempt = state.audit.selected;
  if (attempt === null) return emptyBox(t("common.empty"));
  const repository = state.repositories.find((entry) => entry.id === attempt.repositoryId) ?? null;
  const rows = [
    auditField(t("audit.operation"), operationLabel(attempt.operation, t)),
    auditField(t("audit.state"), stateBadge(attempt.state, t)),
    auditField(t("audit.repository"), repository === null ? attempt.repositoryId : repository.displayName),
    auditField(t("audit.startedAt"), formatTime(attempt.startedAt, locale) || t("common.unknown"))
  ];
  if (attempt.finishedAt !== void 0) rows.push(auditField(t("audit.finishedAt"), formatTime(attempt.finishedAt, locale)));
  if (attempt.exitCode !== void 0) rows.push(auditField(t("audit.exitCode"), String(attempt.exitCode)));
  if (attempt.errorCode !== void 0 && attempt.errorCode !== "") rows.push(auditField(t("audit.errorCode"), attempt.errorCode));
  if (attempt.safeErrorMessage !== void 0 && attempt.safeErrorMessage !== "") {
    rows.push(auditField(t("audit.safeError"), attempt.safeErrorMessage));
  }
  rows.push(auditField(t("audit.requestSummary"), attempt.requestSummary));
  if (attempt.beforeRevision !== void 0) rows.push(auditField(t("audit.beforeRevision"), attempt.beforeRevision));
  if (attempt.afterRevision !== void 0) rows.push(auditField(t("audit.afterRevision"), attempt.afterRevision));
  if (attempt.remoteOutcome !== void 0) {
    rows.push(auditField(t("audit.remoteOutcome"), remoteOutcomeLabel(attempt.remoteOutcome, t)));
  }
  if (attempt.changedPaths !== void 0 && attempt.changedPaths.length > 0) {
    rows.push(auditField(t("audit.changedPaths"), attempt.changedPaths.join(", ")));
  }
  rows.push(auditField(t("audit.correlationId"), attempt.correlationId));
  return h(
    "div",
    { className: "dvt-col" },
    h(
      "div",
      { className: "dvt-detail-head" },
      h("button", {
        type: "button",
        className: "dvt-icon-btn",
        "aria-label": t("aria.back"),
        title: t("aria.back"),
        onClick: handlers.onBackFromAuditDetail
      }, "\u2190"),
      h("strong", { className: "dvt-title dvt-grow dvt-clip" }, t("audit.detail"))
    ),
    attempt.state === "unknown" ? notice("warn", t("audit.unknownResult"), t("audit.unknownResult.hint"), null) : null,
    h("div", { className: "dvt-card" }, rows)
  );
}
function renderBeforeState(state, t) {
  const before = state.dialog?.preview?.before;
  const rows = [];
  if (before === void 0) return h("div", null);
  if (before.branch !== void 0) rows.push(auditField(t("op.before.branch"), before.branch));
  if (before.revision !== void 0) rows.push(auditField(t("op.before.revision"), before.revision));
  if (before.clean !== void 0) rows.push(auditField(t("op.before.clean"), before.clean ? t("op.before.clean.yes") : t("op.before.clean.no")));
  if (before.stagedFiles !== void 0) rows.push(auditField(t("op.before.staged"), t("op.before.stagedCount", { count: before.stagedFiles.length })));
  if (before.ahead !== void 0) rows.push(auditField(t("op.before.ahead"), String(before.ahead)));
  if (before.behind !== void 0) rows.push(auditField(t("op.before.behind"), String(before.behind)));
  return h(
    "div",
    { className: "dvt-card" },
    h("div", { className: "dvt-section-title" }, t("op.before")),
    rows.length === 0 ? h("div", { className: "dvt-faint" }, t("common.none")) : h("div", { className: "dvt-col" }, rows)
  );
}
function renderOperationResult(attempt, t) {
  const rows = [
    auditField(t("audit.state"), stateBadge(attempt.state, t))
  ];
  if (attempt.exitCode !== void 0) rows.push(auditField(t("audit.exitCode"), String(attempt.exitCode)));
  if (attempt.errorCode !== void 0 && attempt.errorCode !== "") rows.push(auditField(t("audit.errorCode"), attempt.errorCode));
  if (attempt.safeErrorMessage !== void 0 && attempt.safeErrorMessage !== "") {
    rows.push(auditField(t("audit.safeError"), attempt.safeErrorMessage));
  }
  if (attempt.beforeRevision !== void 0) rows.push(auditField(t("audit.beforeRevision"), attempt.beforeRevision));
  if (attempt.afterRevision !== void 0) rows.push(auditField(t("audit.afterRevision"), attempt.afterRevision));
  if (attempt.changedPaths !== void 0 && attempt.changedPaths.length > 0) {
    rows.push(auditField(t("audit.changedPaths"), attempt.changedPaths.join(", ")));
  }
  if (attempt.remoteOutcome !== void 0) {
    rows.push(auditField(t("audit.remoteOutcome"), remoteOutcomeLabel(attempt.remoteOutcome, t)));
  }
  return h(
    "div",
    { className: "dvt-col" },
    attempt.state === "unknown" ? notice("warn", t("audit.unknownResult"), t("audit.unknownResult.hint"), null) : null,
    h("div", { className: "dvt-card" }, rows),
    h("div", { className: "dvt-faint" }, t("op.refreshNote"))
  );
}
function renderOperationFields(state, handlers, t, dialog) {
  const disabled = dialog.phase === "executing" || dialog.phase === "result";
  if (dialog.operation === "commit") {
    const staged = stagedCount(state.status?.entries);
    const missing = dialog.message.trim() === "";
    return h(
      "div",
      { key: "commit-fields", className: "dvt-card" },
      h("label", { className: "dvt-section-title", htmlFor: "dvt-commit-message" }, t("op.commit.message")),
      h("textarea", {
        id: "dvt-commit-message",
        className: "dvt-textarea",
        value: dialog.message,
        placeholder: t("op.commit.message.placeholder"),
        "aria-label": t("op.commit.message"),
        disabled,
        onChange: (event) => handlers.onDialogMessageChange(event.currentTarget.value)
      }),
      h("div", { className: "dvt-faint dvt-break" }, t("op.commit.stagedOnly")),
      h("div", { className: "dvt-faint" }, t("op.commit.stagedCount", { count: staged })),
      staged === 0 ? notice("warn", t("common.warning"), t("op.commit.noStaged"), null) : null,
      missing ? h("div", { className: "dvt-error" }, t("op.commit.message.required")) : null
    );
  }
  if (dialog.operation === "push") {
    return h(
      "div",
      { key: "push-fields", className: "dvt-card" },
      h("label", { className: "dvt-section-title", htmlFor: "dvt-push-remote" }, t("op.push.remote")),
      h("input", {
        id: "dvt-push-remote",
        className: "dvt-input",
        type: "text",
        value: dialog.remote,
        "aria-label": t("op.push.remote"),
        disabled,
        onChange: (event) => handlers.onDialogRemoteChange(event.currentTarget.value)
      }),
      h("label", { className: "dvt-section-title", htmlFor: "dvt-push-branch" }, t("op.push.branch")),
      h("input", {
        id: "dvt-push-branch",
        className: "dvt-input",
        type: "text",
        value: dialog.branch,
        "aria-label": t("op.push.branch"),
        disabled,
        onChange: (event) => handlers.onDialogBranchChange(event.currentTarget.value)
      }),
      h("div", { className: "dvt-faint dvt-break" }, t("op.push.hint"))
    );
  }
  return null;
}
function renderDialog(state, deps, handlers) {
  const dialog = state.dialog;
  if (dialog === null) return null;
  const { t } = deps;
  const repository = selectedRepository(state);
  const preview = dialog.preview;
  const now = deps.now ?? Date.now;
  const expired = preview !== null && preview.allowed && preview.expiresAt !== "" && Number.isFinite(Date.parse(preview.expiresAt)) && Date.parse(preview.expiresAt) < now();
  const commitMissing = dialog.operation === "commit" && dialog.message.trim() === "";
  const busy = dialog.phase === "previewing" || dialog.phase === "executing";
  const canConfirm = dialog.phase === "previewed" && preview !== null && preview.allowed && !expired && !commitMissing;
  const body = [];
  if (dialog.phase === "previewing") {
    body.push(h("div", { key: "previewing", className: "dvt-row" }, h("span", null, t("op.previewing"))));
    body.push(skeleton("dialog-loading"));
  }
  if (dialog.previewError !== null) {
    body.push(errorNotice(t, dialog.previewError, handlers.onDialogRepreview, "preview-error"));
    body.push(h("div", { key: "preview-failed", className: "dvt-faint" }, t("op.previewFailed")));
  }
  if (preview !== null) {
    body.push(h(
      "div",
      { key: "summary", className: "dvt-card" },
      h("div", { className: "dvt-section-title" }, t("op.summary")),
      h("div", { className: "dvt-break" }, preview.summary)
    ));
    if (!preview.allowed) {
      body.push(notice(
        "error",
        t("common.error"),
        t("op.blocked", { reason: preview.blockedReason !== void 0 && preview.blockedReason !== "" ? preview.blockedReason : t("op.blocked.generic") }),
        null,
        "blocked"
      ));
    }
    body.push(h(
      "div",
      { key: "argv", className: "dvt-card" },
      h("div", { className: "dvt-section-title" }, t("op.argv")),
      h("pre", { className: "dvt-argv" }, preview.argv.join(" "))
    ));
    if (preview.warnings.length > 0) {
      body.push(h(
        "div",
        { key: "warnings", className: "dvt-card" },
        h("div", { className: "dvt-section-title" }, t("op.warnings")),
        h("ul", { className: "dvt-warning-list" }, preview.warnings.map((warning, index) => h("li", { key: `warn-${index}` }, warning)))
      ));
    }
    body.push(h("div", { key: "before", className: "dvt-card" }, renderBeforeState(state, t)));
    if (repository !== null) {
      body.push(h(
        "div",
        { key: "target", className: "dvt-card" },
        h("div", { className: "dvt-section-title" }, t("op.target")),
        h("div", { className: "dvt-break" }, `${repository.displayName} (${vcsLabel(repository.vcsType, t)})`),
        h("div", { className: "dvt-mono dvt-break" }, repository.rootPath)
      ));
    }
    if (preview.expiresAt !== "") {
      body.push(h(
        "div",
        { key: "expires", className: "dvt-mono dvt-faint" },
        `${t("op.expires")}: ${formatTime(preview.expiresAt, deps.locale)}`
      ));
    }
    if (expired) body.push(notice("warn", t("common.warning"), t("op.expired"), null, "expired"));
  }
  const fields = renderOperationFields(state, handlers, t, dialog);
  if (fields !== null) body.push(fields);
  if (dialog.phase === "executing") {
    body.push(h("div", { key: "executing", className: "dvt-row" }, h("span", null, t("op.executing"))));
    body.push(skeleton("executing"));
  }
  if (dialog.executeError !== null) {
    body.push(errorNotice(t, dialog.executeError, void 0, "execute-error"));
    body.push(h("div", { key: "execute-note", className: "dvt-faint" }, t("op.executeError")));
  }
  if (dialog.result !== null) {
    body.push(h("div", { key: "result" }, renderOperationResult(dialog.result, t)));
  }
  const actions = [];
  if (dialog.phase === "previewed" && preview !== null && preview.allowed) {
    actions.push(h("button", {
      key: "confirm",
      type: "button",
      className: "dvt-btn dvt-btn-primary",
      disabled: !canConfirm,
      autoFocus: true,
      onClick: handlers.onDialogConfirm
    }, t("op.confirm")));
  }
  if (dialog.phase === "error" || dialog.phase === "blocked" || dialog.phase === "previewed" && expired) {
    actions.push(h("button", {
      key: "repreview",
      type: "button",
      className: "dvt-btn",
      disabled: busy,
      onClick: handlers.onDialogRepreview
    }, t("op.repreview")));
  }
  if (dialog.phase === "result") {
    actions.push(h("button", {
      key: "close-result",
      type: "button",
      className: "dvt-btn",
      onClick: handlers.onDialogClose
    }, t("common.close")));
  }
  actions.push(h("button", {
    key: "cancel",
    type: "button",
    className: "dvt-btn",
    disabled: dialog.phase === "executing",
    onClick: handlers.onDialogClose
  }, t("common.cancel")));
  return h(
    "div",
    { className: "dvt-dialog-backdrop" },
    h(
      "div",
      {
        className: "dvt-dialog",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": t("aria.dialog", { operation: operationLabel(dialog.operation, t) })
      },
      h(
        "div",
        { className: "dvt-dialog-head" },
        h("strong", { className: "dvt-title dvt-grow dvt-clip" }, t("op.dialogTitle", { operation: operationLabel(dialog.operation, t) })),
        h("button", {
          type: "button",
          className: "dvt-icon-btn",
          "aria-label": t("aria.closeDialog"),
          title: t("aria.closeDialog"),
          disabled: dialog.phase === "executing",
          onClick: handlers.onDialogClose
        }, "\xD7")
      ),
      body,
      h("div", { className: "dvt-faint dvt-break" }, t("op.neverRetry")),
      h("div", { className: "dvt-dialog-actions" }, actions)
    )
  );
}
function renderFooter(state, t, handlers) {
  const repository = selectedRepository(state);
  const diagnostics = state.diagnostics;
  const status = state.status;
  const parts = [];
  if (repository === null) {
    parts.push(h("span", { key: "repo" }, t("footer.noRepo")));
  } else {
    parts.push(h("span", { key: "repo", className: "dvt-clip", title: repository.rootPath }, `${repository.vcsType === "git" ? t("footer.git") : t("footer.svn")} \xB7 ${repository.displayName}`));
    if (status !== null && status.branch !== void 0) parts.push(h("span", { key: "branch" }, `${t("footer.branch")}: ${status.branch}`));
    if (status !== null && status.head !== void 0) parts.push(h("span", { key: "head" }, `${t("footer.revision")}: ${shortHash(status.head, 8)}`));
  }
  const statusLine = [];
  if (state.statusLoading) {
    statusLine.push(h("span", { key: "loading" }, t("footer.statusLoading")));
  } else if (state.statusError !== null) {
    statusLine.push(h("span", { key: "status-error" }, t("footer.statusError")));
    statusLine.push(h("button", {
      key: "status-retry",
      type: "button",
      className: "dvt-link",
      "aria-label": t("aria.retryStatus"),
      onClick: handlers.onRetryStatus
    }, t("common.retry")));
  } else if (status !== null) {
    statusLine.push(h("span", { key: "clean", className: status.clean ? "dvt-muted" : "dvt-faint" }, status.clean ? t("footer.clean") : t("footer.dirty")));
    if (status.conflicts.length > 0) {
      statusLine.push(h("span", { key: "conflicts", className: "dvt-badge dvt-badge-error" }, t("footer.conflicts", { count: status.conflicts.length })));
    }
  }
  const tools = [];
  if (diagnostics === null) {
    tools.push(h("span", { key: "diag-loading" }, t("common.loading")));
  } else {
    tools.push(h("span", { key: "git" }, diagnostics.gitVersion === null ? t("footer.unavailable", { tool: t("footer.git") }) : `${t("footer.git")} ${diagnostics.gitVersion}`));
    tools.push(h("span", { key: "svn" }, diagnostics.svnVersion === null ? t("footer.unavailable", { tool: t("footer.svn") }) : `${t("footer.svn")} ${diagnostics.svnVersion}`));
    tools.push(h("span", { key: "data", className: "dvt-clip", title: diagnostics.dataDir }, `${t("footer.dataDir")}: ${diagnostics.dataDir}`));
    tools.push(h("span", { key: "version" }, t("footer.version", { version: diagnostics.pluginVersion })));
  }
  return h(
    "div",
    { className: "dvt-footer" },
    h("div", { className: "dvt-footer-line" }, parts),
    statusLine.length > 0 ? h("div", { className: "dvt-footer-line" }, statusLine) : null,
    h("div", { className: "dvt-footer-line" }, tools)
  );
}
function renderNotices(state, t, handlers) {
  const repository = selectedRepository(state);
  const tool = missingTool(state, repository);
  const items = [];
  if (state.noWorkspace) {
    items.push(notice("info", t("repo.noWorkspace"), t("repo.noWorkspace.hint"), null, "no-workspace"));
  }
  if (tool !== null && repository !== null) {
    const label = vcsLabel(tool, t);
    items.push(notice(
      "error",
      t("common.error"),
      t("state.missingTool", { vcs: label, tool: label }),
      null,
      "missing-tool"
    ));
  }
  if (state.boot === "error" && state.repositories.length === 0) {
    items.push(errorNotice(t, state.bootError, handlers.onRefreshRepositories, "boot-error"));
  }
  if (items.length === 0) return null;
  return h("div", { key: "notices", className: "dvt-col" }, items);
}
function renderPanelView(props) {
  const { state, deps, handlers } = props;
  const { t } = deps;
  const locale = deps.locale ?? "zh";
  const repository = selectedRepository(state);
  let body;
  if (state.diff.filePath !== null) body = renderDiff(state, t, handlers);
  else if (state.changeSet.event !== null) body = renderChangeSet(state, locale, t, handlers);
  else if (state.source === "audit" && state.audit.selected !== null) body = renderAuditDetail(state, locale, t, handlers);
  else body = h(
    "div",
    { className: "dvt-col" },
    state.source === "audit" ? null : renderFilters(state, t, handlers),
    repository !== null && state.diff.filePath === null ? renderOperationBar(repository, t, handlers) : null,
    state.source === "timeline" ? renderTimeline(state, locale, t, handlers) : renderAudit(state, locale, t, handlers)
  );
  return h(
    "div",
    { className: "dvt-root", "data-dvt-panel": "vcs-timeline", lang: locale === "en" ? "en" : "zh-CN" },
    h("style", { key: "dvt-styles" }, deps.styles ?? STYLES),
    h("div", { key: "header" }, renderHeader(state, t, handlers)),
    renderNotices(state, t, handlers),
    h("div", { key: "body", className: "dvt-col" }, body),
    h("div", { key: "footer" }, renderFooter(state, t, handlers)),
    renderDialog(state, deps, handlers)
  );
}

// src/client/types.ts
function createTimelineSlice() {
  return {
    events: [],
    cursor: null,
    hasMore: false,
    partial: false,
    warnings: [],
    loading: false,
    loadingMore: false,
    error: null
  };
}
function createChangeSetSlice() {
  return { event: null, revision: "", data: null, loading: false, error: null };
}
function createDiffSlice() {
  return { filePath: null, data: null, loading: false, error: null };
}
function createAuditSlice() {
  return {
    operations: [],
    cursor: null,
    hasMore: false,
    warnings: [],
    loading: false,
    loadingMore: false,
    error: null,
    selected: null
  };
}
function createInitialState() {
  return {
    boot: "loading",
    bootError: null,
    repositories: [],
    diagnostics: null,
    selectedRepositoryId: null,
    workspacePath: null,
    noWorkspace: false,
    source: "timeline",
    filters: { text: "", debouncedText: "", eventTypes: [], author: "", showAuthor: false },
    refreshTick: 0,
    statusTick: 0,
    timeline: createTimelineSlice(),
    changeSet: createChangeSetSlice(),
    diff: createDiffSlice(),
    audit: createAuditSlice(),
    status: null,
    statusLoading: false,
    statusError: null,
    dialog: null,
    copied: false
  };
}

// src/client/panel.ts
function findRepository(state, repositoryId) {
  if (repositoryId === null) return null;
  return state.repositories.find((entry) => entry.id === repositoryId) ?? null;
}
function createOperationDraft(operation, repository, previous) {
  if (previous !== void 0 && previous !== null && previous.operation === operation) {
    return {
      operation,
      message: previous.message,
      remote: previous.remote,
      branch: previous.branch
    };
  }
  return {
    operation,
    message: "",
    remote: "origin",
    branch: repository?.currentBranch ?? repository?.defaultBranch ?? ""
  };
}
function operationParams(draft) {
  if (draft.operation === "commit") return { message: draft.message };
  if (draft.operation === "push") {
    return { remote: draft.remote.trim(), branch: draft.branch.trim() };
  }
  return void 0;
}
function buildPreviewRequest(repositoryId, draft) {
  const params = operationParams(draft);
  return params === void 0 ? { repositoryId, operation: draft.operation } : { repositoryId, operation: draft.operation, params };
}
function buildExecuteRequest(repositoryId, draft, confirmationToken) {
  const params = operationParams(draft);
  return params === void 0 ? { repositoryId, operation: draft.operation, confirmationToken } : { repositoryId, operation: draft.operation, params, confirmationToken };
}
async function requestPreview(api, repositoryId, draft) {
  return api.previewOperation(buildPreviewRequest(repositoryId, draft));
}
async function requestExecute(api, repositoryId, draft, confirmationToken) {
  return api.executeOperation(buildExecuteRequest(repositoryId, draft, confirmationToken));
}
function createTimelinePanel(deps) {
  return function TimelinePanel(props) {
    const [state, setState] = React2.useState(createInitialState);
    const stateRef = React2.useRef(state);
    stateRef.current = state;
    const aliveRef = React2.useRef(true);
    const copyTimerRef = React2.useRef(null);
    const repreviewTimerRef = React2.useRef(null);
    const timelineTokenRef = React2.useRef(0);
    const auditTokenRef = React2.useRef(0);
    const statusTokenRef = React2.useRef(0);
    const detailTokenRef = React2.useRef(0);
    const diffTokenRef = React2.useRef(0);
    const dialogTokenRef = React2.useRef(0);
    React2.useEffect(() => () => {
      aliveRef.current = false;
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      if (repreviewTimerRef.current !== null) clearTimeout(repreviewTimerRef.current);
    }, []);
    const resolveWorkspace = () => {
      try {
        const injected = deps.resolveWorkspacePath?.(props);
        if (typeof injected === "string" && injected !== "") return injected;
      } catch {
      }
      return typeof props.workspacePath === "string" && props.workspacePath !== "" ? props.workspacePath : null;
    };
    const reloadRepositories = async () => {
      const workspacePath = resolveWorkspace();
      setState((prev) => ({
        ...prev,
        boot: prev.repositories.length === 0 ? "loading" : "ready",
        bootError: null,
        workspacePath,
        noWorkspace: workspacePath === null
      }));
      const result = await deps.api.listRepositories(workspacePath);
      if (!aliveRef.current) return;
      if (!result.ok) {
        setState((prev) => ({
          ...prev,
          boot: prev.repositories.length === 0 ? "error" : "ready",
          bootError: result.error
        }));
        return;
      }
      const repositories = result.value.repositories;
      setState((prev) => {
        const stillPresent = prev.selectedRepositoryId !== null && repositories.some((repository) => repository.id === prev.selectedRepositoryId);
        const selected = stillPresent ? prev.selectedRepositoryId : repositories[0]?.id ?? null;
        const changed = selected !== prev.selectedRepositoryId;
        return {
          ...prev,
          boot: "ready",
          bootError: null,
          repositories,
          diagnostics: result.value.diagnostics,
          selectedRepositoryId: selected,
          workspacePath,
          noWorkspace: workspacePath === null,
          ...changed ? {
            timeline: createTimelineSlice(),
            changeSet: createChangeSetSlice(),
            diff: createDiffSlice(),
            audit: createAuditSlice(),
            status: null,
            statusError: null
          } : {}
        };
      });
    };
    const loadTimeline = async (repositoryId, cursor) => {
      const token = ++timelineTokenRef.current;
      const filters = stateRef.current.filters;
      if (cursor === null) {
        setState((prev) => ({
          ...prev,
          timeline: {
            events: [],
            cursor: null,
            hasMore: false,
            partial: false,
            warnings: [],
            loading: true,
            loadingMore: false,
            error: null
          }
        }));
      } else {
        setState((prev) => ({ ...prev, timeline: { ...prev.timeline, loadingMore: true, error: null } }));
      }
      const query = { repositoryId, limit: DEFAULT_PAGE_SIZE };
      const text = filters.debouncedText.trim();
      if (text !== "") query.text = text;
      if (filters.eventTypes.length > 0) query.eventTypes = [...filters.eventTypes];
      const author = filters.author.trim();
      if (author !== "") query.author = author;
      if (cursor !== null) query.cursor = cursor;
      const result = await deps.api.timeline(query);
      if (!aliveRef.current || token !== timelineTokenRef.current) return;
      if (stateRef.current.selectedRepositoryId !== repositoryId) return;
      if (!result.ok) {
        setState((prev) => ({
          ...prev,
          timeline: { ...prev.timeline, loading: false, loadingMore: false, error: result.error }
        }));
        return;
      }
      const page = result.value;
      setState((prev) => {
        const known = new Set(prev.timeline.events.map((event) => event.id));
        const fresh = page.events.filter((event) => !known.has(event.id));
        return {
          ...prev,
          timeline: cursor === null ? {
            events: page.events,
            cursor: page.nextCursor,
            hasMore: page.hasMore,
            partial: page.partial === true,
            warnings: page.warnings ?? [],
            loading: false,
            loadingMore: false,
            error: null
          } : {
            ...prev.timeline,
            events: [...prev.timeline.events, ...fresh],
            cursor: page.nextCursor,
            hasMore: page.hasMore,
            partial: prev.timeline.partial || page.partial === true,
            warnings: [...prev.timeline.warnings, ...page.warnings ?? []],
            loading: false,
            loadingMore: false,
            error: null
          }
        };
      });
    };
    const loadAudit = async (repositoryId, cursor) => {
      const token = ++auditTokenRef.current;
      if (cursor === null) {
        setState((prev) => ({
          ...prev,
          audit: {
            ...prev.audit,
            operations: [],
            cursor: null,
            hasMore: false,
            warnings: [],
            loading: true,
            loadingMore: false,
            error: null,
            selected: null
          }
        }));
      } else {
        setState((prev) => ({ ...prev, audit: { ...prev.audit, loadingMore: true, error: null } }));
      }
      const result = await deps.api.listOperations(cursor === null ? { repositoryId } : { repositoryId, cursor });
      if (!aliveRef.current || token !== auditTokenRef.current) return;
      if (stateRef.current.selectedRepositoryId !== repositoryId) return;
      if (!result.ok) {
        setState((prev) => ({
          ...prev,
          audit: { ...prev.audit, loading: false, loadingMore: false, error: result.error }
        }));
        return;
      }
      const page = result.value;
      setState((prev) => {
        const known = new Set(prev.audit.operations.map((attempt) => attempt.id));
        const fresh = page.operations.filter((attempt) => !known.has(attempt.id));
        return {
          ...prev,
          audit: cursor === null ? {
            operations: page.operations,
            cursor: page.nextCursor,
            hasMore: page.hasMore,
            warnings: page.warnings ?? [],
            loading: false,
            loadingMore: false,
            error: null,
            selected: prev.audit.selected
          } : {
            ...prev.audit,
            operations: [...prev.audit.operations, ...fresh],
            cursor: page.nextCursor,
            hasMore: page.hasMore,
            warnings: [...prev.audit.warnings, ...page.warnings ?? []],
            loading: false,
            loadingMore: false,
            error: null
          }
        };
      });
    };
    const loadStatus = async (repositoryId) => {
      const token = ++statusTokenRef.current;
      setState((prev) => ({ ...prev, statusLoading: true, statusError: null }));
      const result = await deps.api.status(repositoryId);
      if (!aliveRef.current || token !== statusTokenRef.current) return;
      if (stateRef.current.selectedRepositoryId !== repositoryId) return;
      if (!result.ok) {
        setState((prev) => ({ ...prev, statusLoading: false, statusError: result.error, status: null }));
        return;
      }
      setState((prev) => ({ ...prev, statusLoading: false, statusError: null, status: result.value }));
    };
    const openEvent = async (event) => {
      const repositoryId = stateRef.current.selectedRepositoryId;
      if (repositoryId === null) return;
      const revision = event.revision ?? event.commitHash ?? "";
      const token = ++detailTokenRef.current;
      setState((prev) => ({
        ...prev,
        diff: createDiffSlice(),
        changeSet: {
          event,
          revision,
          data: null,
          loading: revision !== "",
          error: revision === "" ? { code: "invalid-request", message: "missing-revision" } : null
        }
      }));
      if (revision === "") return;
      const result = await deps.api.changeSet(repositoryId, revision);
      if (!aliveRef.current || token !== detailTokenRef.current) return;
      setState((prev) => {
        if (prev.changeSet.event !== event) return prev;
        if (!result.ok) return { ...prev, changeSet: { ...prev.changeSet, loading: false, error: result.error } };
        return { ...prev, changeSet: { ...prev.changeSet, loading: false, error: null, data: result.value } };
      });
    };
    const openDiff = async (filePath) => {
      const snapshot = stateRef.current;
      const repositoryId = snapshot.selectedRepositoryId;
      if (repositoryId === null) return;
      const revision = snapshot.changeSet.revision;
      const token = ++diffTokenRef.current;
      setState((prev) => ({
        ...prev,
        diff: { filePath, data: null, loading: true, error: null }
      }));
      const query = { repositoryId, filePath };
      if (revision !== "") query.revisionB = revision;
      const result = await deps.api.diff(query);
      if (!aliveRef.current || token !== diffTokenRef.current) return;
      if (!result.ok) {
        setState((prev) => ({ ...prev, diff: { ...prev.diff, loading: false, error: result.error } }));
        return;
      }
      setState((prev) => ({ ...prev, diff: { ...prev.diff, loading: false, error: null, data: result.value } }));
    };
    const copyDiff = async () => {
      const text = stateRef.current.diff.data?.text ?? "";
      if (text === "") return;
      try {
        if (typeof navigator === "undefined" || navigator.clipboard === void 0) return;
        await navigator.clipboard.writeText(text);
      } catch {
        return;
      }
      if (!aliveRef.current) return;
      setState((prev) => ({ ...prev, copied: true }));
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        if (aliveRef.current) setState((prev) => ({ ...prev, copied: false }));
      }, 1500);
    };
    const runPreview = async (repositoryId, draft) => {
      const token = ++dialogTokenRef.current;
      setState((prev) => prev.dialog === null ? prev : {
        ...prev,
        dialog: {
          ...prev.dialog,
          operation: draft.operation,
          message: draft.message,
          remote: draft.remote,
          branch: draft.branch,
          phase: "previewing",
          preview: null,
          previewError: null,
          executeError: null
        }
      });
      const result = await requestPreview(deps.api, repositoryId, draft);
      if (!aliveRef.current || token !== dialogTokenRef.current) return;
      setState((prev) => {
        if (prev.dialog === null) return prev;
        if (!result.ok) return { ...prev, dialog: { ...prev.dialog, phase: "error", previewError: result.error } };
        return {
          ...prev,
          dialog: {
            ...prev.dialog,
            phase: result.value.allowed ? "previewed" : "blocked",
            preview: result.value,
            previewError: null
          }
        };
      });
    };
    const startOperation = (operation) => {
      const snapshot = stateRef.current;
      const repositoryId = snapshot.selectedRepositoryId;
      if (repositoryId === null) return;
      if (repreviewTimerRef.current !== null) {
        clearTimeout(repreviewTimerRef.current);
        repreviewTimerRef.current = null;
      }
      const repository = findRepository(snapshot, repositoryId);
      const draft = createOperationDraft(operation, repository, snapshot.dialog);
      setState((prev) => ({
        ...prev,
        dialog: {
          operation: draft.operation,
          phase: "previewing",
          preview: null,
          previewError: null,
          executeError: null,
          result: null,
          message: draft.message,
          remote: draft.remote,
          branch: draft.branch
        }
      }));
      void runPreview(repositoryId, draft);
    };
    const schedulePreview = (draft) => {
      const repositoryId = stateRef.current.selectedRepositoryId;
      if (repositoryId === null) return;
      dialogTokenRef.current += 1;
      setState((prev) => prev.dialog === null ? prev : {
        ...prev,
        dialog: {
          ...prev.dialog,
          operation: draft.operation,
          message: draft.message,
          remote: draft.remote,
          branch: draft.branch,
          phase: "previewing",
          preview: null,
          previewError: null,
          executeError: null
        }
      });
      if (repreviewTimerRef.current !== null) clearTimeout(repreviewTimerRef.current);
      repreviewTimerRef.current = setTimeout(() => {
        repreviewTimerRef.current = null;
        void runPreview(repositoryId, draft);
      }, 450);
    };
    const confirmOperation = async () => {
      const snapshot = stateRef.current;
      const dialog = snapshot.dialog;
      const repositoryId = snapshot.selectedRepositoryId;
      if (dialog === null || repositoryId === null) return;
      if (dialog.phase !== "previewed" || dialog.preview === null || !dialog.preview.allowed) return;
      const draft = {
        operation: dialog.operation,
        message: dialog.message,
        remote: dialog.remote,
        branch: dialog.branch
      };
      if (draft.operation === "commit" && draft.message.trim() === "") return;
      if (repreviewTimerRef.current !== null) {
        clearTimeout(repreviewTimerRef.current);
        repreviewTimerRef.current = null;
      }
      const token = ++dialogTokenRef.current;
      setState((prev) => prev.dialog === null ? prev : { ...prev, dialog: { ...prev.dialog, phase: "executing", executeError: null } });
      const result = await requestExecute(deps.api, repositoryId, draft, dialog.preview.confirmationToken);
      if (!aliveRef.current || token !== dialogTokenRef.current) return;
      if (!result.ok) {
        setState((prev) => prev.dialog === null ? prev : { ...prev, dialog: { ...prev.dialog, phase: "previewed", executeError: result.error } });
        return;
      }
      setState((prev) => {
        if (prev.dialog === null) return prev;
        return {
          ...prev,
          dialog: { ...prev.dialog, phase: "result", result: result.value, executeError: null },
          refreshTick: prev.refreshTick + 1,
          statusTick: prev.statusTick + 1
        };
      });
    };
    React2.useEffect(() => {
      void reloadRepositories();
    }, []);
    React2.useEffect(() => {
      const repositoryId = state.selectedRepositoryId;
      if (repositoryId === null) return;
      void loadStatus(repositoryId);
    }, [state.selectedRepositoryId, state.statusTick]);
    React2.useEffect(() => {
      const repositoryId = state.selectedRepositoryId;
      if (repositoryId === null) return;
      if (state.source === "timeline") void loadTimeline(repositoryId, null);
      else void loadAudit(repositoryId, null);
    }, [
      state.selectedRepositoryId,
      state.source,
      state.filters.debouncedText,
      state.filters.eventTypes.join(","),
      state.filters.author,
      state.refreshTick
    ]);
    React2.useEffect(() => {
      const handle = setTimeout(() => {
        setState((prev) => prev.filters.text === prev.filters.debouncedText ? prev : { ...prev, filters: { ...prev.filters, debouncedText: prev.filters.text } });
      }, 250);
      return () => clearTimeout(handle);
    }, [state.filters.text]);
    const dialogOpen = state.dialog !== null;
    React2.useEffect(() => {
      if (!dialogOpen || typeof document === "undefined") return;
      const onKeyDown = (event) => {
        if (event.key !== "Escape") return;
        if (stateRef.current.dialog?.phase === "executing") return;
        event.stopPropagation();
        setState((prev) => ({ ...prev, dialog: null }));
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }, [dialogOpen]);
    const handlers = {
      onRefreshRepositories: () => {
        setState((prev) => ({ ...prev, refreshTick: prev.refreshTick + 1, statusTick: prev.statusTick + 1 }));
        void reloadRepositories();
      },
      onSelectRepository: (repositoryId) => {
        setState((prev) => {
          const selected = repositoryId === "" ? null : repositoryId;
          if (selected === prev.selectedRepositoryId) return prev;
          return {
            ...prev,
            selectedRepositoryId: selected,
            timeline: createTimelineSlice(),
            changeSet: createChangeSetSlice(),
            diff: createDiffSlice(),
            audit: createAuditSlice(),
            status: null,
            statusError: null,
            statusLoading: false,
            dialog: null
          };
        });
      },
      onSetSource: (source) => setState((prev) => {
        if (prev.source === source) return prev;
        return {
          ...prev,
          source,
          changeSet: createChangeSetSlice(),
          diff: createDiffSlice(),
          audit: { ...prev.audit, selected: null }
        };
      }),
      onTextChange: (text) => setState((prev) => ({ ...prev, filters: { ...prev.filters, text } })),
      onToggleEventType: (eventType) => setState((prev) => {
        const active = prev.filters.eventTypes.includes(eventType);
        const eventTypes = active ? prev.filters.eventTypes.filter((entry) => entry !== eventType) : [...prev.filters.eventTypes, eventType];
        return { ...prev, filters: { ...prev.filters, eventTypes } };
      }),
      onShowAllEventTypes: () => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, eventTypes: [] }
      })),
      onAuthorChange: (author) => setState((prev) => ({ ...prev, filters: { ...prev.filters, author } })),
      onToggleAuthor: () => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, showAuthor: !prev.filters.showAuthor }
      })),
      onClearFilters: () => setState((prev) => ({
        ...prev,
        filters: { text: "", debouncedText: "", eventTypes: [], author: "", showAuthor: prev.filters.showAuthor }
      })),
      onLoadMoreTimeline: () => {
        const snapshot = stateRef.current;
        const repositoryId = snapshot.selectedRepositoryId;
        if (repositoryId === null || snapshot.timeline.loadingMore || !snapshot.timeline.hasMore) return;
        void loadTimeline(repositoryId, snapshot.timeline.cursor);
      },
      onRetryTimeline: () => {
        const snapshot = stateRef.current;
        if (snapshot.selectedRepositoryId !== null) void loadTimeline(snapshot.selectedRepositoryId, null);
      },
      onOpenEvent: (event) => {
        void openEvent(event);
      },
      onBackFromDetail: () => setState((prev) => ({ ...prev, changeSet: createChangeSetSlice() })),
      onOpenFile: (filePath) => {
        void openDiff(filePath);
      },
      onBackFromDiff: () => setState((prev) => ({ ...prev, diff: createDiffSlice() })),
      onCopyDiff: () => {
        void copyDiff();
      },
      onLoadMoreAudit: () => {
        const snapshot = stateRef.current;
        const repositoryId = snapshot.selectedRepositoryId;
        if (repositoryId === null || snapshot.audit.loadingMore || !snapshot.audit.hasMore) return;
        void loadAudit(repositoryId, snapshot.audit.cursor);
      },
      onRetryAudit: () => {
        const snapshot = stateRef.current;
        if (snapshot.selectedRepositoryId !== null) void loadAudit(snapshot.selectedRepositoryId, null);
      },
      onOpenOperation: (attempt) => setState((prev) => ({
        ...prev,
        audit: { ...prev.audit, selected: attempt }
      })),
      onBackFromAuditDetail: () => setState((prev) => ({
        ...prev,
        audit: { ...prev.audit, selected: null }
      })),
      onStartOperation: (operation) => startOperation(operation),
      onDialogClose: () => {
        if (stateRef.current.dialog?.phase === "executing") return;
        if (repreviewTimerRef.current !== null) {
          clearTimeout(repreviewTimerRef.current);
          repreviewTimerRef.current = null;
        }
        setState((prev) => ({ ...prev, dialog: null, copied: false }));
      },
      onDialogMessageChange: (message) => {
        const dialog = stateRef.current.dialog;
        if (dialog === null || dialog.phase === "executing" || dialog.phase === "result") return;
        schedulePreview({ operation: dialog.operation, message, remote: dialog.remote, branch: dialog.branch });
      },
      onDialogRemoteChange: (remote) => {
        const dialog = stateRef.current.dialog;
        if (dialog === null || dialog.phase === "executing" || dialog.phase === "result") return;
        schedulePreview({ operation: dialog.operation, message: dialog.message, remote, branch: dialog.branch });
      },
      onDialogBranchChange: (branch) => {
        const dialog = stateRef.current.dialog;
        if (dialog === null || dialog.phase === "executing" || dialog.phase === "result") return;
        schedulePreview({ operation: dialog.operation, message: dialog.message, remote: dialog.remote, branch });
      },
      onDialogConfirm: () => {
        void confirmOperation();
      },
      onDialogRepreview: () => {
        const dialog = stateRef.current.dialog;
        const repositoryId = stateRef.current.selectedRepositoryId;
        if (dialog === null || repositoryId === null) return;
        if (dialog.phase === "executing") return;
        if (repreviewTimerRef.current !== null) {
          clearTimeout(repreviewTimerRef.current);
          repreviewTimerRef.current = null;
        }
        void runPreview(repositoryId, {
          operation: dialog.operation,
          message: dialog.message,
          remote: dialog.remote,
          branch: dialog.branch
        });
      },
      onRetryStatus: () => setState((prev) => ({ ...prev, statusTick: prev.statusTick + 1 }))
    };
    return renderPanelView({ state, deps, handlers });
  };
}

// src/client/i18n.ts
var zh = {
  "tab.title": "\u4EE3\u7801\u65F6\u95F4\u7EBF",
  "guide.description": "\u67E5\u770B Git/SVN \u5386\u53F2\u3001\u53D8\u66F4\u6587\u4EF6\u4E0E Diff\uFF0C\u4EE5\u53CA\u672C\u63D2\u4EF6\u53D1\u8D77\u7684\u64CD\u4F5C\u5BA1\u8BA1\u3002",
  "common.loading": "\u52A0\u8F7D\u4E2D\u2026",
  "common.loadingMore": "\u52A0\u8F7D\u66F4\u591A\u2026",
  "common.loadMore": "\u52A0\u8F7D\u66F4\u591A",
  "common.retry": "\u91CD\u8BD5",
  "common.back": "\u8FD4\u56DE",
  "common.close": "\u5173\u95ED",
  "common.cancel": "\u53D6\u6D88",
  "common.refresh": "\u5237\u65B0",
  "common.clear": "\u6E05\u9664\u7B5B\u9009",
  "common.none": "\u65E0",
  "common.unknown": "\u672A\u77E5",
  "common.warning": "\u8B66\u544A",
  "common.error": "\u9519\u8BEF",
  "common.empty": "\u6682\u65E0\u5185\u5BB9",
  "common.retryHint": "\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002",
  "common.showingCount": "\u5DF2\u663E\u793A {count} \u6761",
  "common.bytes": "{bytes} \u5B57\u8282",
  "aria.repository": "\u9009\u62E9\u4ED3\u5E93",
  "aria.refresh": "\u5237\u65B0\u4ED3\u5E93\u5217\u8868\u4E0E\u6570\u636E",
  "aria.closeDialog": "\u5173\u95ED\u5BF9\u8BDD\u6846",
  "aria.back": "\u8FD4\u56DE\u5217\u8868",
  "aria.copyDiff": "\u590D\u5236 Diff \u6587\u672C",
  "aria.search": "\u641C\u7D22\u5386\u53F2",
  "aria.author": "\u6309\u4F5C\u8005\u7B5B\u9009",
  "aria.dialog": "{operation} \u786E\u8BA4\u5BF9\u8BDD\u6846",
  "aria.timelineRow": "\u67E5\u770B\u63D0\u4EA4 {label}",
  "aria.auditRow": "\u67E5\u770B\u64CD\u4F5C\u5BA1\u8BA1 {label}",
  "aria.file": "\u67E5\u770B\u6587\u4EF6 Diff {path}",
  "aria.toggleFilters": "\u5C55\u5F00\u6216\u6536\u8D77\u7B5B\u9009",
  "aria.retryStatus": "\u91CD\u8BD5\u8BFB\u53D6\u5DE5\u4F5C\u533A\u72B6\u6001",
  "repo.label": "\u4ED3\u5E93",
  "repo.select": "\u9009\u62E9\u4ED3\u5E93",
  "repo.refresh": "\u5237\u65B0\u4ED3\u5E93\u5217\u8868",
  "repo.empty": "\u672A\u53D1\u73B0 Git/SVN \u4ED3\u5E93",
  "repo.empty.next": "\u6253\u5F00\u4E00\u4E2A\u672C\u8EAB\u662F Git \u6216 SVN \u4ED3\u5E93\u7684\u5DE5\u4F5C\u533A\uFF0C\u7136\u540E\u70B9\u51FB\u5237\u65B0\u3002",
  "repo.noWorkspace": "\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u5DE5\u4F5C\u533A",
  "repo.noWorkspace.hint": "\u5DF2\u5217\u51FA\u6240\u6709\u5DF2\u6CE8\u518C\u5DE5\u4F5C\u533A\u4E2D\u7684\u4ED3\u5E93\uFF1B\u9009\u62E9\u4ED3\u5E93\u540E\u4ECD\u53EF\u67E5\u770B\u5386\u53F2\u3002",
  "repo.branch": "\u5206\u652F",
  "repo.revision": "\u7248\u672C",
  "repo.branchLabel": "\u5206\u652F {branch}",
  "repo.revisionLabel": "\u7248\u672C {revision}",
  "source.timeline": "\u65F6\u95F4\u7EBF",
  "source.audit": "\u5BA1\u8BA1",
  "source.timeline.badge": "\u4ED3\u5E93\u5386\u53F2",
  "source.audit.badge": "\u63D2\u4EF6\u5BA1\u8BA1",
  "source.repository": "\u4ED3\u5E93",
  "source.plugin-audit": "\u63D2\u4EF6\u5BA1\u8BA1",
  "source.external-observation": "\u5916\u90E8\u89C2\u6D4B",
  "source.repository.badge": "\u4ED3\u5E93\u8BB0\u5F55",
  "source.plugin-audit.badge": "\u63D2\u4EF6\u5BA1\u8BA1",
  "source.external-observation.badge": "\u5916\u90E8\u89C2\u6D4B",
  "filter.search.placeholder": "\u641C\u7D22\u63D0\u4EA4\u8BF4\u660E\u6216\u4F5C\u8005",
  "filter.toggle": "\u7B5B\u9009",
  "filter.author": "\u4F5C\u8005",
  "filter.author.placeholder": "\u4F5C\u8005\u540D\u79F0",
  "filter.chip.all": "\u5168\u90E8",
  "filter.chip.commit": "\u63D0\u4EA4",
  "filter.clear": "\u6E05\u9664\u7B5B\u9009",
  "timeline.loading": "\u6B63\u5728\u52A0\u8F7D\u5386\u53F2\u2026",
  "timeline.empty": "\u6B64\u4ED3\u5E93\u6682\u65E0\u5386\u53F2\u8BB0\u5F55",
  "timeline.empty.filtered": "\u6CA1\u6709\u7B26\u5408\u7B5B\u9009\u6761\u4EF6\u7684\u8BB0\u5F55",
  "timeline.partial": "\u90E8\u5206\u6570\u636E\u6E90\u4E0D\u53EF\u7528\uFF0C\u5F53\u524D\u5217\u8868\u53EF\u80FD\u4E0D\u5B8C\u6574\u3002",
  "timeline.more": "\u52A0\u8F7D\u66F4\u591A\u5386\u53F2",
  "timeline.rowLabel": "\u67E5\u770B\u63D0\u4EA4 {label}",
  "timeline.noRevision": "\u6B64\u8BB0\u5F55\u6CA1\u6709\u53EF\u6BD4\u5BF9\u7684\u7248\u672C\u53F7",
  "timeline.count": "\u5171 {count} \u6761\u8BB0\u5F55",
  "detail.title": "\u53D8\u66F4\u8BE6\u60C5",
  "detail.metadata": "\u5143\u6570\u636E",
  "detail.time": "\u65F6\u95F4",
  "detail.author": "\u4F5C\u8005",
  "detail.revision": "\u7248\u672C",
  "detail.branch": "\u5206\u652F",
  "detail.source": "\u6765\u6E90",
  "detail.parents": "\u7236\u63D0\u4EA4",
  "detail.files": "\u53D8\u66F4\u6587\u4EF6",
  "detail.files.count": "{count} \u4E2A\u6587\u4EF6",
  "detail.files.empty": "\u6CA1\u6709\u6587\u4EF6\u53D8\u66F4\u8BB0\u5F55",
  "detail.files.truncated": "\u6587\u4EF6\u5217\u8868\u5DF2\u622A\u65AD\uFF0C\u4EC5\u663E\u793A\u524D\u4E00\u90E8\u5206\u3002",
  "detail.loading": "\u6B63\u5728\u52A0\u8F7D\u53D8\u66F4\u6587\u4EF6\u2026",
  "detail.renameFrom": "\u539F\u8DEF\u5F84\uFF1A{path}",
  "detail.noRevision": "\u6B64\u8BB0\u5F55\u6CA1\u6709\u53EF\u6BD4\u5BF9\u7684\u7248\u672C\u53F7\uFF0C\u65E0\u6CD5\u52A0\u8F7D\u53D8\u66F4\u6587\u4EF6\u3002",
  "detail.additions": "+{count}",
  "detail.deletions": "-{count}",
  "diff.title": "\u6587\u4EF6 Diff",
  "diff.loading": "\u6B63\u5728\u52A0\u8F7D Diff\u2026",
  "diff.binary": "\u4E8C\u8FDB\u5236\u6587\u4EF6\uFF0C\u4E0D\u63D0\u4F9B\u6587\u672C Diff",
  "diff.truncated": "Diff \u5DF2\u622A\u65AD\uFF1A{reason}",
  "diff.truncated.generic": "Diff \u5DF2\u622A\u65AD\uFF0C\u4EC5\u663E\u793A\u90E8\u5206\u5185\u5BB9\u3002",
  "diff.copy": "\u590D\u5236 Diff",
  "diff.copied": "\u5DF2\u590D\u5236",
  "diff.empty": "\u6CA1\u6709\u53EF\u663E\u793A\u7684 Diff \u5185\u5BB9",
  "diff.lines": "{count} \u884C",
  "audit.loading": "\u6B63\u5728\u52A0\u8F7D\u64CD\u4F5C\u5BA1\u8BA1\u2026",
  "audit.empty": "\u672C\u63D2\u4EF6\u5C1A\u672A\u5BF9\u8BE5\u4ED3\u5E93\u6267\u884C\u5199\u64CD\u4F5C",
  "audit.partial": "\u5BA1\u8BA1\u6570\u636E\u53EF\u80FD\u4E0D\u5B8C\u6574\u3002",
  "audit.more": "\u52A0\u8F7D\u66F4\u591A\u5BA1\u8BA1\u8BB0\u5F55",
  "audit.rowLabel": "\u67E5\u770B\u64CD\u4F5C\u5BA1\u8BA1 {label}",
  "audit.detail": "\u64CD\u4F5C\u5BA1\u8BA1\u8BE6\u60C5",
  "audit.state": "\u72B6\u6001",
  "audit.operation": "\u64CD\u4F5C",
  "audit.repository": "\u4ED3\u5E93",
  "audit.startedAt": "\u5F00\u59CB\u65F6\u95F4",
  "audit.finishedAt": "\u7ED3\u675F\u65F6\u95F4",
  "audit.exitCode": "\u9000\u51FA\u7801",
  "audit.errorCode": "\u9519\u8BEF\u7801",
  "audit.safeError": "\u5B89\u5168\u9519\u8BEF\u4FE1\u606F",
  "audit.requestSummary": "\u8BF7\u6C42\u6458\u8981",
  "audit.beforeRevision": "\u6267\u884C\u524D\u7248\u672C",
  "audit.afterRevision": "\u6267\u884C\u540E\u7248\u672C",
  "audit.changedPaths": "\u53D8\u66F4\u8DEF\u5F84",
  "audit.correlationId": "\u5173\u8054 ID",
  "audit.remoteOutcome": "\u8FDC\u7AEF\u7ED3\u679C",
  "audit.unknownResult": "\u7ED3\u679C\u5F85\u786E\u8BA4",
  "audit.unknownResult.hint": "\u8FDC\u7AEF\u662F\u5426\u5DF2\u6267\u884C\u65E0\u6CD5\u786E\u8BA4\uFF1B\u8BF7\u5230\u4ED3\u5E93\u4E2D\u4EBA\u5DE5\u6838\u5BF9\u540E\u518D\u7EE7\u7EED\u3002",
  "audit.remote.confirmed-success": "\u5DF2\u786E\u8BA4\u6210\u529F",
  "audit.remote.confirmed-failure": "\u5DF2\u786E\u8BA4\u5931\u8D25",
  "audit.remote.unknown": "\u7ED3\u679C\u5F85\u786E\u8BA4",
  "audit.count": "\u5171 {count} \u6761\u64CD\u4F5C\u8BB0\u5F55",
  "op.bar.title": "\u5199\u64CD\u4F5C",
  "op.fetch": "Fetch",
  "op.pull": "Pull",
  "op.push": "Push",
  "op.update": "Update",
  "op.commit": "Commit",
  "op.previewing": "\u6B63\u5728\u751F\u6210\u64CD\u4F5C\u9884\u89C8\u2026",
  "op.previewFailed": "\u9884\u89C8\u5931\u8D25\uFF0C\u672A\u6267\u884C\u4EFB\u4F55\u64CD\u4F5C\u3002",
  "op.summary": "\u64CD\u4F5C\u6458\u8981",
  "op.argv": "\u5C06\u6267\u884C\u7684\u547D\u4EE4\u53C2\u6570",
  "op.warnings": "\u8B66\u544A",
  "op.before": "\u6267\u884C\u524D\u72B6\u6001",
  "op.before.branch": "\u5206\u652F",
  "op.before.revision": "\u7248\u672C",
  "op.before.clean": "\u5DE5\u4F5C\u533A",
  "op.before.clean.yes": "\u5E72\u51C0",
  "op.before.clean.no": "\u6709\u672A\u63D0\u4EA4\u53D8\u66F4",
  "op.before.staged": "\u5DF2\u6682\u5B58\u6587\u4EF6",
  "op.before.stagedCount": "{count} \u4E2A",
  "op.before.ahead": "\u9886\u5148\u8FDC\u7AEF",
  "op.before.behind": "\u843D\u540E\u8FDC\u7AEF",
  "op.target": "\u76EE\u6807\u4ED3\u5E93",
  "op.expires": "\u9884\u89C8\u6709\u6548\u671F\u81F3",
  "op.expired": "\u9884\u89C8\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0\u9884\u89C8\u3002",
  "op.confirm": "\u786E\u8BA4\u6267\u884C",
  "op.executing": "\u6B63\u5728\u6267\u884C\u2026",
  "op.repreview": "\u91CD\u65B0\u9884\u89C8",
  "op.blocked": "\u6B64\u64CD\u4F5C\u5F53\u524D\u4E0D\u53EF\u6267\u884C\uFF1A{reason}",
  "op.blocked.generic": "Host \u62D2\u7EDD\u6267\u884C\u6B64\u64CD\u4F5C\u3002",
  "op.result.succeeded": "\u6267\u884C\u6210\u529F",
  "op.result.failed": "\u6267\u884C\u5931\u8D25",
  "op.result.partial": "\u90E8\u5206\u6210\u529F",
  "op.result.unknown": "\u7ED3\u679C\u5F85\u786E\u8BA4",
  "op.result.started": "\u5DF2\u5F00\u59CB",
  "op.result.running": "\u6267\u884C\u4E2D",
  "op.dialogTitle": "{operation} \u786E\u8BA4",
  "op.commit.message": "\u63D0\u4EA4\u4FE1\u606F",
  "op.commit.message.placeholder": "\u63CF\u8FF0\u672C\u6B21\u63D0\u4EA4\u7684\u5185\u5BB9\uFF08\u5FC5\u586B\uFF09",
  "op.commit.message.required": "\u8BF7\u5148\u586B\u5199\u63D0\u4EA4\u4FE1\u606F\u3002",
  "op.commit.stagedOnly": "\u53EA\u4F1A\u63D0\u4EA4\u5DF2\u6682\u5B58\u7684\u53D8\u66F4\uFF1B\u672A\u6682\u5B58\u7684\u4FEE\u6539\u4E0D\u4F1A\u8FDB\u5165\u672C\u6B21\u63D0\u4EA4\u3002",
  "op.commit.stagedCount": "\u5F53\u524D\u5DF2\u6682\u5B58 {count} \u4E2A\u6587\u4EF6",
  "op.commit.noStaged": "\u5F53\u524D\u6CA1\u6709\u5DF2\u6682\u5B58\u7684\u53D8\u66F4\uFF0C\u63D0\u4EA4\u53EF\u80FD\u4F1A\u5931\u8D25\u3002",
  "op.push.remote": "\u8FDC\u7AEF\u540D\u79F0",
  "op.push.branch": "\u5206\u652F",
  "op.push.hint": "Host \u4F1A\u6821\u9A8C\u8FDC\u7AEF\uFF1B\u8FD9\u91CC\u53EA\u586B\u5199\u5DF2\u914D\u7F6E\u7684\u8FDC\u7AEF\u540D\u79F0\u6216\u5206\u652F\uFF0C\u4E0D\u8981\u586B\u5199\u4EFB\u610F\u5730\u5740\u3002",
  "op.executeError": "\u6267\u884C\u8BF7\u6C42\u5931\u8D25\uFF0C\u672A\u81EA\u52A8\u91CD\u8BD5\u3002",
  "op.neverRetry": "\u5199\u64CD\u4F5C\u4E0D\u4F1A\u81EA\u52A8\u91CD\u8BD5\uFF0C\u4E5F\u4E0D\u4F1A\u81EA\u52A8\u6682\u5B58\u6216\u91CD\u7F6E\u3002",
  "op.refreshNote": "\u6267\u884C\u7ED3\u675F\u540E\u5DF2\u5237\u65B0\u65F6\u95F4\u7EBF\u4E0E\u5DE5\u4F5C\u533A\u72B6\u6001\u3002",
  "op.label.status": "\u72B6\u6001\u8BFB\u53D6",
  "op.label.diff": "Diff \u8BFB\u53D6",
  "op.label.commit": "\u63D0\u4EA4",
  "op.label.push": "\u63A8\u9001",
  "op.label.fetch": "\u83B7\u53D6",
  "op.label.pull": "\u62C9\u53D6",
  "op.label.update": "\u66F4\u65B0",
  "op.label.merge": "\u5408\u5E76",
  "op.label.rebase": "\u53D8\u57FA",
  "op.label.switch": "\u5207\u6362",
  "op.label.unknown": "\u672A\u77E5\u64CD\u4F5C",
  "op.state.started": "\u5DF2\u5F00\u59CB",
  "op.state.running": "\u6267\u884C\u4E2D",
  "op.state.succeeded": "\u6210\u529F",
  "op.state.failed": "\u5931\u8D25",
  "op.state.partial": "\u90E8\u5206\u6210\u529F",
  "op.state.unknown": "\u7ED3\u679C\u5F85\u786E\u8BA4",
  "event.commit": "\u63D0\u4EA4",
  "event.push": "\u63A8\u9001",
  "event.fetch": "\u83B7\u53D6",
  "event.pull": "\u62C9\u53D6",
  "event.update": "\u66F4\u65B0",
  "event.merge": "\u5408\u5E76",
  "event.rebase": "\u53D8\u57FA",
  "event.branch": "\u5206\u652F",
  "event.tag": "\u6807\u7B7E",
  "event.switch": "\u5207\u6362",
  "event.unknown": "\u5176\u4ED6",
  "file.status.added": "\u65B0\u589E",
  "file.status.modified": "\u4FEE\u6539",
  "file.status.deleted": "\u5220\u9664",
  "file.status.renamed": "\u91CD\u547D\u540D",
  "file.status.copied": "\u590D\u5236",
  "file.status.type-changed": "\u7C7B\u578B\u53D8\u66F4",
  "file.status.unknown": "\u672A\u77E5",
  "footer.branch": "\u5206\u652F",
  "footer.revision": "\u7248\u672C",
  "footer.clean": "\u5DE5\u4F5C\u533A\u5E72\u51C0",
  "footer.dirty": "\u5DE5\u4F5C\u533A\u6709\u53D8\u66F4",
  "footer.conflicts": "{count} \u4E2A\u51B2\u7A81",
  "footer.git": "Git",
  "footer.svn": "SVN",
  "footer.unavailable": "{tool} \u4E0D\u53EF\u7528",
  "footer.dataDir": "\u6570\u636E\u76EE\u5F55",
  "footer.workspace": "\u5DE5\u4F5C\u533A",
  "footer.version": "\u63D2\u4EF6 {version}",
  "footer.statusLoading": "\u6B63\u5728\u8BFB\u53D6\u5DE5\u4F5C\u533A\u72B6\u6001\u2026",
  "footer.statusError": "\u65E0\u6CD5\u8BFB\u53D6\u5DE5\u4F5C\u533A\u72B6\u6001",
  "footer.noRepo": "\u672A\u9009\u62E9\u4ED3\u5E93",
  "state.missingTool": "\u65E0\u6CD5\u8BFB\u53D6 {vcs} \u5386\u53F2\uFF1A\u672A\u68C0\u6D4B\u5230 {tool} \u5BA2\u6237\u7AEF\u3002\u8BF7\u5B89\u88C5\u540E\u70B9\u51FB\u5237\u65B0\u3002",
  "state.noRepositories": "\u672A\u53D1\u73B0 Git/SVN \u4ED3\u5E93",
  "state.noRepositories.next": "\u6253\u5F00\u4E00\u4E2A\u672C\u8EAB\u662F Git \u6216 SVN \u4ED3\u5E93\u7684\u5DE5\u4F5C\u533A\uFF0C\u7136\u540E\u70B9\u51FB\u5237\u65B0\u3002",
  "error.invalid-request": "\u8BF7\u6C42\u53C2\u6570\u65E0\u6548\uFF0C\u64CD\u4F5C\u672A\u6267\u884C\u3002\u8BF7\u5237\u65B0\u9762\u677F\u540E\u91CD\u8BD5\u3002",
  "error.unknown-repository": "\u627E\u4E0D\u5230\u8BE5\u4ED3\u5E93\uFF0C\u53EF\u80FD\u5DF2\u4ECE\u5217\u8868\u4E2D\u79FB\u9664\u3002\u8BF7\u5237\u65B0\u4ED3\u5E93\u5217\u8868\u540E\u91CD\u65B0\u9009\u62E9\u3002",
  "error.path-not-allowed": "\u8BE5\u8DEF\u5F84\u4E0D\u5728\u5141\u8BB8\u7684\u5DE5\u4F5C\u533A\u5185\uFF0C\u8BF7\u6C42\u5DF2\u88AB\u62D2\u7EDD\u3002\u8BF7\u9009\u62E9\u5DE5\u4F5C\u533A\u5185\u7684\u4ED3\u5E93\u3002",
  "error.vcs-not-installed": "\u672A\u627E\u5230 Git/SVN \u5BA2\u6237\u7AEF\uFF0C\u65E0\u6CD5\u8BFB\u53D6\u5386\u53F2\u6216\u6267\u884C\u64CD\u4F5C\u3002\u8BF7\u5B89\u88C5\u5BF9\u5E94\u547D\u4EE4\u884C\u5DE5\u5177\u540E\u91CD\u8BD5\u3002",
  "error.not-a-repository": "\u8BE5\u76EE\u5F55\u4E0D\u662F\u6709\u6548\u7684 Git/SVN \u4ED3\u5E93\u3002\u8BF7\u6DFB\u52A0\u4ED3\u5E93\u6839\u76EE\u5F55\u540E\u91CD\u8BD5\u3002",
  "error.timeout": "Host \u64CD\u4F5C\u8D85\u65F6\uFF0C\u7ED3\u679C\u672A\u77E5\u3002\u8BF7\u91CD\u65B0\u8BFB\u53D6\u5DE5\u4F5C\u533A\u72B6\u6001\u786E\u8BA4\u540E\u518D\u51B3\u5B9A\u662F\u5426\u91CD\u8BD5\u3002",
  "error.output-too-large": "\u8F93\u51FA\u8D85\u8FC7\u4E0A\u9650\uFF0C\u65E0\u6CD5\u5B8C\u6574\u663E\u793A\u3002\u8BF7\u7F29\u5C0F\u8303\u56F4\uFF08\u4F8B\u5982\u5355\u4E2A\u6587\u4EF6\u6216\u66F4\u5C0F\u7684 Diff\uFF09\u540E\u91CD\u8BD5\u3002",
  "error.conflict": "\u4ED3\u5E93\u5B58\u5728\u51B2\u7A81\uFF0C\u64CD\u4F5C\u5DF2\u505C\u6B62\u3002\u8BF7\u5148\u4EBA\u5DE5\u89E3\u51B3\u51B2\u7A81\uFF0C\u7136\u540E\u91CD\u65B0\u8BFB\u53D6\u72B6\u6001\u3002",
  "error.operation-failed": "\u64CD\u4F5C\u6267\u884C\u5931\u8D25\u3002\u8BF7\u67E5\u770B\u5BA1\u8BA1\u8BE6\u60C5\u4E2D\u7684\u5B89\u5168\u9519\u8BEF\u4FE1\u606F\uFF0C\u4FEE\u6B63\u540E\u91CD\u8BD5\u3002",
  "error.operation-blocked": "Host \u62D2\u7EDD\u6267\u884C\u8BE5\u64CD\u4F5C\u3002\u8BF7\u6309\u9884\u89C8\u4E2D\u7684\u963B\u6B62\u539F\u56E0\u5904\u7406\u540E\u91CD\u8BD5\u3002",
  "error.confirmation-required": "\u7F3A\u5C11\u786E\u8BA4\u4EE4\u724C\uFF0C\u64CD\u4F5C\u672A\u6267\u884C\u3002\u8BF7\u91CD\u65B0\u9884\u89C8\u540E\u786E\u8BA4\u3002",
  "error.confirmation-invalid": "\u786E\u8BA4\u4EE4\u724C\u5DF2\u5931\u6548\u6216\u5DF2\u88AB\u4F7F\u7528\uFF0C\u64CD\u4F5C\u672A\u6267\u884C\u3002\u8BF7\u91CD\u65B0\u9884\u89C8\u540E\u786E\u8BA4\u3002",
  "error.storage-failure": "\u5BA1\u8BA1\u8BB0\u5F55\u65E0\u6CD5\u4FDD\u5B58\uFF0C\u64CD\u4F5C\u53EF\u80FD\u672A\u6267\u884C\u3002\u8BF7\u5237\u65B0\u9875\u9762\u786E\u8BA4\u72B6\u6001\u540E\u518D\u51B3\u5B9A\u662F\u5426\u91CD\u8BD5\u3002",
  "error.network-unknown": "\u65E0\u6CD5\u8FDE\u63A5 Host\uFF0C\u64CD\u4F5C\u7ED3\u679C\u672A\u77E5\u3002\u8BF7\u68C0\u67E5\u8FDE\u63A5\u5E76\u91CD\u65B0\u8BFB\u53D6\u5DE5\u4F5C\u533A\u72B6\u6001\u3002",
  "error.internal": "Host \u5185\u90E8\u9519\u8BEF\uFF0C\u64CD\u4F5C\u53EF\u80FD\u672A\u6267\u884C\u3002\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002",
  "error.generic": "\u8BF7\u6C42\u5931\u8D25\uFF0C\u672A\u6267\u884C\u4EFB\u4F55\u64CD\u4F5C\u3002\u8BF7\u91CD\u8BD5\u3002",
  "error.hostUnavailable": "Host \u8DEF\u7531\u4E0D\u53EF\u7528\uFF0C\u63D2\u4EF6\u53EF\u80FD\u672A\u52A0\u8F7D\u6216\u670D\u52A1\u5DF2\u91CD\u542F\u3002\u8BF7\u5237\u65B0\u9875\u9762\uFF1B\u82E5\u6301\u7EED\u51FA\u73B0\u8BF7\u68C0\u67E5\u63D2\u4EF6\u662F\u5426\u542F\u7528\u3002"
};
var en = {
  "tab.title": "Code Timeline",
  "guide.description": "Git/SVN history, changed files, diffs, and an audit trail of operations this plugin performed.",
  "common.loading": "Loading\u2026",
  "common.loadingMore": "Loading more\u2026",
  "common.loadMore": "Load more",
  "common.retry": "Retry",
  "common.back": "Back",
  "common.close": "Close",
  "common.cancel": "Cancel",
  "common.refresh": "Refresh",
  "common.clear": "Clear filters",
  "common.none": "None",
  "common.unknown": "Unknown",
  "common.warning": "Warning",
  "common.error": "Error",
  "common.empty": "Nothing here",
  "common.retryHint": "Try again in a moment.",
  "common.showingCount": "{count} shown",
  "common.bytes": "{bytes} bytes",
  "aria.repository": "Select repository",
  "aria.refresh": "Refresh repositories and data",
  "aria.closeDialog": "Close dialog",
  "aria.back": "Back to list",
  "aria.copyDiff": "Copy diff text",
  "aria.search": "Search history",
  "aria.author": "Filter by author",
  "aria.dialog": "{operation} confirmation dialog",
  "aria.timelineRow": "View commit {label}",
  "aria.auditRow": "View operation audit {label}",
  "aria.file": "View file diff {path}",
  "aria.toggleFilters": "Expand or collapse filters",
  "aria.retryStatus": "Retry working tree status",
  "repo.label": "Repository",
  "repo.select": "Select repository",
  "repo.refresh": "Refresh repositories",
  "repo.empty": "No Git/SVN repository found",
  "repo.empty.next": "Open a workspace whose directory is a Git or SVN repository, then refresh.",
  "repo.noWorkspace": "This session has no workspace",
  "repo.noWorkspace.hint": "Repositories from every registered workspace are listed; history remains available after selecting one.",
  "repo.branch": "Branch",
  "repo.revision": "Revision",
  "repo.branchLabel": "Branch {branch}",
  "repo.revisionLabel": "Revision {revision}",
  "source.timeline": "Timeline",
  "source.audit": "Audit",
  "source.timeline.badge": "Repository history",
  "source.audit.badge": "Plugin audit",
  "source.repository": "Repository",
  "source.plugin-audit": "Plugin audit",
  "source.external-observation": "External observation",
  "source.repository.badge": "Repo record",
  "source.plugin-audit.badge": "Plugin audit",
  "source.external-observation.badge": "Observed",
  "filter.search.placeholder": "Search summary or author",
  "filter.toggle": "Filters",
  "filter.author": "Author",
  "filter.author.placeholder": "Author name",
  "filter.chip.all": "All",
  "filter.chip.commit": "Commits",
  "filter.clear": "Clear filters",
  "timeline.loading": "Loading history\u2026",
  "timeline.empty": "No history for this repository yet",
  "timeline.empty.filtered": "No entries match the filters",
  "timeline.partial": "Some sources were unavailable; this list may be incomplete.",
  "timeline.more": "Load more history",
  "timeline.rowLabel": "View commit {label}",
  "timeline.noRevision": "This entry has no revision to compare",
  "timeline.count": "{count} entries",
  "detail.title": "Commit details",
  "detail.metadata": "Metadata",
  "detail.time": "Time",
  "detail.author": "Author",
  "detail.revision": "Revision",
  "detail.branch": "Branch",
  "detail.source": "Source",
  "detail.parents": "Parents",
  "detail.files": "Changed files",
  "detail.files.count": "{count} files",
  "detail.files.empty": "No changed files recorded",
  "detail.files.truncated": "The file list is truncated.",
  "detail.loading": "Loading changed files\u2026",
  "detail.renameFrom": "From: {path}",
  "detail.noRevision": "This entry has no revision, so changed files cannot be loaded.",
  "detail.additions": "+{count}",
  "detail.deletions": "-{count}",
  "diff.title": "File diff",
  "diff.loading": "Loading diff\u2026",
  "diff.binary": "Binary file \u2014 no text diff",
  "diff.truncated": "Diff truncated: {reason}",
  "diff.truncated.generic": "Diff truncated; only part is shown.",
  "diff.copy": "Copy diff",
  "diff.copied": "Copied",
  "diff.empty": "No diff text to show",
  "diff.lines": "{count} lines",
  "audit.loading": "Loading operation audit\u2026",
  "audit.empty": "This plugin has not performed write operations on this repository",
  "audit.partial": "Audit data may be incomplete.",
  "audit.more": "Load more audit records",
  "audit.rowLabel": "View audit for {label}",
  "audit.detail": "Operation audit details",
  "audit.state": "State",
  "audit.operation": "Operation",
  "audit.repository": "Repository",
  "audit.startedAt": "Started",
  "audit.finishedAt": "Finished",
  "audit.exitCode": "Exit code",
  "audit.errorCode": "Error code",
  "audit.safeError": "Safe error message",
  "audit.requestSummary": "Request summary",
  "audit.beforeRevision": "Revision before",
  "audit.afterRevision": "Revision after",
  "audit.changedPaths": "Changed paths",
  "audit.correlationId": "Correlation ID",
  "audit.remoteOutcome": "Remote outcome",
  "audit.unknownResult": "Result unconfirmed",
  "audit.unknownResult.hint": "Whether the remote operation applied cannot be confirmed; verify the repository manually before continuing.",
  "audit.remote.confirmed-success": "Confirmed success",
  "audit.remote.confirmed-failure": "Confirmed failure",
  "audit.remote.unknown": "Unconfirmed",
  "audit.count": "{count} operation records",
  "op.bar.title": "Write operations",
  "op.fetch": "Fetch",
  "op.pull": "Pull",
  "op.push": "Push",
  "op.update": "Update",
  "op.commit": "Commit",
  "op.previewing": "Preparing operation preview\u2026",
  "op.previewFailed": "Preview failed; nothing was executed.",
  "op.summary": "Summary",
  "op.argv": "Command arguments",
  "op.warnings": "Warnings",
  "op.before": "State before",
  "op.before.branch": "Branch",
  "op.before.revision": "Revision",
  "op.before.clean": "Working tree",
  "op.before.clean.yes": "Clean",
  "op.before.clean.no": "Dirty",
  "op.before.staged": "Staged files",
  "op.before.stagedCount": "{count}",
  "op.before.ahead": "Ahead",
  "op.before.behind": "Behind",
  "op.target": "Target repository",
  "op.expires": "Preview valid until",
  "op.expired": "The preview expired; preview again.",
  "op.confirm": "Execute",
  "op.executing": "Executing\u2026",
  "op.repreview": "Preview again",
  "op.blocked": "This operation is not allowed: {reason}",
  "op.blocked.generic": "The host refused this operation.",
  "op.result.succeeded": "Succeeded",
  "op.result.failed": "Failed",
  "op.result.partial": "Partially succeeded",
  "op.result.unknown": "Result unconfirmed",
  "op.result.started": "Started",
  "op.result.running": "Running",
  "op.dialogTitle": "Confirm {operation}",
  "op.commit.message": "Commit message",
  "op.commit.message.placeholder": "Describe this commit (required)",
  "op.commit.message.required": "Enter a commit message first.",
  "op.commit.stagedOnly": "Only already-staged changes are committed; unstaged edits are not included.",
  "op.commit.stagedCount": "{count} files are currently staged",
  "op.commit.noStaged": "Nothing is staged; the commit may fail.",
  "op.push.remote": "Remote",
  "op.push.branch": "Branch",
  "op.push.hint": "The host validates the remote; enter a configured remote name or branch, never an arbitrary URL.",
  "op.executeError": "The execute request failed; it was not retried automatically.",
  "op.neverRetry": "Write operations are never retried automatically, and never auto-stash or reset.",
  "op.refreshNote": "Timeline and working tree status were refreshed after the operation finished.",
  "op.label.status": "Status read",
  "op.label.diff": "Diff read",
  "op.label.commit": "Commit",
  "op.label.push": "Push",
  "op.label.fetch": "Fetch",
  "op.label.pull": "Pull",
  "op.label.update": "Update",
  "op.label.merge": "Merge",
  "op.label.rebase": "Rebase",
  "op.label.switch": "Switch",
  "op.label.unknown": "Unknown operation",
  "op.state.started": "Started",
  "op.state.running": "Running",
  "op.state.succeeded": "Succeeded",
  "op.state.failed": "Failed",
  "op.state.partial": "Partially succeeded",
  "op.state.unknown": "Result unconfirmed",
  "event.commit": "Commit",
  "event.push": "Push",
  "event.fetch": "Fetch",
  "event.pull": "Pull",
  "event.update": "Update",
  "event.merge": "Merge",
  "event.rebase": "Rebase",
  "event.branch": "Branch",
  "event.tag": "Tag",
  "event.switch": "Switch",
  "event.unknown": "Other",
  "file.status.added": "Added",
  "file.status.modified": "Modified",
  "file.status.deleted": "Deleted",
  "file.status.renamed": "Renamed",
  "file.status.copied": "Copied",
  "file.status.type-changed": "Type changed",
  "file.status.unknown": "Unknown",
  "footer.branch": "Branch",
  "footer.revision": "Revision",
  "footer.clean": "Clean",
  "footer.dirty": "Dirty",
  "footer.conflicts": "{count} conflicts",
  "footer.git": "Git",
  "footer.svn": "SVN",
  "footer.unavailable": "{tool} unavailable",
  "footer.dataDir": "Data directory",
  "footer.workspace": "Workspace",
  "footer.version": "Plugin {version}",
  "footer.statusLoading": "Reading working tree status\u2026",
  "footer.statusError": "Working tree status unavailable",
  "footer.noRepo": "No repository selected",
  "state.missingTool": "Cannot read {vcs} history: the {tool} client is missing. Install it, then refresh.",
  "state.noRepositories": "No Git/SVN repository found",
  "state.noRepositories.next": "Open a workspace whose directory is a Git or SVN repository, then refresh.",
  "error.invalid-request": "The request was invalid; nothing was executed. Refresh the panel and try again.",
  "error.unknown-repository": "The repository is unknown, possibly removed. Refresh the repository list and select it again.",
  "error.path-not-allowed": "The path is outside the allowed workspaces; the request was refused. Choose a repository inside a workspace.",
  "error.vcs-not-installed": "The Git/SVN client is not installed, so history and operations are unavailable. Install the matching command-line tool and retry.",
  "error.not-a-repository": "The directory is not a valid Git/SVN repository. Add the repository root and retry.",
  "error.timeout": "The host operation timed out and the result is unknown. Re-read the working tree status before retrying.",
  "error.output-too-large": "The output exceeded the limit. Narrow the request, such as a single file or a smaller diff, and retry.",
  "error.conflict": "The repository has conflicts, so the operation stopped. Resolve them manually, then re-read status.",
  "error.operation-failed": "The operation failed. Check the safe error message in the audit detail, fix the cause, then retry.",
  "error.operation-blocked": "The host refused the operation. Address the blocking reason in the preview and retry.",
  "error.confirmation-required": "The confirmation token is missing, so nothing executed. Preview again, then confirm.",
  "error.confirmation-invalid": "The confirmation token is invalid or already used, so nothing executed. Preview again and confirm.",
  "error.storage-failure": "The audit record could not be saved; the operation may not have run. Refresh, check the state, then decide whether to retry.",
  "error.network-unknown": "The host is unreachable and the outcome is unknown. Check the connection and re-read the working tree status.",
  "error.internal": "The host hit an internal error; the operation may not have run. Refresh and retry.",
  "error.generic": "The request failed; nothing was executed. Retry.",
  "error.hostUnavailable": "The host route is unavailable; the plugin may be unloaded or the service restarted. Refresh the page, and check that the plugin is enabled if this persists."
};
function normalizeLocale(raw) {
  return typeof raw === "string" && raw.toLowerCase().startsWith("en") ? "en" : "zh";
}

// src/client/index.ts
var NS = "vcs-timeline";
var TAB_ID = "vcs-timeline";
function service(ctx, name) {
  try {
    return ctx.get?.(name, false);
  } catch {
    return void 0;
  }
}
function sessionIdFor(props) {
  if (typeof props.sessionId === "string" && props.sessionId !== "") return props.sessionId;
  try {
    if (typeof document === "undefined") return void 0;
    const element = document.querySelector("[data-sidebar-right-session]");
    const id = element instanceof HTMLElement ? element.dataset.sidebarRightSession : void 0;
    return id === "" ? void 0 : id;
  } catch {
    return void 0;
  }
}
function resolveCwd(ctx, sessionId) {
  if (sessionId === void 0 || sessionId === "") return null;
  try {
    const sessions = service(ctx, "sessions");
    if (sessions === void 0 || sessions === null) return null;
    const list = sessions.list;
    const candidates = [];
    if (typeof list?.getSnapshot === "function") candidates.push(list.getSnapshot());
    if (typeof sessions.getSnapshot === "function") candidates.push(sessions.getSnapshot());
    if (typeof sessions.list === "function") candidates.push(sessions.list());
    if (list !== void 0) candidates.push(list);
    candidates.push(sessions);
    for (const candidate of candidates) {
      if (typeof candidate !== "object" || candidate === null) continue;
      const byId = candidate.byId;
      if (typeof byId !== "object" || byId === null) continue;
      const entry = byId[sessionId];
      if (typeof entry !== "object" || entry === null) continue;
      const cwd = entry.cwd;
      if (typeof cwd === "string" && cwd !== "") return cwd;
    }
    return null;
  } catch {
    return null;
  }
}
function detectLocale() {
  try {
    if (typeof document !== "undefined") {
      const lang = document.documentElement.lang;
      if (typeof lang === "string" && lang !== "") return normalizeLocale(lang);
    }
    if (typeof navigator !== "undefined") return normalizeLocale(navigator.language);
  } catch {
  }
  return "zh";
}
function apply(ctx) {
  const services = {
    slots: service(ctx, "slots"),
    locale: service(ctx, "locale")
  };
  if (services.slots === void 0) return;
  if (services.locale !== void 0) {
    ctx.effect(() => services.locale.register(NS, { zh, en }), "dsh-vcs-timeline: dictionaries");
  }
  const bound = services.locale?.bind(NS);
  const translate = (key, params) => bound?.(key, params) ?? zh[key] ?? key;
  const api = createVcsApi((url, init) => fetch(url, init));
  const Panel = createTimelinePanel({
    api,
    t: translate,
    locale: detectLocale(),
    resolveWorkspacePath: (props) => resolveCwd(ctx, sessionIdFor(props))
  });
  const panelComponent = (attributes) => React3.createElement(Panel, attributes ?? {});
  ctx.effect(() => {
    const tabs = service(ctx, "sidebarRightTabs");
    if (tabs === void 0 || typeof tabs.register !== "function") return () => {
    };
    const disposeTab = tabs.register({
      id: TAB_ID,
      kind: TAB_ID,
      title: () => translate("tab.title"),
      guide: [{ order: 30, title: () => translate("tab.title"), description: () => translate("guide.description") }]
    });
    return () => disposeTab();
  }, "dsh-vcs-timeline: tab type");
  ctx.effect(() => {
    const slots = services.slots;
    const body = slots.inject("sidebar.right.pane.tab", () => slots.register(
      { name: "sidebar.right.pane.tab", key: TAB_ID, locale: NS },
      panelComponent
    ));
    const title = slots.inject("sidebar.right.pane.tab.title", () => slots.register(
      { name: "sidebar.right.pane.tab.title", key: TAB_ID, locale: NS },
      () => React3.createElement("span", null, translate("tab.title"))
    ));
    return () => {
      body();
      title();
    };
  }, "dsh-vcs-timeline: tab body");
}

    })(module, exports, require);
    return module.exports;
  },
});
