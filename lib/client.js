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
var React12 = __toESM(require("react"), 1);

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
var React11 = __toESM(require("react"), 1);

// src/client/components.ts
var React10 = __toESM(require("react"), 1);

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
function pathsSummary(paths, max = 3) {
  if (!Array.isArray(paths) || paths.length === 0) return "";
  const head = paths.slice(0, max).join(", ");
  return paths.length > max ? `${head} \u2026` : head;
}
function formatCompactTime(iso, locale, now = /* @__PURE__ */ new Date()) {
  if (typeof iso !== "string" || iso.trim() === "") return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    const sameYear = date.getFullYear() === now.getFullYear();
    return new Intl.DateTimeFormat(intlLocale(locale), sameYear ? { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" } : { year: "numeric", month: "numeric", day: "numeric" }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}
function eventStats(event) {
  const metadata = event?.metadata;
  if (metadata === void 0 || metadata === null) return {};
  const number = (key) => {
    const value = metadata[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
  };
  const files = number("filesChanged") ?? number("pathCount");
  const additions = number("additions");
  const deletions = number("deletions");
  const binaryFiles = number("binaryFiles");
  const merged = Array.isArray(event?.parentHashes) && (event?.parentHashes?.length ?? 0) > 1;
  if (merged && (files ?? 0) === 0 && (additions ?? 0) === 0 && (deletions ?? 0) === 0) return {};
  return {
    ...files === void 0 ? {} : { files },
    ...additions === void 0 ? {} : { additions },
    ...deletions === void 0 ? {} : { deletions },
    ...binaryFiles === void 0 || binaryFiles === 0 ? {} : { binaryFiles }
  };
}
function isMergeCommit(event) {
  return Array.isArray(event?.parentHashes) && (event?.parentHashes?.length ?? 0) > 1;
}
function splitRepoPath(path) {
  if (typeof path !== "string" || path === "") return { dir: "", name: "" };
  const index = path.lastIndexOf("/");
  if (index < 0) return { dir: "", name: path };
  return { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}
function diffRows(text) {
  const lines = diffLines(text);
  const rows = [];
  let oldLine = null;
  let newLine = null;
  for (const line of lines) {
    const kind = diffLineKind(line);
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk !== null) {
      oldLine = Number.parseInt(hunk[1] ?? "0", 10);
      newLine = Number.parseInt(hunk[2] ?? "0", 10);
      rows.push({ kind, text: line, oldLine: null, newLine: null });
      continue;
    }
    if (kind === "meta") {
      rows.push({ kind, text: line, oldLine: null, newLine: null });
      continue;
    }
    if (kind === "added") {
      rows.push({ kind, text: line, oldLine: null, newLine });
      if (newLine !== null) newLine += 1;
      continue;
    }
    if (kind === "removed") {
      rows.push({ kind, text: line, oldLine, newLine: null });
      if (oldLine !== null) oldLine += 1;
      continue;
    }
    rows.push({ kind, text: line, oldLine, newLine });
    if (oldLine !== null) oldLine += 1;
    if (newLine !== null) newLine += 1;
  }
  return rows;
}
function fileStats(file) {
  const additions = typeof file.additions === "number" && file.additions >= 0 ? file.additions : null;
  const deletions = typeof file.deletions === "number" && file.deletions >= 0 ? file.deletions : null;
  return { additions, deletions };
}
var TIME_PRESETS = ["all", "24h", "7d", "30d"];
function windowSince(preset, now = Date.now()) {
  if (preset === "all") return void 0;
  const hours = preset === "24h" ? 24 : preset === "7d" ? 24 * 7 : 24 * 30;
  return new Date(now - hours * 60 * 60 * 1e3).toISOString();
}
function timePresetLabel(preset, t) {
  return t(`time.${preset}`);
}
function relativeTime(iso, now = Date.now()) {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at) || !Number.isFinite(now)) return null;
  const seconds = Math.max(0, Math.floor((now - at) / 1e3));
  if (seconds < 60) return { unit: "justNow", count: 0 };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", count: hours };
  const days = Math.floor(hours / 24);
  if (days < 7) return { unit: "days", count: days };
  return null;
}
function localDayKey(iso) {
  if (typeof iso !== "string" || iso.trim() === "") return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function dayLabel(iso, locale, now = /* @__PURE__ */ new Date()) {
  const key = localDayKey(iso);
  if (key === null) return { kind: "date", text: "" };
  const today = localDayKey(now.toISOString());
  const yesterday = localDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1e3).toISOString());
  if (key === today) return { kind: "today", text: "" };
  if (key === yesterday) return { kind: "yesterday", text: "" };
  const date = new Date(iso);
  const sameYear = date.getFullYear() === now.getFullYear();
  try {
    return {
      kind: "date",
      text: new Intl.DateTimeFormat(intlLocale(locale), {
        ...sameYear ? {} : { year: "numeric" },
        month: "numeric",
        day: "numeric",
        weekday: "short"
      }).format(date)
    };
  } catch {
    return { kind: "date", text: key };
  }
}
function authorInitials(actor) {
  if (typeof actor !== "string") return "?";
  const trimmed = actor.trim();
  if (trimmed === "") return "?";
  const parts = trimmed.split(/\s+/).filter((part) => part !== "");
  if (parts.length === 0) return "?";
  const first = parts[0] ?? trimmed;
  const second = parts.length > 1 ? parts[parts.length - 1] ?? "" : "";
  const initials = second === "" ? first.slice(0, 1) : `${first.slice(0, 1)}${second.slice(0, 1)}`;
  return initials.toUpperCase();
}
function authorHue(actor) {
  const text = typeof actor === "string" && actor !== "" ? actor : "?";
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = hash * 31 + text.charCodeAt(index) | 0;
  }
  return Math.abs(hash) % 360;
}

// src/client/file-index.ts
function eventFiles(event) {
  if (event === null || event === void 0) return null;
  return Array.isArray(event.changedFiles) ? event.changedFiles : null;
}
function reportsFiles(events) {
  return events.some((event) => Array.isArray(event.changedFiles));
}
function reportedNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
function aggregateChangedFiles(events) {
  const byPath = /* @__PURE__ */ new Map();
  for (const event of events) {
    const files = eventFiles(event);
    if (files === null) continue;
    for (const file of files) {
      const path = typeof file.path === "string" ? file.path : "";
      if (path === "") continue;
      const additions = reportedNumber(file.additions);
      const deletions = reportedNumber(file.deletions);
      const known = byPath.get(path);
      if (known === void 0) {
        byPath.set(path, {
          path,
          ...typeof file.oldPath === "string" && file.oldPath !== "" && file.oldPath !== path ? { oldPath: file.oldPath } : {},
          status: file.status,
          changes: 1,
          additions: additions ?? 0,
          deletions: deletions ?? 0,
          binary: file.binary === true,
          lastEventId: event.id,
          lastTimestamp: event.timestamp,
          lastSummary: event.summary,
          ...typeof event.actor === "string" && event.actor !== "" ? { lastActor: event.actor } : {}
        });
        continue;
      }
      known.changes += 1;
      known.additions += additions ?? 0;
      known.deletions += deletions ?? 0;
      known.binary = known.binary || file.binary === true;
    }
  }
  return [...byPath.values()];
}
function statusCounts(entries) {
  const counts = { all: entries.length, added: 0, modified: 0, deleted: 0, renamed: 0 };
  for (const entry of entries) {
    switch (entry.status) {
      case "added":
        counts.added += 1;
        break;
      case "modified":
        counts.modified += 1;
        break;
      case "deleted":
        counts.deleted += 1;
        break;
      case "renamed":
      case "copied":
        counts.renamed += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}
function filterFileEntries(entries, query, status) {
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  return entries.filter((entry) => {
    if (status !== "all" && entry.status !== status) return false;
    if (needle === "") return true;
    return entry.path.toLowerCase().includes(needle) || entry.oldPath !== void 0 && entry.oldPath.toLowerCase().includes(needle);
  });
}
function compareNodes(left, right) {
  if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
  return left.name.localeCompare(right.name, void 0, { sensitivity: "base", numeric: true });
}
function insertFile(roots, entry) {
  const segments = entry.path.split("/").filter((segment) => segment !== "");
  const name = segments[segments.length - 1] ?? entry.path;
  let level = roots;
  let path = "";
  for (const segment of segments.slice(0, -1)) {
    path = path === "" ? segment : `${path}/${segment}`;
    const existing = level.find((node) => node.kind === "dir" && node.path === path);
    if (existing !== void 0 && existing.kind === "dir") {
      existing.count += 1;
      level = existing.children;
      continue;
    }
    const dir = { kind: "dir", name: segment, path, count: 1, children: [] };
    level.push(dir);
    level = dir.children;
  }
  level.push({ kind: "file", name, path: entry.path, entry });
}
function buildFileTree(entries) {
  const roots = [];
  for (const entry of entries) insertFile(roots, entry);
  const sortLevel = (nodes) => {
    nodes.sort(compareNodes);
    for (const node of nodes) if (node.kind === "dir") sortLevel(node.children);
  };
  sortLevel(roots);
  return roots;
}
function eventsForFile(events, path) {
  return events.filter((event) => {
    const files = eventFiles(event);
    return files !== null && files.some((file) => file.path === path);
  });
}
function eventsHavingFiles(events, paths) {
  if (paths.size === 0) return [];
  return events.filter((event) => {
    const files = eventFiles(event);
    return files !== null && files.some((file) => paths.has(file.path));
  });
}
function directoryPaths(nodes) {
  const paths = [];
  const walk = (level) => {
    for (const node of level) {
      if (node.kind !== "dir") continue;
      paths.push(node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  return paths;
}
function dayKeyOf(timestamp) {
  return localDayKey(timestamp) ?? timestamp;
}
function groupEventsByDay(events) {
  const groups = [];
  let current = null;
  for (const event of events) {
    const key = dayKeyOf(event.timestamp);
    if (current === null || current.key !== key) {
      current = { key, timestamp: event.timestamp, events: [] };
      groups.push(current);
    }
    current.events.push(event);
  }
  return groups;
}
function buildTimelineView(events, filters) {
  const filesReported = reportsFiles(events);
  const files = aggregateChangedFiles(events);
  const visibleFiles = filterFileEntries(files, filters.query, filters.status);
  const tree = buildFileTree(visibleFiles);
  const selected = filters.selectedPath === null ? null : visibleFiles.find((entry) => entry.path === filters.selectedPath) ?? null;
  let visibleEvents;
  if (!filesReported) visibleEvents = [...events];
  else if (filters.selectedPath !== null) {
    visibleEvents = eventsForFile(events, filters.selectedPath);
  } else if (filters.query.trim() !== "" || filters.status !== "all") {
    visibleEvents = eventsHavingFiles(events, new Set(visibleFiles.map((entry) => entry.path)));
  } else {
    visibleEvents = [...events];
  }
  let additions = 0;
  let deletions = 0;
  for (const entry of visibleFiles) {
    additions += entry.additions;
    deletions += entry.deletions;
  }
  return {
    filesReported,
    files,
    visibleFiles,
    tree,
    visibleEvents,
    selected,
    totals: { files: visibleFiles.length, commits: visibleEvents.length, additions, deletions }
  };
}

// src/client/styles.ts
var STYLES = `
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
.dvt-tl-row { position: relative; display: flex; align-items: stretch; }
.dvt-tl-row:hover { background: var(--dsw-alias-interactive-hover); }
.dvt-tl-rail { position: relative; flex: 0 0 auto; width: 26px; }
.dvt-tl-rail::before {
  content: ""; position: absolute; left: 50%; top: 0; bottom: 0; width: 2px;
  transform: translateX(-1px);
  background: var(--dsw-alias-brand-primary); opacity: .5;
}
.dvt-tl-group:first-child .dvt-tl-row:first-child .dvt-tl-rail::before { top: 18px; }
.dvt-tl-group:last-child .dvt-tl-row:last-child .dvt-tl-rail::before { bottom: calc(100% - 18px); }
.dvt-tl-node {
  position: absolute; left: 50%; top: 13px; width: 11px; height: 11px;
  transform: translateX(-50%); border-radius: 50%;
  background: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-base);
}
.dvt-tl-node-merge {
  background: var(--dsw-alias-bg-base);
  border: 2px solid var(--dsw-alias-brand-primary);
}
.dvt-tl-card {
  flex: 1 1 auto; display: flex; flex-direction: column; gap: 2px; min-width: 0;
  padding: 8px 10px 8px 2px; border: 0; background: transparent; text-align: left; cursor: pointer;
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
`;

// src/client/ui/audit.ts
var React4 = __toESM(require("react"), 1);

// src/client/ui/icons.ts
var React = __toESM(require("react"), 1);
var h = React.createElement;
function icon(name, children) {
  function Icon(props) {
    const size = props.size ?? 14;
    return h("svg", {
      width: size,
      height: size,
      viewBox: "0 0 16 16",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.4,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      focusable: "false",
      ...props.className === void 0 ? {} : { className: props.className },
      "data-dvt-icon": name
    }, children);
  }
  Icon.displayName = `DvtIcon${name}`;
  return Icon;
}
var IconRefresh = icon("refresh", [
  h("path", { key: "a", d: "M13.2 7.2A5.4 5.4 0 1 0 13 10" }),
  h("path", { key: "b", d: "M13.4 3.6v3.8H9.6" })
]);
var IconChevronDown = icon("chevron-down", [
  h("path", { key: "a", d: "M4.2 6.2 8 10l3.8-3.8" })
]);
var IconChevronRight = icon("chevron-right", [
  h("path", { key: "a", d: "M6.2 4.2 10 8l-3.8 3.8" })
]);
var IconBack = icon("back", [
  h("path", { key: "a", d: "M9.6 3.6 5.2 8l4.4 4.4" })
]);
var IconClose = icon("close", [
  h("path", { key: "a", d: "M4 4l8 8" }),
  h("path", { key: "b", d: "M12 4l-8 8" })
]);
var IconMore = icon("more", [
  h("circle", { key: "a", cx: 3.4, cy: 8, r: 0.9, fill: "currentColor", stroke: "none" }),
  h("circle", { key: "b", cx: 8, cy: 8, r: 0.9, fill: "currentColor", stroke: "none" }),
  h("circle", { key: "c", cx: 12.6, cy: 8, r: 0.9, fill: "currentColor", stroke: "none" })
]);
var IconSearch = icon("search", [
  h("circle", { key: "a", cx: 7, cy: 7, r: 3.9 }),
  h("path", { key: "b", d: "M10.1 10.1 13.6 13.6" })
]);
var IconFilter = icon("filter", [
  h("path", { key: "a", d: "M2.6 3.6h10.8L9.2 8.3v4.1l-2.4-1.3V8.3z" })
]);
var IconCheck = icon("check", [
  h("path", { key: "a", d: "M3.4 8.4 6.4 11.4 12.6 4.6" })
]);
var IconWarning = icon("warning", [
  h("path", { key: "a", d: "M8 2.6 14 12.8H2z" }),
  h("path", { key: "b", d: "M8 6.4v3.2" }),
  h("path", { key: "c", d: "M8 11.4h.01" })
]);
var IconError = icon("error", [
  h("circle", { key: "a", cx: 8, cy: 8, r: 5.6 }),
  h("path", { key: "b", d: "M8 5v3.6" }),
  h("path", { key: "c", d: "M8 11h.01" })
]);
var IconCommit = icon("commit", [
  h("circle", { key: "a", cx: 8, cy: 8, r: 2.8 }),
  h("path", { key: "b", d: "M8 1.6v3.6" }),
  h("path", { key: "c", d: "M8 10.8v3.6" })
]);
var IconMerge = icon("merge", [
  h("circle", { key: "a", cx: 8, cy: 11.4, r: 2.2 }),
  h("circle", { key: "b", cx: 8, cy: 4.4, r: 1.8 }),
  h("path", { key: "c", d: "M3.2 3.4c0 3.4 3.4 3 4.8 4.4" }),
  h("path", { key: "d", d: "M8 6.2v3" })
]);
var IconBranch = icon("branch", [
  h("circle", { key: "a", cx: 5, cy: 3.4, r: 1.7 }),
  h("circle", { key: "b", cx: 5, cy: 12.6, r: 1.7 }),
  h("circle", { key: "c", cx: 11.4, cy: 5.4, r: 1.7 }),
  h("path", { key: "d", d: "M5 5.1v5.8" }),
  h("path", { key: "e", d: "M11.4 7.1c0 2.6-2.6 2.4-6.4 3.6" })
]);
var IconFile = icon("file", [
  h("path", { key: "a", d: "M4 2.2h5l3 3v8.6H4z" }),
  h("path", { key: "b", d: "M9 2.2v3.2h3" })
]);
var IconDiff = icon("diff", [
  h("path", { key: "a", d: "M4.4 2.4v11.2" }),
  h("path", { key: "b", d: "M9.4 5.4h3.2" }),
  h("path", { key: "c", d: "M9.4 8h3.2" }),
  h("path", { key: "d", d: "M9.4 10.6h3.2" })
]);
var IconCopy = icon("copy", [
  h("rect", { key: "a", x: 5.4, y: 5.4, width: 7.4, height: 8, rx: 1.4 }),
  h("path", { key: "b", d: "M10.6 5.4V4A1.4 1.4 0 0 0 9.2 2.6H4.4A1.4 1.4 0 0 0 3 4v6a1.4 1.4 0 0 0 1.4 1.4h1" })
]);
var IconClock = icon("clock", [
  h("circle", { key: "a", cx: 8, cy: 8, r: 5.6 }),
  h("path", { key: "b", d: "M8 4.8V8l2.4 1.6" })
]);
var IconUser = icon("user", [
  h("circle", { key: "a", cx: 8, cy: 5.6, r: 2.4 }),
  h("path", { key: "b", d: "M3.6 13.2c.6-2.4 2.3-3.6 4.4-3.6s3.8 1.2 4.4 3.6" })
]);
var IconRepo = icon("repo", [
  h("path", { key: "a", d: "M2.4 4.2A1.2 1.2 0 0 1 3.6 3h3l1.4 1.6h4.4a1.2 1.2 0 0 1 1.2 1.2v6A1.2 1.2 0 0 1 12.4 13H3.6a1.2 1.2 0 0 1-1.2-1.2z" })
]);
var IconSliders = icon("sliders", [
  h("path", { key: "a", d: "M3 4.4h10" }),
  h("path", { key: "b", d: "M3 8h10" }),
  h("path", { key: "c", d: "M3 11.6h10" }),
  h("circle", { key: "d", cx: 5.6, cy: 4.4, r: 1.3, fill: "currentColor", stroke: "none" }),
  h("circle", { key: "e", cx: 10.4, cy: 8, r: 1.3, fill: "currentColor", stroke: "none" }),
  h("circle", { key: "f", cx: 7, cy: 11.6, r: 1.3, fill: "currentColor", stroke: "none" })
]);
var IconTimeline = icon("timeline", [
  h("path", { key: "a", d: "M3.2 3.6v8.8" }),
  h("circle", { key: "b", cx: 3.2, cy: 4.4, r: 1.2, fill: "currentColor", stroke: "none" }),
  h("circle", { key: "c", cx: 3.2, cy: 8, r: 1.2, fill: "currentColor", stroke: "none" }),
  h("circle", { key: "d", cx: 3.2, cy: 11.6, r: 1.2, fill: "currentColor", stroke: "none" }),
  h("path", { key: "e", d: "M6.4 4.4h6.4" }),
  h("path", { key: "f", d: "M6.4 8h6.4" }),
  h("path", { key: "g", d: "M6.4 11.6h6.4" })
]);
var IconAudit = icon("audit", [
  h("path", { key: "a", d: "M8 2.2 13 4v4.2c0 2.8-2.1 4.7-5 5.6-2.9-.9-5-2.8-5-5.6V4z" }),
  h("path", { key: "b", d: "M5.8 7.8 7.4 9.4l3-3.2" })
]);
var IconDownload = icon("download", [
  h("path", { key: "a", d: "M8 2.6v7.2" }),
  h("path", { key: "b", d: "M5 7.4 8 10.4 11 7.4" }),
  h("path", { key: "c", d: "M3.4 13.2h9.2" })
]);
var IconUpload = icon("upload", [
  h("path", { key: "a", d: "M8 10.4V3.2" }),
  h("path", { key: "b", d: "M5 6.2 8 3.2 11 6.2" }),
  h("path", { key: "c", d: "M3.4 13.2h9.2" })
]);
var IconFolder = icon("folder", [
  h("path", { key: "a", d: "M2.2 4A1.2 1.2 0 0 1 3.4 2.8h2.7l1.3 1.5h5.2A1.2 1.2 0 0 1 13.8 5.5v6A1.2 1.2 0 0 1 12.6 12.7H3.4A1.2 1.2 0 0 1 2.2 11.5z" })
]);
var IconFolderOpen = icon("folder-open", [
  h("path", { key: "a", d: "M2.2 4A1.2 1.2 0 0 1 3.4 2.8h2.7l1.3 1.5h4.2A1.2 1.2 0 0 1 12.8 5.5v.7" }),
  h("path", { key: "b", d: "M2.2 6.4h11.4l-1.3 5.1a1.2 1.2 0 0 1-1.2 1.2H3.4A1.2 1.2 0 0 1 2.2 11.5z" })
]);
var IconExpandAll = icon("expand-all", [
  h("path", { key: "a", d: "M4.6 3.4 8 6.6l3.4-3.2" }),
  h("path", { key: "b", d: "M4.6 9 8 12.2 11.4 9" })
]);
var IconCollapseAll = icon("collapse-all", [
  h("path", { key: "a", d: "M4.6 6.6 8 3.4l3.4 3.2" }),
  h("path", { key: "b", d: "M4.6 12.2 8 9l3.4 3.2" })
]);

// src/client/ui/primitives.ts
var React2 = __toESM(require("react"), 1);
var h2 = React2.createElement;
function IconButton(props) {
  const Icon = props.icon;
  return h2("button", {
    type: "button",
    className: `dvt-iconbtn${props.extraClass === void 0 ? "" : ` ${props.extraClass}`}`,
    "aria-label": props.label,
    title: props.label,
    ...props.expanded === void 0 ? {} : { "aria-expanded": props.expanded },
    ...props.pressed === void 0 ? {} : { "aria-pressed": props.pressed },
    ...props.disabled === void 0 ? {} : { disabled: props.disabled },
    ...props.onClick === void 0 ? {} : { onClick: props.onClick }
  }, h2(Icon, { size: 14 }));
}
function Banner(props) {
  const Icon = props.kind === "error" ? IconError : IconWarning;
  return h2(
    "div",
    {
      key: props.key,
      className: `dvt-banner dvt-banner-${props.kind}`,
      role: props.kind === "error" ? "alert" : "status"
    },
    h2("span", { className: "dvt-banner-icon" }, h2(Icon, { size: 13 })),
    h2(
      "span",
      { className: "dvt-banner-text" },
      props.title === void 0 ? null : h2("span", { className: "dvt-banner-title" }, `${props.title} `),
      props.text
    ),
    props.action ?? null,
    props.onDismiss === void 0 ? null : h2("button", {
      type: "button",
      className: "dvt-iconbtn",
      style: { width: 18, height: 18 },
      "aria-label": props.dismissLabel ?? "Close",
      onClick: props.onDismiss
    }, h2(IconClose, { size: 11 }))
  );
}
function EmptyState(props) {
  const Icon = props.icon;
  const tone = props.tone ?? "neutral";
  return h2(
    "div",
    { className: "dvt-state" },
    h2(
      "span",
      { className: `dvt-state-icon${tone === "error" ? " dvt-state-icon-error" : tone === "warn" ? " dvt-state-icon-warn" : ""}` },
      h2(Icon, { size: 16 })
    ),
    h2("span", { className: "dvt-state-title" }, props.title),
    props.hint === void 0 || props.hint === "" ? null : h2("span", { className: "dvt-state-hint" }, props.hint),
    props.actions === void 0 ? null : h2("span", { className: "dvt-state-actions" }, props.actions)
  );
}
function SkeletonRows(props) {
  const rows = props.rows ?? 5;
  return h2(
    "div",
    { className: "dvt-skeleton", "aria-busy": "true" },
    Array.from({ length: rows }, (_, index) => h2(
      "div",
      { key: index, className: "dvt-skel-row" },
      h2("span", { className: "dvt-skel-dot" }),
      h2("span", { className: "dvt-skel-line" }),
      h2("span", { className: "dvt-skel-line short" })
    ))
  );
}
function SectionHeader(props) {
  return h2(
    "div",
    { className: "dvt-section-head" },
    h2("span", { className: "dvt-section-title" }, props.title),
    props.count === void 0 ? null : h2("span", { className: "dvt-section-count" }, props.count),
    props.trailing === void 0 ? null : props.trailing
  );
}
function Progress(props) {
  return h2(
    "div",
    { className: "dvt-progress", role: "status" },
    h2("span", { className: "dvt-spinner" }),
    h2("span", null, props.label)
  );
}
function errorText(error, t) {
  return errorMessage(error, t);
}
function StateBadge(props) {
  const state = props.state;
  const tone = state === "succeeded" ? "success" : state === "failed" ? "error" : state === "unknown" || state === "partial" ? "warn" : "";
  return h2(
    "span",
    { className: `dvt-badge${tone === "" ? "" : ` dvt-badge-${tone}`}` },
    operationStateLabel(state, props.t)
  );
}
function SourceBadge(props) {
  return h2("span", { className: "dvt-badge dvt-badge-source" }, sourceLabel(props.source, props.t));
}
function LineStats(props) {
  const additions = props.additions;
  const deletions = props.deletions;
  const hasAdd = typeof additions === "number";
  const hasDel = typeof deletions === "number";
  if (!hasAdd && !hasDel) return null;
  return h2(
    "span",
    { className: "dvt-commit-stats" },
    hasAdd ? h2("span", { className: "dvt-stat-add", title: props.t("detail.additions", { count: additions }) }, `+${additions}`) : null,
    hasDel ? h2("span", { className: "dvt-stat-del", title: props.t("detail.deletions", { count: deletions }) }, `\u2212${deletions}`) : null
  );
}
function fileCountLabel(count, t) {
  return count === 1 ? t("timeline.stats.file") : t("timeline.stats.files", { count });
}
function DotSep() {
  return h2("span", { className: "dvt-dot-sep", "aria-hidden": "true" }, "\xB7");
}

// src/client/ui/shared.ts
var WRITE_OPERATIONS = {
  git: ["fetch", "pull", "push", "commit"],
  svn: ["update", "commit"]
};
function operationGroup(operation) {
  if (operation === "commit") return "commit";
  if (operation === "push") return "remote";
  return "sync";
}
function vcsLabel(vcsType, t) {
  return vcsType === "git" ? t("footer.git") : t("footer.svn");
}
function selectedRepository(state) {
  if (state.selectedRepositoryId === null) return null;
  return state.repositories.find((repository) => repository.id === state.selectedRepositoryId) ?? null;
}
function hasActiveFilters(state) {
  return state.filters.debouncedText.trim() !== "" || state.filters.eventTypes.length > 0 || state.filters.author.trim() !== "" || state.filters.treeQuery.trim() !== "" || state.filters.fileStatus !== "all" || state.filters.timePreset !== "all" || state.selectedFilePath !== null;
}
function missingTool(state, repository) {
  if (repository === null || state.diagnostics === null) return null;
  if (repository.vcsType === "git" && state.diagnostics.gitVersion === null) return "git";
  if (repository.vcsType === "svn" && state.diagnostics.svnVersion === null) return "svn";
  return null;
}
function isUninitializedHistory(state, repository) {
  if (repository === null) return false;
  if (repository.currentRevision === void 0 || repository.currentRevision === "") return true;
  return state.timeline.warnings.some((warning) => /no commits? yet|does not have any commits/i.test(warning));
}

// src/client/ui/detail.ts
var React3 = __toESM(require("react"), 1);
var h3 = React3.createElement;
function Subbar(props) {
  return h3(
    "div",
    { className: "dvt-subbar" },
    h3(IconButton, { label: props.backLabel, icon: IconBack, onClick: props.onBack }),
    h3("span", { className: "dvt-subbar-title dvt-clip", title: props.title }, props.title),
    props.subtitle === void 0 || props.subtitle === "" ? null : h3("span", { className: "dvt-subbar-sub dvt-mono" }, props.subtitle),
    props.trailing ?? null
  );
}
function totals(files) {
  let additions = 0;
  let deletions = 0;
  let sawAdditions = false;
  let sawDeletions = false;
  for (const file of files) {
    if (typeof file.additions === "number") {
      additions += file.additions;
      sawAdditions = true;
    }
    if (typeof file.deletions === "number") {
      deletions += file.deletions;
      sawDeletions = true;
    }
  }
  return { additions: sawAdditions ? additions : null, deletions: sawDeletions ? deletions : null };
}
function FileRow(props) {
  const { file, index, t, handlers } = props;
  const { dir, name } = splitRepoPath(file.path);
  const { additions, deletions } = fileStats(file);
  return h3(
    "li",
    { className: "dvt-file" },
    h3(
      "button",
      {
        type: "button",
        className: "dvt-file-btn",
        title: file.oldPath === void 0 ? file.path : `${file.oldPath} \u2192 ${file.path}`,
        onClick: () => handlers.onOpenFile(file.path)
      },
      h3("span", {
        className: `dvt-file-status dvt-status-${file.status}`,
        "aria-label": statusLabel(file.status, t),
        title: statusLabel(file.status, t)
      }, statusLetter(file.status)),
      h3(
        "span",
        { className: "dvt-file-path" },
        file.oldPath === void 0 ? null : h3("span", { className: "dvt-file-old" }, `${file.oldPath} \u2192 `),
        dir === "" ? null : h3("span", { className: "dvt-file-dir" }, dir),
        h3("span", { className: "dvt-file-name" }, name)
      ),
      h3(
        "span",
        { className: "dvt-file-stats" },
        h3(LineStats, {
          ...additions === null ? {} : { additions },
          ...deletions === null ? {} : { deletions },
          t
        }),
        file.binary === true ? h3("span", { className: "dvt-bin", title: t("diff.binary") }, "BIN") : null
      ),
      h3("span", { className: "dvt-sr-only" }, `#${index + 1}`)
    )
  );
}
function MetaGrid(props) {
  const { event, deps } = props;
  const { t } = deps;
  const rows = [];
  const time = formatTime(event.timestamp, deps.locale);
  rows.push([t("detail.time"), time === "" ? t("common.unknown") : time, false]);
  rows.push([t("detail.author"), event.actor === void 0 || event.actor === "" ? t("common.unknown") : event.actor, false]);
  const revision = event.revision ?? event.commitHash;
  if (revision !== void 0 && revision !== "") {
    rows.push([t("detail.revision"), event.revision === void 0 ? shortHash(revision, 12) : `r${revision}`, true]);
  }
  if (event.branch !== void 0 && event.branch !== "") rows.push([t("detail.branch"), event.branch, false]);
  if (event.parentHashes !== void 0 && event.parentHashes.length > 0) {
    rows.push([t("detail.parents"), event.parentHashes.map((parent) => shortHash(parent, 7)).join(", "), true]);
  }
  rows.push([t("detail.source"), sourceLabel(event.source, t), false]);
  return h3(
    "dl",
    { className: "dvt-meta" },
    rows.flatMap(([key, value, mono]) => [
      h3("dt", { key: `${key}-k`, className: "dvt-meta-key" }, key),
      h3("dd", { key: `${key}-v`, className: `dvt-meta-val${mono ? " mono" : ""}` }, value)
    ])
  );
}
function commitDetailHeader(state, deps, handlers) {
  const { t } = deps;
  const event = state.changeSet.event;
  const revision = event === null ? "" : event.revision ?? event.commitHash ?? "";
  return h3(Subbar, {
    onBack: handlers.onBackFromDetail,
    backLabel: t("aria.back"),
    title: shortHash(revision, 12) === "" ? t("detail.title") : shortHash(revision, 12),
    trailing: event === null ? null : h3(SourceBadge, { source: event.source, t })
  });
}
function commitDetailBody(state, deps, handlers) {
  const { t } = deps;
  const event = state.changeSet.event;
  if (event === null) {
    return h3(EmptyState, { icon: IconFile, title: t("common.empty") });
  }
  const revision = event.revision ?? event.commitHash ?? "";
  const merge = isMergeCommit(event);
  const files = state.changeSet.data?.files ?? [];
  const sums = totals(files);
  return h3(
    "div",
    { className: "dvt-col" },
    h3(
      "div",
      { className: "dvt-hero" },
      h3("div", { className: "dvt-hero-summary" }, truncate(event.summary, 500) === "" ? t("timeline.noRevision") : event.summary),
      h3(
        "div",
        { className: "dvt-hero-meta" },
        merge ? h3("span", { className: "dvt-tag dvt-tag-merge" }, h3(IconMerge, { size: 10 }), h3("span", null, t("timeline.merge"))) : null,
        event.branch === void 0 || event.branch === "" ? null : h3(
          "span",
          { className: "dvt-tag", title: event.branch },
          h3("span", null, truncate(event.branch, 22))
        ),
        h3("span", { className: "dvt-mono" }, `#${shortHash(revision, 9)}`)
      )
    ),
    h3(MetaGrid, { event, deps }),
    h3(
      "div",
      { className: "dvt-section" },
      h3(SectionHeader, {
        title: t("detail.files.header"),
        count: state.changeSet.data === null ? void 0 : truncate(t("detail.files.stats", { files: files.length }), 40),
        trailing: sums.additions === null && sums.deletions === null ? state.changeSet.data === null ? void 0 : h3("span", { className: "dvt-section-count" }, t("detail.stats.unavailable")) : h3(
          "span",
          { className: "dvt-section-stats" },
          h3(LineStats, {
            ...sums.additions === null ? {} : { additions: sums.additions },
            ...sums.deletions === null ? {} : { deletions: sums.deletions },
            t
          })
        )
      }),
      state.changeSet.loading ? h3(SkeletonRows, { rows: 3 }) : null,
      state.changeSet.error !== null ? h3(Banner, {
        kind: "error",
        text: errorText(state.changeSet.error, t),
        action: h3("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: () => handlers.onOpenEvent(event) }, t("common.retry"))
      }) : null,
      state.changeSet.loading || state.changeSet.data === null ? null : files.length === 0 ? h3("div", { className: "dvt-state-hint", style: { padding: "8px 10px" } }, t("detail.emptyFiles")) : h3(
        "ul",
        { className: "dvt-files", "aria-label": t("detail.files.header") },
        files.map((file, index) => h3(FileRow, { key: `${file.path}:${index}`, file, index, t, handlers }))
      )
    )
  );
}
function diffHeader(state, deps, handlers) {
  const { t } = deps;
  const path = state.diff.filePath ?? "";
  const { dir, name } = splitRepoPath(path);
  const hasText = state.diff.data !== null && state.diff.data.binary !== true && state.diff.data.text.trim() !== "";
  return h3(Subbar, {
    onBack: handlers.onBackFromDiff,
    backLabel: t("aria.back"),
    title: name === "" ? t("diff.title") : name,
    subtitle: dir === "" ? "" : dir,
    trailing: hasText ? h3(IconButton, {
      label: state.copied ? t("common.copied") : t("aria.copyDiff"),
      icon: IconCopy,
      onClick: handlers.onCopyDiff
    }) : null
  });
}
function diffBody(state, deps, handlers) {
  const { t } = deps;
  const diff = state.diff;
  const rows = diff.data === null ? [] : diffRows(diff.data.text);
  const path = diff.filePath ?? "";
  const repository = selectedRepository(state);
  return h3(
    "div",
    { className: "dvt-col" },
    repository === null ? null : h3("span", { className: "dvt-sr-only" }, repository.displayName),
    diff.loading ? h3(SkeletonRows, { rows: 6 }) : null,
    diff.error !== null ? h3(Banner, {
      kind: "error",
      text: errorText(diff.error, t),
      action: h3("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: handlers.onBackFromDiff }, t("aria.back"))
    }) : null,
    diff.data === null ? diff.loading || diff.error !== null ? null : h3(EmptyState, { icon: IconDiff, title: t("diff.empty") }) : h3(
      "div",
      { className: "dvt-col" },
      diff.data.binary === true ? h3(Banner, { kind: "info", title: t("diff.binary"), text: t("diff.binary.hint") }) : null,
      diff.data.truncated === true ? h3(Banner, { kind: "warn", title: t("common.warning"), text: t("diff.truncated.generic") }) : null,
      diff.data.binary === true ? null : rows.length === 0 ? h3(EmptyState, { icon: IconDiff, title: t("diff.empty") }) : h3(
        "div",
        { className: "dvt-diff", "aria-label": t("diff.title") },
        rows.map((row, index) => h3(
          "div",
          {
            key: `row-${index}`,
            className: `dvt-diff-row dvt-diff-${row.kind}`
          },
          h3(
            "span",
            { className: "dvt-diff-gutter", "aria-label": t("diff.lineNumbers") },
            h3("span", { className: "dvt-diff-old" }, row.oldLine === null ? "" : String(row.oldLine)),
            h3("span", { className: "dvt-diff-new" }, row.newLine === null ? "" : String(row.newLine))
          ),
          h3("span", { className: "dvt-diff-code" }, row.text === "" ? " " : row.text)
        ))
      ),
      diff.data.binary !== true && rows.length > 0 ? h3(
        "div",
        { className: "dvt-diff-foot" },
        h3("span", { className: "dvt-mono dvt-clip", title: path }, path),
        h3("span", null, t("diff.lines", { count: rows.length })),
        h3("span", null, formatBytes(diff.data.bytes)),
        diff.data.truncated === true ? h3("span", null, t("diff.truncated")) : null
      ) : null
    )
  );
}

// src/client/ui/audit.ts
var h4 = React4.createElement;
function stateVisual(state) {
  if (state === "succeeded") return { Icon: IconCheck, cls: "dvt-audit-icon-success" };
  if (state === "failed") return { Icon: IconError, cls: "dvt-audit-icon-error" };
  if (state === "unknown" || state === "partial") return { Icon: IconWarning, cls: "dvt-audit-icon-warn" };
  return { Icon: IconAudit, cls: "" };
}
function durationLabel(attempt, locale) {
  void locale;
  if (attempt.finishedAt === void 0) return "";
  const start = Date.parse(attempt.startedAt);
  const end = Date.parse(attempt.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  const ms = end - start;
  if (ms < 1e3) return `${Math.round(ms)} ms`;
  return `${(ms / 1e3).toFixed(1)} s`;
}
function AuditRow(props) {
  const { attempt, repositoryName, deps, handlers } = props;
  const { t } = deps;
  const { Icon, cls } = stateVisual(attempt.state);
  const time = formatCompactTime(attempt.startedAt, deps.locale);
  return h4(
    "li",
    { className: "dvt-audit-row" },
    h4(
      "button",
      {
        type: "button",
        className: "dvt-audit-btn",
        title: attempt.requestSummary,
        "aria-label": t("aria.auditRow", {
          operation: operationLabel(attempt.operation, t),
          state: operationStateLabel(attempt.state, t)
        }),
        onClick: () => handlers.onOpenOperation(attempt)
      },
      h4("span", { className: `dvt-audit-icon ${cls}` }, h4(Icon, { size: 13 })),
      h4(
        "span",
        { className: "dvt-audit-main" },
        h4(
          "span",
          { className: "dvt-audit-title" },
          operationLabel(attempt.operation, t),
          repositoryName === null ? null : h4("span", { className: "dvt-faint" }, ` \xB7 ${repositoryName}`)
        ),
        h4(
          "span",
          { className: "dvt-audit-meta" },
          time === "" ? null : h4("span", null, time),
          h4("span", { className: "dvt-faint dvt-mono" }, shortHash(attempt.correlationId.replace(/^corr-/, ""), 8))
        )
      ),
      h4(StateBadge, { state: attempt.state, t })
    )
  );
}
function renderAuditList(state, deps, handlers) {
  const { t } = deps;
  const repository = selectedRepository(state);
  const audit = state.audit;
  if (state.boot === "loading") return h4(SkeletonRows, { rows: 4 });
  if (state.boot === "error") {
    return h4(EmptyState, {
      icon: IconError,
      tone: "error",
      title: t("state.error.title"),
      hint: errorMessage(state.bootError, t),
      actions: h4("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: handlers.onRefreshRepositories }, t("common.retry"))
    });
  }
  if (repository === null) {
    return h4(EmptyState, {
      icon: IconAudit,
      title: state.noWorkspace ? t("state.noWorkspace.title") : t("state.noRepositories.title"),
      hint: state.noWorkspace ? t("state.noWorkspace.hint") : t("state.noRepositories.hint")
    });
  }
  const tool = missingTool(state, repository);
  if (tool !== null) {
    return h4(EmptyState, {
      icon: IconError,
      tone: "error",
      title: t("state.missingTool", { vcs: tool === "git" ? "Git" : "SVN", tool: tool === "git" ? "Git" : "SVN" }),
      hint: t("error.vcs-not-installed")
    });
  }
  if (audit.loading) return h4(SkeletonRows, { rows: 4 });
  if (audit.error !== null) {
    return h4(EmptyState, {
      icon: IconError,
      tone: "error",
      title: t("state.error.title"),
      hint: errorText(audit.error, t),
      actions: h4("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: handlers.onRetryAudit }, t("common.retry"))
    });
  }
  if (audit.operations.length === 0) {
    return h4(EmptyState, {
      icon: IconAudit,
      title: t("audit.empty"),
      hint: t("audit.empty.hint")
    });
  }
  return h4(
    "div",
    { className: "dvt-col" },
    audit.warnings.length > 0 ? h4(Banner, { kind: "warn", text: t("audit.partial") }) : null,
    h4(
      "ul",
      { className: "dvt-list", "aria-label": t("source.audit") },
      audit.operations.map((attempt) => h4(AuditRow, {
        key: attempt.id,
        attempt,
        repositoryName: state.repositories.find((entry) => entry.id === attempt.repositoryId)?.displayName ?? null,
        deps,
        handlers
      }))
    ),
    h4("div", { className: "dvt-list-count" }, t("audit.count", { count: audit.operations.length })),
    audit.hasMore ? h4(
      "div",
      { className: "dvt-list-more" },
      h4("button", {
        type: "button",
        className: "dvt-btn dvt-btn-sm",
        disabled: audit.loadingMore,
        onClick: handlers.onLoadMoreAudit
      }, audit.loadingMore ? t("common.loadingMore") : t("audit.more"))
    ) : null
  );
}
function field(key, value, mono = false) {
  return h4(
    "div",
    { key, className: "dvt-kv" },
    h4("div", { className: "dvt-kv-key" }, key),
    h4("div", { className: `dvt-kv-val${mono ? " dvt-mono" : ""}` }, value)
  );
}
function auditDetailHeader(state, deps, handlers) {
  const { t } = deps;
  const attempt = state.audit.selected;
  return h4(Subbar, {
    onBack: handlers.onBackFromAuditDetail,
    backLabel: t("aria.back"),
    title: t("audit.detail"),
    subtitle: attempt === null ? "" : shortHash(attempt.id.replace(/^op-/, ""), 8),
    trailing: attempt === null ? null : h4(StateBadge, { state: attempt.state, t })
  });
}
function auditDetailBody(state, deps, handlers) {
  const { t } = deps;
  const attempt = state.audit.selected;
  if (attempt === null) return h4(EmptyState, { icon: IconAudit, title: t("common.empty") });
  const repository = state.repositories.find((entry) => entry.id === attempt.repositoryId) ?? null;
  const duration = durationLabel(attempt, deps.locale);
  return h4(
    "div",
    { className: "dvt-col" },
    attempt.state === "unknown" ? h4(Banner, { kind: "warn", title: t("audit.unknownResult"), text: t("audit.state.unknown.hint") }) : null,
    attempt.safeErrorMessage === void 0 ? null : h4(Banner, {
      kind: attempt.state === "failed" ? "error" : "warn",
      title: t("audit.safeError"),
      text: attempt.safeErrorMessage
    }),
    h4(
      "div",
      { className: "dvt-section" },
      h4(SectionHeader, { title: t("audit.operation") }),
      h4(
        "div",
        { style: { padding: "0 10px 6px" } },
        field(t("audit.state"), h4(StateBadge, { state: attempt.state, t })),
        field(t("audit.repository"), repository === null ? attempt.repositoryId : repository.displayName),
        field(t("audit.startedAt"), formatTime(attempt.startedAt, deps.locale) || t("common.unknown")),
        attempt.finishedAt === void 0 ? null : field(t("audit.finishedAt"), formatTime(attempt.finishedAt, deps.locale)),
        duration === "" ? null : field(t("audit.duration"), duration),
        attempt.exitCode === void 0 ? null : field(t("audit.exitCode"), String(attempt.exitCode), true),
        attempt.errorCode === void 0 || attempt.errorCode === "" ? null : field(t("audit.errorCode"), attempt.errorCode, true),
        attempt.requestSummary === "" ? null : field(t("audit.requestSummary"), attempt.requestSummary),
        attempt.beforeRevision === void 0 ? null : field(t("audit.beforeRevision"), shortHash(attempt.beforeRevision, 12), true),
        attempt.afterRevision === void 0 ? null : field(t("audit.afterRevision"), shortHash(attempt.afterRevision, 12), true),
        attempt.remoteOutcome === void 0 ? null : field(t("audit.remoteOutcome"), remoteOutcomeLabel(attempt.remoteOutcome, t)),
        attempt.changedPaths === void 0 || attempt.changedPaths.length === 0 ? null : field(t("audit.changedPaths"), pathsSummary(attempt.changedPaths, 6)),
        field(t("audit.correlation"), attempt.correlationId, true)
      )
    )
  );
}

// src/client/ui/dialog.ts
var React5 = __toESM(require("react"), 1);
var h5 = React5.createElement;
function kvRow(key, value, mono = false) {
  return h5(
    "div",
    { key, className: "dvt-row", style: { gap: 6 } },
    h5("span", { className: "dvt-kv-key", style: { flex: "0 0 78px" } }, key),
    h5("span", { className: `dvt-kv-val${mono ? " dvt-mono" : ""}` }, value)
  );
}
function OperationFields(props) {
  const { state, dialog, handlers, t } = props;
  const disabled = dialog.phase === "executing" || dialog.phase === "result";
  if (dialog.operation === "commit") {
    const staged = stagedCount(state.status?.entries);
    return h5(
      "div",
      { className: "dvt-dialog-section" },
      h5("div", { className: "dvt-dialog-label" }, t("op.commit.message")),
      h5("textarea", {
        id: "dvt-commit-message",
        className: "dvt-textarea",
        value: dialog.message,
        placeholder: t("op.commit.message.placeholder"),
        "aria-label": t("op.commit.message"),
        disabled,
        onChange: (event) => handlers.onDialogMessageChange(event.currentTarget.value)
      }),
      h5(
        "div",
        { className: "dvt-row", style: { marginTop: 4, gap: 6 } },
        h5(
          "span",
          { className: "dvt-faint", style: { fontSize: 10 } },
          `${t("op.commit.stagedCount", { count: staged })} \xB7 ${t("op.commit.stagedOnly")}`
        )
      ),
      staged === 0 ? h5(Banner, { kind: "warn", text: t("op.commit.noStaged") }) : null,
      dialog.message.trim() === "" ? h5(Banner, { kind: "warn", text: t("op.commit.message.required") }) : null
    );
  }
  if (dialog.operation === "push") {
    return h5(
      "div",
      { className: "dvt-dialog-section" },
      h5(
        "div",
        { className: "dvt-row", style: { gap: 6 } },
        h5(
          "label",
          { className: "dvt-grow" },
          h5("span", { className: "dvt-dialog-label" }, t("op.push.remote")),
          h5("input", {
            id: "dvt-push-remote",
            className: "dvt-input",
            type: "text",
            value: dialog.remote,
            "aria-label": t("op.push.remote"),
            disabled,
            onChange: (event) => handlers.onDialogRemoteChange(event.currentTarget.value)
          })
        ),
        h5(
          "label",
          { className: "dvt-grow" },
          h5("span", { className: "dvt-dialog-label" }, t("op.push.branch")),
          h5("input", {
            id: "dvt-push-branch",
            className: "dvt-input",
            type: "text",
            value: dialog.branch,
            "aria-label": t("op.push.branch"),
            disabled,
            onChange: (event) => handlers.onDialogBranchChange(event.currentTarget.value)
          })
        )
      ),
      h5("div", { className: "dvt-dialog-note", style: { marginTop: 4 } }, t("op.push.hint"))
    );
  }
  return null;
}
function BeforeState(props) {
  const before = props.state.dialog?.preview?.before;
  if (before === void 0) return null;
  const { t } = props;
  const rows = [];
  if (before.branch !== void 0) rows.push(kvRow(t("op.before.branch"), before.branch, true));
  if (before.revision !== void 0) rows.push(kvRow(t("op.before.revision"), shortHash(before.revision, 12), true));
  if (before.clean !== void 0) rows.push(kvRow(t("op.before.clean"), before.clean ? t("op.before.clean.yes") : t("op.before.clean.no")));
  if (before.stagedFiles !== void 0) rows.push(kvRow(t("op.before.staged"), t("op.before.stagedCount", { count: before.stagedFiles.length })));
  if (before.ahead !== void 0) rows.push(kvRow(t("op.before.ahead"), String(before.ahead)));
  if (before.behind !== void 0) rows.push(kvRow(t("op.before.behind"), String(before.behind)));
  if (rows.length === 0) return null;
  return h5(
    "div",
    { className: "dvt-dialog-section" },
    h5("div", { className: "dvt-dialog-label" }, t("op.before")),
    rows
  );
}
function OperationResult(props) {
  const attempt = props.state.dialog?.result;
  if (attempt === void 0 || attempt === null) return null;
  const { t } = props;
  const rows = [
    h5(
      "div",
      { key: "state", className: "dvt-row" },
      h5("span", { className: "dvt-kv-key", style: { flex: "0 0 78px" } }, t("audit.state")),
      h5(StateBadge, { state: attempt.state, t })
    )
  ];
  if (attempt.exitCode !== void 0) rows.push(kvRow(t("audit.exitCode"), String(attempt.exitCode), true));
  if (attempt.errorCode !== void 0 && attempt.errorCode !== "") rows.push(kvRow(t("audit.errorCode"), attempt.errorCode, true));
  if (attempt.beforeRevision !== void 0) rows.push(kvRow(t("audit.beforeRevision"), shortHash(attempt.beforeRevision, 12), true));
  if (attempt.afterRevision !== void 0) rows.push(kvRow(t("audit.afterRevision"), shortHash(attempt.afterRevision, 12), true));
  if (attempt.remoteOutcome !== void 0) rows.push(kvRow(t("audit.remoteOutcome"), remoteOutcomeLabel(attempt.remoteOutcome, t)));
  if (attempt.changedPaths !== void 0 && attempt.changedPaths.length > 0) {
    rows.push(kvRow(t("audit.changedPaths"), pathsSummary(attempt.changedPaths, 4)));
  }
  return h5(
    "div",
    { className: "dvt-dialog-section" },
    h5(
      "div",
      { className: "dvt-result" },
      attempt.state === "unknown" ? h5(Banner, { kind: "warn", title: t("audit.unknownResult"), text: t("audit.state.unknown.hint") }) : null,
      rows,
      h5("div", { className: "dvt-dialog-note" }, t("op.refreshNote"))
    )
  );
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
  const sections = [];
  if (dialog.phase === "previewing") {
    sections.push(h5(Progress, { key: "previewing", label: t("op.previewing") }));
    sections.push(h5("div", { key: "preview-skeleton" }, h5(SkeletonRows, { rows: 2 })));
  }
  if (preview !== null) {
    sections.push(h5(
      "div",
      { key: "summary", className: "dvt-dialog-section" },
      h5("div", { className: "dvt-dialog-label" }, t("op.summary")),
      h5("div", { className: "dvt-dialog-summary" }, preview.summary),
      repository === null ? null : h5(
        "div",
        { className: "dvt-dialog-note", style: { marginTop: 2 } },
        `${repository.displayName} \xB7 ${vcsLabel(repository.vcsType, t)} \xB7 ${repository.rootPath}`
      )
    ));
    sections.push(h5(
      "div",
      { key: "argv", className: "dvt-dialog-section" },
      h5("div", { className: "dvt-dialog-label" }, t("op.argv")),
      h5("pre", { className: "dvt-argv" }, preview.argv.join(" "))
    ));
    if (!preview.allowed) {
      sections.push(h5(
        "div",
        { key: "blocked", className: "dvt-dialog-section" },
        h5(Banner, {
          kind: "error",
          title: t("common.error"),
          text: t("op.blocked", { reason: preview.blockedReason === void 0 || preview.blockedReason === "" ? t("op.blocked.generic") : preview.blockedReason })
        })
      ));
    }
    if (preview.warnings.length > 0) {
      sections.push(h5(
        "div",
        { key: "warnings", className: "dvt-dialog-section" },
        h5("div", { className: "dvt-dialog-label" }, t("op.warnings")),
        h5("ul", { className: "dvt-warnings" }, preview.warnings.map((warning, index) => h5("li", { key: index }, warning)))
      ));
    }
    sections.push(h5(BeforeState, { key: "before", state, t }));
    if (preview.expiresAt !== "" && preview.allowed && !expired) {
      sections.push(h5(
        "div",
        { key: "expires", className: "dvt-dialog-note", style: { padding: "0 10px 6px" } },
        `${t("op.expires")} ${formatTime(preview.expiresAt, deps.locale)}`
      ));
    }
    if (expired) {
      sections.push(h5(
        "div",
        { key: "expired", className: "dvt-dialog-section" },
        h5(Banner, { kind: "warn", text: t("op.expired") })
      ));
    }
  }
  const fields = h5(OperationFields, { key: "fields", state, dialog, handlers, t });
  if (dialog.operation === "commit" || dialog.operation === "push") sections.push(fields);
  if (dialog.phase === "executing") {
    sections.push(h5(Progress, { key: "executing", label: t("op.executing") }));
  }
  if (dialog.previewError !== null) {
    sections.push(h5(
      "div",
      { key: "preview-error", className: "dvt-dialog-section" },
      h5(Banner, { kind: "error", text: errorMessage(dialog.previewError, t) }),
      h5("div", { className: "dvt-dialog-note" }, t("op.previewFailed"))
    ));
  }
  if (dialog.executeError !== null) {
    sections.push(h5(
      "div",
      { key: "execute-error", className: "dvt-dialog-section" },
      h5(Banner, { kind: "error", text: errorMessage(dialog.executeError, t) }),
      h5("div", { className: "dvt-dialog-note" }, t("op.executeError"))
    ));
  }
  sections.push(h5(OperationResult, { key: "result", state, t }));
  const actions = [];
  if (dialog.phase === "previewed" && preview !== null && preview.allowed) {
    actions.push(h5("button", {
      key: "confirm",
      type: "button",
      className: "dvt-btn dvt-btn-primary",
      disabled: !canConfirm,
      autoFocus: true,
      onClick: handlers.onDialogConfirm
    }, t("op.confirm")));
  }
  if (dialog.phase === "error" || dialog.phase === "blocked" || dialog.phase === "previewed" && expired) {
    actions.push(h5("button", {
      key: "repreview",
      type: "button",
      className: "dvt-btn",
      disabled: busy,
      onClick: handlers.onDialogRepreview
    }, t("op.repreview")));
  }
  if (dialog.phase === "result") {
    actions.push(h5("button", {
      key: "close-result",
      type: "button",
      className: "dvt-btn dvt-btn-primary",
      onClick: handlers.onDialogClose
    }, t("common.close")));
  }
  actions.push(h5("button", {
    key: "cancel",
    type: "button",
    className: dialog.phase === "result" ? "dvt-btn dvt-btn-ghost" : "dvt-btn",
    disabled: dialog.phase === "executing",
    onClick: handlers.onDialogClose
  }, t("common.cancel")));
  return h5(
    "div",
    { className: "dvt-overlay" },
    h5(
      "div",
      {
        className: "dvt-dialog",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": t("aria.dialog", { operation: operationLabel(dialog.operation, t) })
      },
      h5(
        "div",
        { className: "dvt-dialog-head" },
        h5("span", { className: "dvt-dialog-title dvt-clip" }, t("op.dialogTitle", { operation: operationLabel(dialog.operation, t) })),
        h5(IconButton, {
          label: t("aria.closeDialog"),
          icon: IconClose,
          disabled: dialog.phase === "executing",
          onClick: handlers.onDialogClose
        })
      ),
      h5("div", { className: "dvt-dialog-body" }, sections),
      h5(
        "div",
        { className: "dvt-dialog-foot" },
        h5("span", { className: "dvt-dialog-note" }, t("op.neverRetry")),
        actions
      )
    )
  );
}

// src/client/ui/filetree.ts
var React6 = __toESM(require("react"), 1);
var h6 = React6.createElement;
var INDENT_STEP = 12;
var STATUS_TABS = [
  { status: "all", letter: "\u2217" },
  { status: "modified", letter: "M" },
  { status: "added", letter: "A" },
  { status: "deleted", letter: "D" },
  { status: "renamed", letter: "R" }
];
function isOpen(state, path, searching) {
  if (searching) return true;
  return state.expandedDirs[path] === true;
}
function TreeNodeRow(props) {
  const { node, depth, state, deps, handlers, searching } = props;
  const { t } = deps;
  const indent = 4 + depth * INDENT_STEP;
  if (node.kind === "dir") {
    const open = isOpen(state, node.path, searching);
    return h6(
      "li",
      { key: node.path, className: "dvt-tree-item", role: "treeitem", "aria-expanded": open },
      h6(
        "button",
        {
          type: "button",
          className: "dvt-tree-row dvt-tree-dir",
          style: { paddingLeft: `${indent}px` },
          title: node.path,
          onClick: () => handlers.onToggleDir(node.path)
        },
        h6("span", { className: `dvt-tree-caret${open ? " dvt-tree-caret-open" : ""}`, "aria-hidden": "true" }, "\u203A"),
        h6(
          "span",
          { className: "dvt-tree-icon", "aria-hidden": "true" },
          h6(open ? IconFolderOpen : IconFolder, { size: 13 })
        ),
        h6("span", { className: "dvt-tree-name dvt-clip" }, node.name),
        h6("span", { className: "dvt-tree-badge", title: t("tree.dirCount", { count: node.count }) }, String(node.count))
      ),
      open && node.children.length > 0 ? h6(
        "ul",
        { className: "dvt-tree-children", role: "group" },
        node.children.map((child) => h6(TreeNodeRow, {
          key: child.path,
          node: child,
          depth: depth + 1,
          state,
          deps,
          handlers,
          searching
        }))
      ) : null
    );
  }
  const selected = state.selectedFilePath === node.path;
  return h6(
    "li",
    { key: node.path, className: "dvt-tree-item", role: "treeitem", "aria-selected": selected },
    h6(
      "button",
      {
        type: "button",
        className: `dvt-tree-row dvt-tree-file${selected ? " dvt-tree-file-selected" : ""}`,
        style: { paddingLeft: `${indent}px` },
        title: node.entry.oldPath === void 0 ? node.path : `${node.entry.oldPath} \u2192 ${node.path}`,
        "aria-label": t("aria.treeFile", {
          path: node.path,
          status: statusLabel(node.entry.status, t)
        }),
        onClick: () => handlers.onSelectFile(selected ? null : node.path)
      },
      h6("span", { className: "dvt-tree-icon", "aria-hidden": "true" }, h6(IconFile, { size: 12 })),
      h6("span", { className: "dvt-tree-name dvt-clip" }, node.name),
      node.entry.changes > 1 ? h6("span", { className: "dvt-tree-changes", title: t("tree.changeCount", { count: node.entry.changes }) }, `\xD7${node.entry.changes}`) : null,
      h6("span", {
        className: `dvt-file-status dvt-status-${node.entry.status}`,
        title: statusLabel(node.entry.status, t),
        "aria-hidden": "true"
      }, statusLetter(node.entry.status))
    )
  );
}
function renderFileTree(state, deps, handlers, view) {
  const { t } = deps;
  const searching = state.filters.treeQuery.trim() !== "";
  const counts = statusCounts(filterFileEntries(view.files, state.filters.treeQuery, "all"));
  const hasWindow = state.timeline.events.length > 0;
  return h6(
    "aside",
    { className: "dvt-tree", "aria-label": t("tree.pane") },
    h6(
      "div",
      { className: "dvt-tree-head" },
      h6(
        "span",
        { className: "dvt-tree-title" },
        h6("span", null, t("tree.title")),
        h6("span", { className: "dvt-tree-total", title: t("tree.filesInWindow", { count: view.files.length }) }, String(view.visibleFiles.length))
      ),
      h6(
        "span",
        { className: "dvt-tree-tools" },
        h6(IconButton, {
          label: t("tree.expandAll"),
          icon: IconExpandAll,
          disabled: view.tree.length === 0,
          onClick: handlers.onExpandAllDirs
        }),
        h6(IconButton, {
          label: t("tree.collapseAll"),
          icon: IconCollapseAll,
          disabled: view.tree.length === 0,
          onClick: handlers.onCollapseAllDirs
        })
      )
    ),
    h6(
      "div",
      { className: "dvt-tree-search" },
      h6(IconSearch, { size: 11 }),
      h6("input", {
        className: "dvt-tree-input",
        type: "search",
        value: state.filters.treeQuery,
        placeholder: t("tree.search.placeholder"),
        "aria-label": t("tree.search"),
        onChange: (event) => handlers.onTreeQueryChange(event.currentTarget.value)
      })
    ),
    h6(
      "div",
      { className: "dvt-tree-chips", role: "group", "aria-label": t("tree.statusFilter") },
      STATUS_TABS.map((tab) => {
        const count = tab.status === "all" ? counts.all : counts[tab.status];
        if (tab.status !== "all" && count === 0) return null;
        return h6(
          "button",
          {
            key: tab.status,
            type: "button",
            className: "dvt-tree-chip",
            "aria-pressed": state.filters.fileStatus === tab.status,
            "aria-label": t("tree.statusChip", {
              status: tab.status === "all" ? t("filter.chip.all") : statusLabel(tab.status, t),
              count
            }),
            title: tab.status === "all" ? t("filter.chip.all") : statusLabel(tab.status, t),
            onClick: () => handlers.onSetFileStatus(tab.status)
          },
          h6("span", { className: "dvt-tree-chip-letter", "aria-hidden": "true" }, tab.letter),
          h6("span", { className: "dvt-tree-chip-count" }, String(count))
        );
      })
    ),
    h6(
      "div",
      { className: "dvt-tree-scroll" },
      h6(
        "button",
        {
          type: "button",
          className: `dvt-tree-all${state.selectedFilePath === null ? " dvt-tree-all-active" : ""}`,
          "aria-pressed": state.selectedFilePath === null,
          onClick: () => handlers.onSelectFile(null)
        },
        h6("span", { className: "dvt-tree-all-label" }, t("tree.all")),
        h6("span", { className: "dvt-tree-all-meta" }, t("tree.commitCount", { count: view.visibleEvents.length }))
      ),
      !view.filesReported ? h6(EmptyState, {
        icon: IconFile,
        title: t("tree.unavailable.title"),
        hint: t("tree.unavailable.hint")
      }) : !hasWindow ? h6(EmptyState, { icon: IconFile, title: t("tree.empty") }) : view.visibleFiles.length === 0 ? h6(EmptyState, {
        icon: IconFile,
        title: t("tree.filtered"),
        hint: t("tree.filtered.hint"),
        actions: h6("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: handlers.onClearFilters }, t("filter.clear"))
      }) : h6(
        "ul",
        { className: "dvt-tree-list", role: "tree", "aria-label": t("tree.pane") },
        view.tree.map((node) => h6(TreeNodeRow, {
          key: node.path,
          node,
          depth: 0,
          state,
          deps,
          handlers,
          searching
        }))
      )
    )
  );
}

// src/client/ui/history.ts
var React7 = __toESM(require("react"), 1);
var h7 = React7.createElement;
function revisionLabel(event) {
  if (event.revision !== void 0 && event.revision !== "") return `r${event.revision}`;
  return shortHash(event.commitHash, 7);
}
function selectedFileOf(event, path) {
  const files = Array.isArray(event.changedFiles) ? event.changedFiles : [];
  const file = files.find((entry) => entry.path === path);
  if (file === void 0) return { additions: null, deletions: null, status: "unknown", letter: "?", binary: false };
  const stats = fileStats(file);
  return {
    ...stats,
    status: file.status,
    letter: statusLetter(file.status),
    binary: file.binary === true
  };
}
function whenLabel(iso, deps, now) {
  const relative = relativeTime(iso, now);
  if (relative === null) return formatCompactTime(iso, deps.locale);
  const { t } = deps;
  switch (relative.unit) {
    case "justNow":
      return t("rel.justNow");
    case "minutes":
      return t("rel.minutesAgo", { count: relative.count });
    case "hours":
      return t("rel.hoursAgo", { count: relative.count });
    default:
      return t("rel.daysAgo", { count: relative.count });
  }
}
function AuthorAvatar(props) {
  const { actor } = props;
  const hue = authorHue(actor);
  return h7("span", {
    className: "dvt-tl-avatar",
    "aria-hidden": "true",
    style: {
      background: `hsl(${hue} 58% 52%)`,
      color: "var(--dsw-alias-bg-base)"
    }
  }, authorInitials(actor));
}
function DayHeader(props) {
  const { group, deps, now } = props;
  const label = dayLabel(group.timestamp, deps.locale, new Date(now));
  const text = label.kind === "today" ? deps.t("group.today") : label.kind === "yesterday" ? deps.t("group.yesterday") : label.text;
  return h7(
    "div",
    { className: "dvt-tl-day" },
    h7("span", { className: "dvt-tl-day-label" }, text),
    h7("span", { className: "dvt-tl-day-count" }, deps.t("timeline.count.label", { count: group.events.length }))
  );
}
function isHeadEvent(event, headRevision) {
  if (headRevision === void 0 || headRevision === "") return false;
  if (event.commitHash !== void 0 && event.commitHash === headRevision) return true;
  return event.revision !== void 0 && event.revision === headRevision;
}
function TimelineRow(props) {
  const { event, deps, handlers, selectedPath, visiblePaths, headRevision, now } = props;
  const { t } = deps;
  const merge = isMergeCommit(event);
  const head = isHeadEvent(event, headRevision);
  const hash = shortHash(event.commitHash, 7);
  const revision = revisionLabel(event);
  const stats = eventStats(event);
  const narrow = selectedPath === null ? null : selectedFileOf(event, selectedPath);
  const matched = selectedPath !== null || visiblePaths === null ? null : (Array.isArray(event.changedFiles) ? event.changedFiles : []).filter((file) => visiblePaths.has(file.path)).length;
  const when = whenLabel(event.timestamp, deps, now);
  const exact = formatTime(event.timestamp, deps.locale);
  const aria = t("aria.timelineRow", {
    label: `${revision === "" ? event.id : revision} ${truncate(event.summary, 80)}`
  });
  return h7(
    "li",
    { className: "dvt-tl-row" },
    h7(
      "span",
      { className: "dvt-tl-rail", "aria-hidden": "true" },
      h7("span", { className: `dvt-tl-node${merge ? " dvt-tl-node-merge" : ""}` })
    ),
    h7(
      "button",
      {
        type: "button",
        className: "dvt-tl-card",
        "aria-label": aria,
        title: `${event.summary}
${exact}`,
        onClick: () => handlers.onOpenEvent(event)
      },
      h7(
        "span",
        { className: "dvt-tl-top" },
        h7(AuthorAvatar, { actor: event.actor, deps }),
        h7(
          "span",
          { className: "dvt-tl-author" },
          event.actor === void 0 || event.actor === "" ? t("common.unknown") : event.actor
        ),
        h7(
          "span",
          { className: "dvt-tl-summary" },
          truncate(event.summary, 200) === "" ? t("timeline.noRevision") : truncate(event.summary, 200)
        ),
        h7(
          "span",
          { className: "dvt-tl-stats" },
          narrow === null ? h7(LineStats, {
            ...stats.additions === void 0 ? {} : { additions: stats.additions },
            ...stats.deletions === void 0 ? {} : { deletions: stats.deletions },
            t
          }) : h7(LineStats, {
            ...narrow.additions === null ? {} : { additions: narrow.additions },
            ...narrow.deletions === null ? {} : { deletions: narrow.deletions },
            t
          })
        )
      ),
      h7(
        "span",
        { className: "dvt-tl-meta" },
        h7(
          "span",
          { className: "dvt-tl-when", title: exact },
          h7(IconClock, { size: 10 }),
          h7("span", null, when)
        ),
        hash === "" ? null : h7(DotSep),
        hash === "" ? null : h7("span", { className: "dvt-tl-hash dvt-mono" }, hash),
        head ? h7("span", { className: "dvt-tag dvt-tl-head", title: t("timeline.head") }, "HEAD") : null,
        merge ? h7("span", { className: "dvt-tag dvt-tag-merge", title: t("timeline.merge") }, t("timeline.merge")) : null,
        event.branch === void 0 || event.branch === "" ? null : h7(
          "span",
          { className: "dvt-tag dvt-tl-branch", title: event.branch },
          h7(IconBranch, { size: 9 }),
          h7("span", null, truncate(event.branch, 22))
        ),
        narrow === null ? null : h7("span", {
          className: `dvt-file-status dvt-status-${narrow.status}`,
          title: t("aria.fileStatus")
        }, narrow.letter),
        narrow !== null && narrow.binary ? h7("span", { className: "dvt-bin", title: t("diff.binary") }, "BIN") : null,
        matched === null || matched === 0 ? null : h7("span", { className: "dvt-tl-files", title: t("aria.stats") }, t("timeline.matchedFiles", { count: matched })),
        narrow === null && stats.files !== void 0 && visiblePaths === null ? h7("span", { className: "dvt-tl-files", title: t("aria.stats") }, fileCountLabel(stats.files, t)) : null,
        h7("span", { className: "dvt-tl-go", "aria-hidden": "true" }, "\u203A")
      )
    )
  );
}
function SelectionHeader(props) {
  const { path, status, count, deps, handlers } = props;
  const { t } = deps;
  const { dir, name } = splitRepoPath(path);
  return h7(
    "div",
    { className: "dvt-selection" },
    h7(
      "span",
      { className: `dvt-file-status dvt-status-${status}`, "aria-hidden": "true" },
      statusLetter(status)
    ),
    h7(
      "span",
      { className: "dvt-selection-path dvt-mono", title: path },
      dir === "" ? null : h7("span", { className: "dvt-file-dir" }, dir),
      h7("span", { className: "dvt-selection-name" }, name)
    ),
    h7("span", { className: "dvt-selection-meta" }, t("timeline.count.label", { count })),
    h7(IconButton, {
      label: t("tree.showAll"),
      icon: IconClose,
      extraClass: "dvt-selection-clear",
      onClick: () => handlers.onSelectFile(null)
    })
  );
}
function renderHistory(state, deps, handlers, view) {
  const { t } = deps;
  const repository = selectedRepository(state);
  const timeline = state.timeline;
  if (state.boot === "loading") return h7(SkeletonRows, { rows: 6 });
  if (state.boot === "error") {
    return h7(EmptyState, {
      icon: IconError,
      tone: "error",
      title: t("state.error.title"),
      hint: errorMessage(state.bootError, t),
      actions: h7("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: handlers.onRefreshRepositories }, t("common.retry"))
    });
  }
  if (repository === null) {
    if (state.noWorkspace) {
      return h7(EmptyState, {
        icon: IconRepo,
        title: t("state.noWorkspace.title"),
        hint: t("state.noWorkspace.hint"),
        actions: h7("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: handlers.onRefreshRepositories }, t("common.refresh"))
      });
    }
    return h7(EmptyState, {
      icon: IconRepo,
      title: t("state.noRepositories.title"),
      hint: t("state.noRepositories.hint"),
      actions: h7("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: handlers.onRefreshRepositories }, t("common.refresh"))
    });
  }
  const tool = missingTool(state, repository);
  if (tool !== null) {
    return h7(EmptyState, {
      icon: IconError,
      tone: "error",
      title: t("state.missingTool", { vcs: tool === "git" ? "Git" : "SVN", tool: tool === "git" ? "Git" : "SVN" }),
      hint: t("error.vcs-not-installed"),
      actions: h7("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: handlers.onRefreshRepositories }, t("common.retry"))
    });
  }
  if (timeline.loading) return h7(SkeletonRows, { rows: 6 });
  if (timeline.error !== null) {
    return h7(EmptyState, {
      icon: IconError,
      tone: "error",
      title: t("state.error.title"),
      hint: errorMessage(timeline.error, t),
      actions: h7("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: handlers.onRetryTimeline }, t("common.retry"))
    });
  }
  const rows = view.visibleEvents;
  const fileFilterActive = state.filters.treeQuery.trim() !== "" || state.filters.fileStatus !== "all";
  const visiblePaths = fileFilterActive ? new Set(view.visibleFiles.map((entry) => entry.path)) : null;
  const header = view.selected === null ? null : h7(SelectionHeader, {
    path: view.selected.path,
    status: view.selected.status,
    count: rows.length,
    deps,
    handlers
  });
  if (rows.length === 0) {
    if (view.selected !== null) {
      return h7(
        "div",
        { className: "dvt-col" },
        header,
        h7(EmptyState, {
          icon: IconTimeline,
          title: t("timeline.empty.file"),
          hint: t("timeline.empty.file.hint"),
          actions: h7("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: () => handlers.onSelectFile(null) }, t("tree.showAll"))
        })
      );
    }
    if (hasActiveFilters(state)) {
      return h7(EmptyState, {
        icon: IconTimeline,
        title: t("timeline.empty.filtered"),
        hint: t("timeline.filters.active"),
        actions: h7("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: handlers.onClearFilters }, t("filter.clear"))
      });
    }
    if (isUninitializedHistory(state, repository)) {
      return h7(EmptyState, {
        icon: IconBranch,
        title: t("timeline.empty.uninitialized"),
        hint: t("timeline.empty.uninitialized.hint"),
        actions: h7("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: handlers.onRefreshRepositories }, t("common.refresh"))
      });
    }
    return h7(EmptyState, {
      icon: IconTimeline,
      title: t("timeline.empty"),
      hint: t("common.retryHint"),
      actions: h7("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: handlers.onRefreshRepositories }, t("common.refresh"))
    });
  }
  const now = Date.now();
  const groups = groupEventsByDay(rows);
  return h7(
    "div",
    { className: "dvt-col dvt-timeline-col" },
    timeline.partial ? h7(Banner, {
      kind: "warn",
      title: t("state.partial.title"),
      text: timeline.warnings[0] === void 0 ? t("timeline.partial") : t("timeline.partial.detail", { detail: timeline.warnings[0] })
    }) : null,
    header,
    view.filesReported && view.files.length === 0 && timeline.events.length > 0 ? h7(Banner, { kind: "info", text: t("timeline.noFilesNotice") }) : null,
    h7(
      "div",
      { className: "dvt-tl", role: "list", "aria-label": t("source.timeline") },
      groups.map((group) => h7(
        "section",
        { key: group.key, className: "dvt-tl-group" },
        h7(DayHeader, { group, deps, now }),
        h7(
          "ul",
          { className: "dvt-tl-list" },
          group.events.map((event) => h7(TimelineRow, {
            key: event.id,
            event,
            deps,
            handlers,
            selectedPath: state.selectedFilePath,
            visiblePaths,
            headRevision: repository.currentRevision,
            now
          }))
        )
      ))
    ),
    h7(
      "div",
      { className: "dvt-list-count" },
      view.selected === null ? t("timeline.count.label", { count: rows.length }) : t("timeline.filteredCount", { count: rows.length, total: timeline.events.length })
    ),
    timeline.hasMore ? h7(
      "div",
      { className: "dvt-list-more" },
      h7("button", {
        type: "button",
        className: "dvt-btn dvt-btn-sm",
        disabled: timeline.loadingMore,
        onClick: handlers.onLoadMoreTimeline
      }, timeline.loadingMore ? t("common.loadingMore") : t("timeline.more"))
    ) : null,
    timeline.hasMore ? h7("div", { className: "dvt-list-window" }, t("timeline.windowNotice", { count: timeline.events.length })) : null
  );
}

// src/client/ui/status.ts
var React8 = __toESM(require("react"), 1);
var h8 = React8.createElement;
function treeState(state) {
  const status = state.status;
  if (status === null) return { cls: "dvt-dot-none", label: "" };
  if (status.conflicts.length > 0) return { cls: "dvt-dot-conflict", label: "conflict" };
  return status.clean ? { cls: "dvt-dot-clean", label: "clean" } : { cls: "dvt-dot-dirty", label: "dirty" };
}
function renderStatusBar(state, deps, handlers) {
  const { t } = deps;
  const repository = selectedRepository(state);
  const status = state.status;
  const tree = treeState(state);
  const branch = status?.branch ?? repository?.currentBranch ?? (repository?.currentRevision === void 0 ? "" : shortHash(repository.currentRevision, 8));
  const left = [];
  const push = (node) => {
    if (left.length > 0) left.push(h8(DotSep, { key: `sep-${left.length}` }));
    left.push(node);
  };
  if (repository === null) {
    push(h8(
      "span",
      { key: "none", className: "dvt-status-item" },
      h8("span", { className: "dvt-dot dvt-dot-none", "aria-hidden": "true" }),
      h8("span", null, t("status.noRepo"))
    ));
  } else {
    push(h8(
      "span",
      { key: "tree", className: "dvt-status-item", title: tree.label === "" ? "" : tree.label === "clean" ? t("status.clean") : tree.label === "dirty" ? t("status.dirty") : t("status.conflicts", { count: status?.conflicts.length ?? 0 }) },
      h8("span", { className: `dvt-dot ${tree.cls}`, "aria-hidden": "true" }),
      status === null ? h8("span", null, state.statusLoading ? t("status.loading") : t("footer.statusError")) : h8("span", null, tree.label === "clean" ? t("status.clean") : tree.label === "dirty" ? t("status.dirty") : t("status.conflicts", { count: status.conflicts.length }))
    ));
    if (branch !== "") {
      push(h8(
        "span",
        { key: "branch", className: "dvt-status-item" },
        h8("span", { className: "dvt-mono dvt-clip", title: branch }, branch)
      ));
    }
    if (status !== null && status.entries.length > 0) {
      push(h8(
        "span",
        { key: "changes", className: "dvt-status-item" },
        h8("span", null, t("status.changes", { count: status.entries.length }))
      ));
    }
    if (status !== null && status.conflicts.length > 0) {
      push(h8(
        "span",
        { key: "conflicts", className: "dvt-status-item dvt-badge dvt-badge-error" },
        h8("span", null, t("status.conflicts", { count: status.conflicts.length }))
      ));
    }
  }
  return h8(
    "div",
    { className: "dvt-statusbar" },
    left,
    h8("span", { className: "dvt-status-spacer" }),
    repository === null ? null : h8("span", { key: "vcs", className: "dvt-status-item dvt-faint" }, vcsLabel(repository.vcsType, t)),
    h8(
      "button",
      {
        type: "button",
        className: "dvt-statusbtn",
        "aria-expanded": state.diagnosticsOpen,
        "aria-label": t("aria.diagnostics"),
        title: t("aria.diagnostics"),
        onClick: handlers.onToggleDiagnostics
      },
      h8(IconSliders, { size: 11 }),
      h8("span", null, t("status.diagnostics")),
      h8(state.diagnosticsOpen ? IconChevronDown : IconChevronRight, { size: 11 })
    )
  );
}
function diagCells(row) {
  return [
    h8("span", { key: `${row.key}-k`, className: "dvt-diag-key" }, row.label),
    h8("span", { key: `${row.key}-v`, className: `dvt-diag-val${row.warn === true ? " dvt-diag-warn" : ""}` }, row.value)
  ];
}
function renderDiagnostics(state, deps) {
  if (!state.diagnosticsOpen) return null;
  const { t } = deps;
  const diagnostics = state.diagnostics;
  const rows = [];
  if (diagnostics === null) {
    rows.push({ key: "loading", label: t("common.loading"), value: t("status.loading") });
  } else {
    rows.push({ key: "plugin", label: t("status.diag.plugin"), value: `v${diagnostics.pluginVersion}` });
    rows.push({
      key: "runtime",
      label: t("status.diag.runtime"),
      value: `${diagnostics.platform} \xB7 DSH ${diagnostics.dshVersion ?? t("status.diag.versionUnknown")}`
    });
    rows.push({
      key: "git",
      label: t("footer.git"),
      value: diagnostics.gitVersion ?? t("status.diag.missing"),
      warn: diagnostics.gitVersion === null
    });
    rows.push({
      key: "svn",
      label: t("footer.svn"),
      value: diagnostics.svnVersion ?? t("status.diag.missing"),
      warn: diagnostics.svnVersion === null
    });
    rows.push({ key: "workspaces", label: t("status.diag.workspaces"), value: String(diagnostics.workspaceCount) });
    rows.push({ key: "data", label: t("status.diag.dataDir"), value: diagnostics.dataDir });
    for (const [index, warning] of diagnostics.warnings.entries()) {
      rows.push({ key: `warn-${index}`, label: t("status.diag.warnings"), value: warning, warn: true });
    }
  }
  return h8(
    "div",
    { className: "dvt-diag" },
    h8("div", { className: "dvt-diag-title" }, t("status.diag.title")),
    h8("div", { className: "dvt-diag-grid" }, rows.flatMap(diagCells))
  );
}

// src/client/ui/toolbar.ts
var React9 = __toESM(require("react"), 1);
var h9 = React9.createElement;
function operationHint(operation, t) {
  switch (operation) {
    case "fetch":
      return t("toolbar.hint.fetch");
    case "pull":
      return t("toolbar.hint.pull");
    case "push":
      return t("toolbar.hint.push");
    case "update":
      return t("toolbar.hint.update");
    case "commit":
      return t("toolbar.hint.commit");
    default:
      return "";
  }
}
function RepositoryPicker(props) {
  const { state, handlers, t } = props;
  const repository = selectedRepository(state);
  const name = repository?.displayName ?? t("toolbar.noRepository");
  const vcs = repository === null ? "" : repository.vcsType === "git" ? "Git" : "SVN";
  return h9(
    "label",
    {
      className: "dvt-repo",
      title: repository?.rootPath ?? t("toolbar.noRepository")
    },
    h9("span", { className: "dvt-repo-icon" }, h9(IconRepo, { size: 13 })),
    h9("span", { className: "dvt-repo-name" }, name),
    vcs === "" ? null : h9("span", { className: "dvt-repo-vcs" }, vcs),
    h9("span", { className: "dvt-repo-caret" }, h9(IconChevronDown, { size: 12 })),
    h9(
      "select",
      {
        className: "dvt-repo-native",
        "aria-label": t("aria.repository"),
        value: state.selectedRepositoryId ?? "",
        onChange: (event) => handlers.onSelectRepository(event.currentTarget.value)
      },
      state.repositories.length === 0 ? h9("option", { value: "" }, t("repo.select")) : state.repositories.map((entry) => h9("option", { key: entry.id, value: entry.id }, repositoryOptionLabel(entry)))
    )
  );
}
function BranchChip(props) {
  const repository = props.repository;
  if (repository === null) return null;
  const text = repository.currentBranch ?? shortHash(repository.currentRevision, 8);
  if (text === "") return null;
  return h9(
    "span",
    {
      className: "dvt-branch",
      title: repository.currentBranch !== void 0 && repository.currentBranch !== "" ? props.t("repo.branchLabel", { branch: repository.currentBranch }) : props.t("repo.revisionLabel", { revision: text })
    },
    h9(IconBranch, { size: 11 }),
    h9("span", null, truncate(text, 16))
  );
}
function WriteMenu(props) {
  const { repository, handlers, t } = props;
  const operations = WRITE_OPERATIONS[repository.vcsType];
  const groups = [
    { key: "sync", title: t("toolbar.menu.sync"), icon: IconDownload },
    { key: "commit", title: t("toolbar.menu.commit"), icon: IconCheck },
    { key: "remote", title: t("toolbar.menu.remote"), icon: IconUpload }
  ];
  const sections = groups.map((group) => ({ ...group, ops: operations.filter((operation) => operationGroup(operation) === group.key) })).filter((group) => group.ops.length > 0);
  return h9(
    "div",
    { className: "dvt-menu", role: "menu", "aria-label": t("aria.writeMenu") },
    sections.flatMap((section, index) => [
      index === 0 ? null : h9("div", { key: `sep-${section.key}`, className: "dvt-menu-sep" }),
      h9("div", { key: `group-${section.key}`, className: "dvt-menu-group" }, section.title),
      ...section.ops.map((operation) => h9(
        "button",
        {
          key: operation,
          type: "button",
          role: "menuitem",
          className: "dvt-menu-item",
          onClick: () => {
            handlers.onCloseWriteMenu();
            handlers.onStartOperation(operation);
          }
        },
        h9("span", { className: "dvt-menu-icon" }, h9(section.icon, { size: 12 })),
        h9(
          "span",
          { className: "dvt-menu-labels" },
          h9("span", { className: "dvt-menu-label" }, t(`op.${operation}`)),
          h9("span", { className: "dvt-menu-hint" }, operationHint(operation, t))
        )
      ))
    ])
  );
}
function SourceTabs(props) {
  const { state, handlers, t } = props;
  const timelineCount = state.timeline.events.length;
  const auditCount = state.audit.operations.length;
  const tab = (source, label, count, Icon) => h9(
    "button",
    {
      type: "button",
      role: "tab",
      className: "dvt-tab",
      "aria-selected": state.source === source,
      onClick: () => handlers.onSetSource(source)
    },
    h9(Icon, { size: 12 }),
    h9("span", null, label),
    count > 0 ? h9("span", { className: "dvt-tab-count" }, count) : null
  );
  return h9(
    "div",
    { role: "tablist", className: "dvt-tabstrip", "aria-label": t("tab.title") },
    tab("timeline", t("source.timeline"), timelineCount, IconTimeline),
    tab("audit", t("source.audit"), auditCount, IconAudit)
  );
}
function FilterBar(props) {
  const { state, handlers, t } = props;
  const commitOnly = state.filters.eventTypes.includes("commit");
  return h9(
    "div",
    null,
    h9(
      "div",
      { className: "dvt-filterbar" },
      h9(
        "span",
        { className: "dvt-search" },
        h9(IconSearch, { size: 12 }),
        h9("input", {
          className: "dvt-search-input",
          type: "search",
          value: state.filters.text,
          placeholder: t("filter.search.placeholder"),
          "aria-label": t("aria.search"),
          onChange: (event) => handlers.onTextChange(event.currentTarget.value)
        }),
        state.filters.text === "" ? null : h9("button", {
          type: "button",
          className: "dvt-search-clear",
          "aria-label": t("aria.clearSearch"),
          title: t("aria.clearSearch"),
          onClick: () => handlers.onClearFilters()
        }, h9(IconClose, { size: 11 }))
      ),
      h9(
        "span",
        { className: "dvt-chips", role: "group", "aria-label": t("filter.toggle") },
        h9("button", {
          type: "button",
          className: "dvt-chip",
          "aria-pressed": !commitOnly,
          onClick: handlers.onShowAllEventTypes
        }, t("filter.chip.all")),
        h9("button", {
          type: "button",
          className: "dvt-chip",
          "aria-pressed": commitOnly,
          onClick: () => handlers.onToggleEventType("commit")
        }, t("filter.chip.commit"))
      ),
      h9(
        "label",
        { className: "dvt-time" },
        h9(IconClock, { size: 11 }),
        h9(
          "select",
          {
            className: "dvt-time-select",
            "aria-label": t("filter.time"),
            value: state.filters.timePreset,
            onChange: (event) => {
              handlers.onSetTimePreset(event.currentTarget.value);
            }
          },
          TIME_PRESETS.map((preset) => h9("option", { key: preset, value: preset }, timePresetLabel(preset, t)))
        )
      ),
      h9(IconButton, {
        label: t("filter.toggle"),
        icon: IconFilter,
        pressed: state.filters.showAuthor,
        onClick: handlers.onToggleAuthor
      })
    ),
    state.filters.showAuthor ? h9(
      "div",
      { className: "dvt-author-row" },
      h9("input", {
        className: "dvt-input",
        type: "text",
        value: state.filters.author,
        placeholder: t("filter.author.placeholder"),
        "aria-label": t("aria.author"),
        onChange: (event) => handlers.onAuthorChange(event.currentTarget.value)
      }),
      h9("button", { type: "button", className: "dvt-btn dvt-btn-ghost dvt-btn-sm", onClick: handlers.onClearFilters }, t("filter.clear"))
    ) : null
  );
}
function renderChrome(state, deps, handlers) {
  const { t } = deps;
  const repository = selectedRepository(state);
  const menuOpen = state.menuOpen && repository !== null;
  return h9(
    "div",
    { className: "dvt-chrome" },
    h9(
      "div",
      { className: "dvt-toolbar" },
      h9(RepositoryPicker, { state, handlers, t }),
      h9(BranchChip, { repository, t }),
      h9(
        "span",
        { className: "dvt-toolbar-actions" },
        h9(IconButton, {
          label: t("aria.refresh"),
          icon: IconRefresh,
          disabled: state.boot === "loading",
          onClick: handlers.onRefreshRepositories
        }),
        h9(IconButton, {
          label: t("aria.writeMenu"),
          icon: IconMore,
          expanded: menuOpen,
          disabled: repository === null,
          onClick: () => {
            if (state.menuOpen) handlers.onCloseWriteMenu();
            else handlers.onToggleWriteMenu();
          }
        })
      )
    ),
    menuOpen ? h9("div", { className: "dvt-menu-overlay", onClick: handlers.onCloseWriteMenu, "aria-hidden": "true" }) : null,
    menuOpen && repository !== null ? h9(WriteMenu, { repository, handlers, t }) : null,
    h9(SourceTabs, { state, handlers, t }),
    state.source === "timeline" ? h9(FilterBar, { state, handlers, t }) : null,
    state.boot === "error" && state.repositories.length > 0 && state.bootError !== null ? h9(Banner, {
      kind: "error",
      text: errorMessage(state.bootError, t),
      action: h9("button", { type: "button", className: "dvt-btn dvt-btn-sm", onClick: handlers.onRefreshRepositories }, t("common.retry"))
    }) : null,
    state.noWorkspace && state.repositories.length === 0 ? h9(Banner, { kind: "info", text: `${t("state.noWorkspace.title")} \u2014 ${t("state.noWorkspace.hint")}` }) : null
  );
}

// src/client/components.ts
var h10 = React10.createElement;
function renderPanelView(props) {
  const { state, deps, handlers } = props;
  const locale = deps.locale ?? "zh";
  const audit = state.source === "audit";
  const view = buildTimelineView(state.timeline.events, {
    query: state.filters.treeQuery,
    status: state.filters.fileStatus,
    selectedPath: state.selectedFilePath
  });
  let pinned = null;
  let body;
  if (state.diff.filePath !== null) {
    pinned = diffHeader(state, deps, handlers);
    body = diffBody(state, deps, handlers);
  } else if (state.changeSet.event !== null) {
    pinned = commitDetailHeader(state, deps, handlers);
    body = commitDetailBody(state, deps, handlers);
  } else if (audit && state.audit.selected !== null) {
    pinned = auditDetailHeader(state, deps, handlers);
    body = auditDetailBody(state, deps, handlers);
  } else if (audit) {
    body = renderAuditList(state, deps, handlers);
  } else {
    body = renderHistory(state, deps, handlers, view);
  }
  const pane = h10(
    "div",
    { key: "pane", className: "dvt-pane" },
    pinned === null ? null : h10("div", { key: "pinned", className: "dvt-pinned" }, pinned),
    h10("div", { key: "scroll", className: "dvt-scroll" }, body)
  );
  const bodyElement = audit ? pane : h10(
    "div",
    { key: "split", className: "dvt-split" },
    renderFileTree(state, deps, handlers, view),
    pane
  );
  return h10(
    "div",
    {
      className: "dvt-root",
      "data-dvt-panel": "vcs-timeline",
      lang: locale === "en" ? "en" : "zh-CN",
      ...props.rootRef === void 0 ? {} : { ref: props.rootRef }
    },
    h10("style", { key: "dvt-styles" }, deps.styles ?? STYLES),
    h10("div", { key: "chrome" }, renderChrome(state, deps, handlers)),
    h10("div", { key: "body", className: "dvt-body" }, bodyElement),
    renderDiagnostics(state, deps),
    renderStatusBar(state, deps, handlers),
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
    filters: {
      text: "",
      debouncedText: "",
      eventTypes: [],
      author: "",
      showAuthor: false,
      treeQuery: "",
      fileStatus: "all",
      timePreset: "all"
    },
    selectedFilePath: null,
    expandedDirs: {},
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
    copied: false,
    menuOpen: false,
    diagnosticsOpen: false
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
    const [state, setState] = React11.useState(createInitialState);
    const stateRef = React11.useRef(state);
    stateRef.current = state;
    const aliveRef = React11.useRef(true);
    const rootRef = React11.useRef(null);
    const copyTimerRef = React11.useRef(null);
    const repreviewTimerRef = React11.useRef(null);
    const timelineTokenRef = React11.useRef(0);
    const auditTokenRef = React11.useRef(0);
    const statusTokenRef = React11.useRef(0);
    const detailTokenRef = React11.useRef(0);
    const diffTokenRef = React11.useRef(0);
    const dialogTokenRef = React11.useRef(0);
    React11.useEffect(() => () => {
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
      const query = { repositoryId, limit: DEFAULT_PAGE_SIZE, includeFiles: true };
      const text = filters.debouncedText.trim();
      if (text !== "") query.text = text;
      if (filters.eventTypes.length > 0) query.eventTypes = [...filters.eventTypes];
      const author = filters.author.trim();
      if (author !== "") query.author = author;
      const since = windowSince(filters.timePreset, deps.now?.() ?? Date.now());
      if (since !== void 0) query.since = since;
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
        menuOpen: false,
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
    React11.useLayoutEffect(() => {
      const element = rootRef.current;
      if (element === null || typeof window === "undefined") return void 0;
      const scroller = element.closest("[data-conversation-scroll]");
      if (!(scroller instanceof HTMLElement)) return void 0;
      const observed = [scroller, ...Array.from(scroller.children)];
      const update = () => {
        const scrollerRect = scroller.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        let reserved = 0;
        for (const child of Array.from(scroller.children)) {
          if (child.contains(element)) continue;
          if (child.getBoundingClientRect().height <= 0) continue;
          const position = window.getComputedStyle(child).position;
          if (position === "absolute" || position === "fixed") continue;
          reserved += child.getBoundingClientRect().height;
        }
        const offset = Math.max(0, elementRect.top - scrollerRect.top);
        const available = Math.max(240, Math.floor(scroller.clientHeight - offset - reserved));
        element.style.height = `${available}px`;
      };
      update();
      const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
        update();
      }) : null;
      if (observer !== null) for (const target of observed) observer.observe(target);
      window.addEventListener("resize", update);
      return () => {
        observer?.disconnect();
        window.removeEventListener("resize", update);
        element.style.height = "";
      };
    }, []);
    React11.useEffect(() => {
      void reloadRepositories();
    }, []);
    React11.useEffect(() => {
      const repositoryId = state.selectedRepositoryId;
      if (repositoryId === null) return;
      void loadStatus(repositoryId);
    }, [state.selectedRepositoryId, state.statusTick]);
    React11.useEffect(() => {
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
      state.filters.timePreset,
      state.refreshTick
    ]);
    React11.useEffect(() => {
      const handle = setTimeout(() => {
        setState((prev) => prev.filters.text === prev.filters.debouncedText ? prev : { ...prev, filters: { ...prev.filters, debouncedText: prev.filters.text } });
      }, 250);
      return () => clearTimeout(handle);
    }, [state.filters.text]);
    const overlayOpen = state.dialog !== null || state.menuOpen || state.diagnosticsOpen;
    React11.useEffect(() => {
      if (!overlayOpen || typeof document === "undefined") return;
      const onKeyDown = (event) => {
        if (event.key !== "Escape") return;
        const snapshot = stateRef.current;
        if (snapshot.dialog !== null) {
          if (snapshot.dialog.phase === "executing") return;
          event.stopPropagation();
          setState((prev) => ({ ...prev, dialog: null }));
          return;
        }
        if (snapshot.menuOpen) {
          event.stopPropagation();
          setState((prev) => ({ ...prev, menuOpen: false }));
          return;
        }
        if (snapshot.diagnosticsOpen) {
          event.stopPropagation();
          setState((prev) => ({ ...prev, diagnosticsOpen: false }));
        }
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }, [overlayOpen]);
    const handlers = {
      onRefreshRepositories: () => {
        setState((prev) => ({ ...prev, menuOpen: false, refreshTick: prev.refreshTick + 1, statusTick: prev.statusTick + 1 }));
        void reloadRepositories();
      },
      onSelectRepository: (repositoryId) => {
        setState((prev) => {
          const selected = repositoryId === "" ? null : repositoryId;
          if (selected === prev.selectedRepositoryId) return prev;
          return {
            ...prev,
            menuOpen: false,
            selectedRepositoryId: selected,
            selectedFilePath: null,
            expandedDirs: {},
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
          menuOpen: false,
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
        selectedFilePath: null,
        filters: {
          text: "",
          debouncedText: "",
          eventTypes: [],
          author: "",
          showAuthor: prev.filters.showAuthor,
          treeQuery: "",
          fileStatus: "all",
          timePreset: "all"
        }
      })),
      onSelectFile: (path) => setState((prev) => {
        if (path === prev.selectedFilePath) return prev;
        const expanded = { ...prev.expandedDirs };
        if (path !== null) {
          const segments = path.split("/");
          let dir = "";
          for (const segment of segments.slice(0, -1)) {
            dir = dir === "" ? segment : `${dir}/${segment}`;
            expanded[dir] = true;
          }
        }
        return {
          ...prev,
          selectedFilePath: path,
          expandedDirs: expanded,
          changeSet: createChangeSetSlice(),
          diff: createDiffSlice()
        };
      }),
      onTreeQueryChange: (treeQuery) => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, treeQuery }
      })),
      onSetFileStatus: (fileStatus) => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, fileStatus }
      })),
      onToggleDir: (path) => setState((prev) => ({
        ...prev,
        expandedDirs: { ...prev.expandedDirs, [path]: prev.expandedDirs[path] !== true }
      })),
      onExpandAllDirs: () => setState((prev) => {
        const visible = filterFileEntries(
          aggregateChangedFiles(prev.timeline.events),
          prev.filters.treeQuery,
          prev.filters.fileStatus
        );
        const expanded = { ...prev.expandedDirs };
        for (const dir of directoryPaths(buildFileTree(visible))) expanded[dir] = true;
        return { ...prev, expandedDirs: expanded };
      }),
      onCollapseAllDirs: () => setState((prev) => ({ ...prev, expandedDirs: {} })),
      onSetTimePreset: (timePreset) => setState((prev) => ({
        ...prev,
        filters: { ...prev.filters, timePreset }
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
      onRetryStatus: () => setState((prev) => ({ ...prev, statusTick: prev.statusTick + 1 })),
      onToggleWriteMenu: () => setState((prev) => ({ ...prev, menuOpen: !prev.menuOpen })),
      onCloseWriteMenu: () => setState((prev) => prev.menuOpen ? { ...prev, menuOpen: false } : prev),
      onToggleDiagnostics: () => setState((prev) => ({ ...prev, diagnosticsOpen: !prev.diagnosticsOpen }))
    };
    return renderPanelView({ state, deps, handlers, rootRef });
  };
}

// src/client/ui-i18n.ts
var uiZh = {
  "aria.more": "\u66F4\u591A\u64CD\u4F5C",
  "aria.writeMenu": "\u7248\u672C\u63A7\u5236\u64CD\u4F5C",
  "aria.closeMenu": "\u5173\u95ED\u83DC\u5355",
  "aria.diagnostics": "\u73AF\u5883\u8BCA\u65AD",
  "aria.clearSearch": "\u6E05\u9664\u641C\u7D22",
  "aria.commitNode": "\u63D0\u4EA4\u8282\u70B9",
  "aria.fileStatus": "\u6587\u4EF6\u72B6\u6001",
  "aria.stats": "\u53D8\u66F4\u7EDF\u8BA1",
  "aria.copyRevision": "\u590D\u5236\u7248\u672C\u53F7",
  "aria.openDiff": "\u67E5\u770B\u8BE5\u6587\u4EF6\u7684 Diff",
  "aria.expandDetails": "\u5C55\u5F00\u8BE6\u60C5",
  "aria.collapseDetails": "\u6536\u8D77\u8BE6\u60C5",
  "toolbar.menu.title": "\u7248\u672C\u63A7\u5236",
  "toolbar.menu.sync": "\u540C\u6B65",
  "toolbar.menu.commit": "\u63D0\u4EA4",
  "toolbar.menu.remote": "\u8FDC\u7AEF",
  "toolbar.hint.fetch": "\u53EA\u4E0B\u8F7D\u8FDC\u7AEF\u63D0\u4EA4\uFF0C\u4E0D\u4FEE\u6539\u5DE5\u4F5C\u533A",
  "toolbar.hint.pull": "\u4EC5\u5141\u8BB8\u5FEB\u8FDB\u5408\u5E76\uFF0C\u4E0D\u4EA7\u751F\u5408\u5E76\u63D0\u4EA4",
  "toolbar.hint.push": "\u63A8\u9001\u5F53\u524D\u5206\u652F\u5230\u8FDC\u7AEF",
  "toolbar.hint.update": "\u4ECE\u670D\u52A1\u5668\u66F4\u65B0\u5DE5\u4F5C\u526F\u672C",
  "toolbar.hint.commit": "\u63D0\u4EA4\u5DF2\u6682\u5B58\u7684\u6539\u52A8",
  "toolbar.noRepository": "\u672A\u9009\u62E9\u4ED3\u5E93",
  "timeline.stats.file": "1 \u4E2A\u6587\u4EF6",
  "timeline.stats.files": "{count} \u4E2A\u6587\u4EF6",
  "timeline.merge": "\u5408\u5E76",
  "timeline.count.label": "{count} \u6761\u63D0\u4EA4",
  "timeline.empty.uninitialized": "\u4ED3\u5E93\u8FD8\u6CA1\u6709\u4EFB\u4F55\u63D0\u4EA4",
  "timeline.empty.uninitialized.hint": "\u5B8C\u6210\u7B2C\u4E00\u6B21\u63D0\u4EA4\u540E\uFF0C\u8FD9\u91CC\u4F1A\u663E\u793A\u63D0\u4EA4\u5386\u53F2\u3002",
  "timeline.partial.detail": "\u90E8\u5206\u6570\u636E\u6E90\u4E0D\u53EF\u7528\uFF1A{detail}",
  "timeline.filters.active": "\u5DF2\u7B5B\u9009",
  "detail.files.header": "\u53D8\u66F4\u6587\u4EF6",
  "detail.files.stats": "{files} \u4E2A\u6587\u4EF6",
  "detail.commit": "\u63D0\u4EA4",
  "detail.stats.unavailable": "\u6B64\u7248\u672C\u672A\u63D0\u4F9B\u589E\u5220\u884C\u7EDF\u8BA1",
  "detail.openDiff": "\u67E5\u770B Diff",
  "detail.copyHash": "\u590D\u5236\u63D0\u4EA4\u53F7",
  "detail.emptyFiles": "\u6B64\u63D0\u4EA4\u6CA1\u6709\u6587\u4EF6\u53D8\u66F4",
  "diff.added": "+{count}",
  "diff.removed": "\u2212{count}",
  "diff.binary.hint": "\u4E8C\u8FDB\u5236\u6587\u4EF6\u4E0D\u63D0\u4F9B\u6587\u672C\u5DEE\u5F02\uFF0C\u53EF\u5728\u4ED3\u5E93\u4E2D\u76F4\u63A5\u67E5\u770B\u3002",
  "diff.hunk": "\u5DEE\u5F02\u7247\u6BB5",
  "diff.lineNumbers": "\u884C\u53F7",
  "diff.header": "\u6587\u4EF6\u5DEE\u5F02",
  "audit.empty.hint": "\u672C\u63D2\u4EF6\u5C1A\u672A\u5BF9\u8BE5\u4ED3\u5E93\u6267\u884C\u5199\u64CD\u4F5C\uFF1B\u4ED3\u5E93\u81EA\u8EAB\u7684\u5386\u53F2\u8BF7\u67E5\u770B\u65F6\u95F4\u7EBF\u3002",
  "audit.duration": "\u8017\u65F6",
  "audit.correlation": "\u5173\u8054 ID",
  "audit.state.unknown.hint": "\u8FDC\u7AEF\u7ED3\u679C\u65E0\u6CD5\u786E\u8BA4\uFF0C\u8BF7\u4EBA\u5DE5\u68C0\u67E5\u4ED3\u5E93\u72B6\u6001\u540E\u518D\u51B3\u5B9A\u3002",
  "status.noRepo": "\u672A\u9009\u62E9\u4ED3\u5E93",
  "status.clean": "\u5DE5\u4F5C\u533A\u5E72\u51C0",
  "status.dirty": "\u6709\u672A\u63D0\u4EA4\u4FEE\u6539",
  "status.changes": "{count} \u9879\u53D8\u66F4",
  "status.conflicts": "{count} \u4E2A\u51B2\u7A81",
  "status.staged": "{count} \u9879\u5DF2\u6682\u5B58",
  "status.diagnostics": "\u8BCA\u65AD",
  "status.diag.title": "\u73AF\u5883\u8BCA\u65AD",
  "status.diag.plugin": "\u63D2\u4EF6",
  "status.diag.runtime": "\u8FD0\u884C\u73AF\u5883",
  "status.diag.dataDir": "\u6570\u636E\u76EE\u5F55",
  "status.diag.workspaces": "\u5DE5\u4F5C\u533A",
  "status.diag.warnings": "\u8B66\u544A",
  "status.diag.missing": "\u672A\u5B89\u88C5",
  "status.diag.versionUnknown": "\u672A\u77E5",
  "status.loading": "\u8BFB\u53D6\u72B6\u6001\u2026",
  "status.summarySeparator": "\xB7",
  "state.noWorkspace.title": "\u672A\u9009\u62E9\u5DE5\u4F5C\u533A",
  "state.noWorkspace.hint": "\u6253\u5F00\u4E00\u4E2A\u4F1A\u8BDD\u540E\uFF0C\u63D2\u4EF6\u4F1A\u626B\u63CF\u8BE5\u4F1A\u8BDD\u7684\u5DE5\u4F5C\u533A\u4EE5\u53D1\u73B0 Git/SVN \u4ED3\u5E93\u3002",
  "state.noRepositories.title": "\u672A\u68C0\u6D4B\u5230\u4ED3\u5E93",
  "state.noRepositories.hint": "\u5F53\u524D\u5DE5\u4F5C\u533A\u5185\u6CA1\u6709 Git \u6216 SVN \u4ED3\u5E93\u3002\u6253\u5F00\u5305\u542B\u4ED3\u5E93\u76EE\u5F55\u7684\u5DE5\u4F5C\u533A\u540E\u5237\u65B0\u3002",
  "state.error.title": "\u65E0\u6CD5\u8BFB\u53D6\u4ED3\u5E93",
  "state.partial.title": "\u90E8\u5206\u6570\u636E\u4E0D\u53EF\u7528",
  "common.expand": "\u5C55\u5F00",
  "common.collapse": "\u6536\u8D77",
  "common.copy": "\u590D\u5236",
  "common.copied": "\u5DF2\u590D\u5236",
  "common.files": "\u6587\u4EF6",
  "common.refreshCount": "\u5237\u65B0",
  // File-centered browser: the left tree, the shared filters, the composer
  // dock and the fullscreen frame.
  "tree.pane": "\u53D8\u66F4\u6587\u4EF6",
  "tree.title": "\u6587\u4EF6",
  "tree.filesInWindow": "\u5F53\u524D\u7A97\u53E3\u5185 {count} \u4E2A\u6587\u4EF6",
  "tree.expandAll": "\u5C55\u5F00\u5168\u90E8\u76EE\u5F55",
  "tree.collapseAll": "\u6536\u8D77\u5168\u90E8\u76EE\u5F55",
  "tree.search": "\u6309\u6587\u4EF6\u540D\u641C\u7D22",
  "tree.search.placeholder": "\u641C\u7D22\u6587\u4EF6\u540D",
  "tree.statusFilter": "\u6309\u6587\u4EF6\u72B6\u6001\u7B5B\u9009",
  "tree.statusChip": "{status}\uFF08{count}\uFF09",
  "tree.dirCount": "{count} \u4E2A\u6587\u4EF6",
  "tree.changeCount": "\u5728 {count} \u6B21\u63D0\u4EA4\u4E2D\u53D8\u66F4",
  "tree.all": "\u5168\u90E8\u6587\u4EF6",
  "tree.commitCount": "{count} \u6B21\u63D0\u4EA4",
  "tree.showAll": "\u663E\u793A\u5168\u90E8\u6587\u4EF6",
  "tree.empty": "\u5F53\u524D\u7A97\u53E3\u6CA1\u6709\u53D8\u66F4\u6587\u4EF6",
  "tree.filtered": "\u6CA1\u6709\u7B26\u5408\u7B5B\u9009\u6761\u4EF6\u7684\u6587\u4EF6",
  "tree.filtered.hint": "\u8C03\u6574\u6587\u4EF6\u540D\u641C\u7D22\u6216\u72B6\u6001\u7B5B\u9009\u540E\u91CD\u8BD5\u3002",
  "tree.unavailable.title": "\u6570\u636E\u6E90\u672A\u63D0\u4F9B\u6587\u4EF6\u5217\u8868",
  "tree.unavailable.hint": "Host \u672A\u8FD4\u56DE\u9010\u63D0\u4EA4\u6587\u4EF6\u6E05\u5355\uFF08\u4F8B\u5982 SVN \u9002\u914D\u5668\u6216\u65E7\u7248 Host\uFF09\uFF0C\u8BF7\u4EE5\u53F3\u4FA7\u63D0\u4EA4\u5217\u8868\u4E3A\u51C6\u3002",
  "aria.treeFile": "{path}\uFF08{status}\uFF09",
  "filter.time": "\u65F6\u95F4\u8303\u56F4",
  "time.all": "\u5168\u90E8\u65F6\u95F4",
  "time.24h": "\u8FD1 24 \u5C0F\u65F6",
  "time.7d": "\u8FD1 7 \u5929",
  "time.30d": "\u8FD1 30 \u5929",
  "timeline.empty.file": "\u8BE5\u6587\u4EF6\u5728\u5F53\u524D\u7A97\u53E3\u5185\u6CA1\u6709\u53D8\u66F4",
  "timeline.empty.file.hint": "\u5207\u6362\u65F6\u95F4\u8303\u56F4\u6216\u663E\u793A\u5168\u90E8\u6587\u4EF6\u67E5\u770B\u66F4\u591A\u5386\u53F2\u3002",
  "timeline.noFilesNotice": "\u6B64\u7A97\u53E3\u5185\u7684\u63D0\u4EA4\u6CA1\u6709\u63D0\u4F9B\u6587\u4EF6\u5217\u8868\uFF0C\u6587\u4EF6\u6811\u4E0D\u53EF\u7528\u3002",
  "timeline.filteredCount": "{count} / {total} \u6B21\u63D0\u4EA4",
  "timeline.matchedFiles": "\u6D89\u53CA {count} \u4E2A\u7B5B\u9009\u6587\u4EF6",
  "timeline.windowNotice": "\u6587\u4EF6\u7D22\u5F15\u8986\u76D6\u5DF2\u52A0\u8F7D\u7684 {count} \u6B21\u63D0\u4EA4\uFF1B\u52A0\u8F7D\u66F4\u591A\u53EF\u6269\u5927\u8303\u56F4\u3002",
  "view.tab": "\u4EE3\u7801\u65F6\u95F4\u7EBF",
  "group.today": "\u4ECA\u5929",
  "group.yesterday": "\u6628\u5929",
  "rel.justNow": "\u521A\u521A",
  "rel.minutesAgo": "{count} \u5206\u949F\u524D",
  "rel.hoursAgo": "{count} \u5C0F\u65F6\u524D",
  "rel.daysAgo": "{count} \u5929\u524D",
  "timeline.head": "HEAD"
};
var uiEn = {
  "aria.more": "More actions",
  "aria.writeMenu": "Version control actions",
  "aria.closeMenu": "Close menu",
  "aria.diagnostics": "Environment diagnostics",
  "aria.clearSearch": "Clear search",
  "aria.commitNode": "Commit node",
  "aria.fileStatus": "File status",
  "aria.stats": "Change statistics",
  "aria.copyRevision": "Copy revision",
  "aria.openDiff": "View the diff for this file",
  "aria.expandDetails": "Expand details",
  "aria.collapseDetails": "Collapse details",
  "toolbar.menu.title": "Version control",
  "toolbar.menu.sync": "Sync",
  "toolbar.menu.commit": "Commit",
  "toolbar.menu.remote": "Remote",
  "toolbar.hint.fetch": "Download remote commits without touching the working tree",
  "toolbar.hint.pull": "Fast-forward only; never creates a merge commit",
  "toolbar.hint.push": "Push the current branch to the remote",
  "toolbar.hint.update": "Update the working copy from the server",
  "toolbar.hint.commit": "Commit already-staged changes",
  "toolbar.noRepository": "No repository selected",
  "timeline.stats.file": "1 file",
  "timeline.stats.files": "{count} files",
  "timeline.merge": "Merge",
  "timeline.count.label": "{count} commits",
  "timeline.empty.uninitialized": "This repository has no commits yet",
  "timeline.empty.uninitialized.hint": "The commit history appears here after the first commit.",
  "timeline.partial.detail": "Some data is unavailable: {detail}",
  "timeline.filters.active": "Filtered",
  "detail.files.header": "Changed files",
  "detail.files.stats": "{files} files",
  "detail.commit": "Commit",
  "detail.stats.unavailable": "Line statistics were not reported for this revision",
  "detail.openDiff": "View diff",
  "detail.copyHash": "Copy commit hash",
  "detail.emptyFiles": "This commit has no file changes",
  "diff.added": "+{count}",
  "diff.removed": "\u2212{count}",
  "diff.binary.hint": "Binary files have no textual diff; inspect the file in the repository.",
  "diff.hunk": "Hunk",
  "diff.lineNumbers": "Line numbers",
  "diff.header": "File diff",
  "audit.empty.hint": "This plugin has not performed write operations on this repository; see the timeline for repository history.",
  "audit.duration": "Duration",
  "audit.correlation": "Correlation ID",
  "audit.state.unknown.hint": "The remote result cannot be confirmed; inspect the repository state before deciding.",
  "status.noRepo": "No repository selected",
  "status.clean": "Working tree clean",
  "status.dirty": "Uncommitted changes",
  "status.changes": "{count} changes",
  "status.conflicts": "{count} conflicts",
  "status.staged": "{count} staged",
  "status.diagnostics": "Diagnostics",
  "status.diag.title": "Environment",
  "status.diag.plugin": "Plugin",
  "status.diag.runtime": "Runtime",
  "status.diag.dataDir": "Data directory",
  "status.diag.workspaces": "Workspaces",
  "status.diag.warnings": "Warnings",
  "status.diag.missing": "not installed",
  "status.diag.versionUnknown": "unknown",
  "status.loading": "Reading status\u2026",
  "status.summarySeparator": "\xB7",
  "state.noWorkspace.title": "No workspace selected",
  "state.noWorkspace.hint": "Open a session; the plugin scans that session workspace for Git/SVN repositories.",
  "state.noRepositories.title": "No repository detected",
  "state.noRepositories.hint": "This workspace contains no Git or SVN repository. Open a workspace that contains one, then refresh.",
  "state.error.title": "Cannot read repositories",
  "state.partial.title": "Partial data",
  "common.expand": "Expand",
  "common.collapse": "Collapse",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.files": "files",
  "common.refreshCount": "Refresh",
  // File-centered browser: the left tree, the shared filters, the composer
  // dock and the fullscreen frame.
  "tree.pane": "Changed files",
  "tree.title": "Files",
  "tree.filesInWindow": "{count} files in the loaded window",
  "tree.expandAll": "Expand all directories",
  "tree.collapseAll": "Collapse all directories",
  "tree.search": "Search by file name",
  "tree.search.placeholder": "Search files",
  "tree.statusFilter": "Filter by file status",
  "tree.statusChip": "{status} ({count})",
  "tree.dirCount": "{count} files",
  "tree.changeCount": "changed in {count} commits",
  "tree.all": "All files",
  "tree.commitCount": "{count} commits",
  "tree.showAll": "Show all files",
  "tree.empty": "No changed files in the loaded window",
  "tree.filtered": "No files match the filters",
  "tree.filtered.hint": "Adjust the file search or the status filter and try again.",
  "tree.unavailable.title": "The data source did not report file lists",
  "tree.unavailable.hint": "The Host returned no per-commit file lists (for example the SVN adapter or an older Host); use the commit list on the right.",
  "aria.treeFile": "{path} ({status})",
  "filter.time": "Time range",
  "time.all": "All time",
  "time.24h": "Last 24 hours",
  "time.7d": "Last 7 days",
  "time.30d": "Last 30 days",
  "timeline.empty.file": "This file did not change in the loaded window",
  "timeline.empty.file.hint": "Widen the time range or show all files to see more history.",
  "timeline.noFilesNotice": "Commits in this window reported no file lists, so the file tree is unavailable.",
  "timeline.filteredCount": "{count} / {total} commits",
  "timeline.matchedFiles": "{count} matching files",
  "timeline.windowNotice": "The file index covers the {count} loaded commits; load more to widen it.",
  "view.tab": "Code Timeline",
  "group.today": "Today",
  "group.yesterday": "Yesterday",
  "rel.justNow": "just now",
  "rel.minutesAgo": "{count}m ago",
  "rel.hoursAgo": "{count}h ago",
  "rel.daysAgo": "{count}d ago",
  "timeline.head": "HEAD"
};

// src/client/i18n.ts
var baseZh = {
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
var baseEn = {
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
var zh = { ...baseZh, ...uiZh };
var en = { ...baseEn, ...uiEn };
function normalizeLocale(raw) {
  return typeof raw === "string" && raw.toLowerCase().startsWith("en") ? "en" : "zh";
}

// src/client/index.ts
var NS = "vcs-timeline";
var TAB_ID = "vcs-timeline";
var VIEW_ID = "vcs-timeline";
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
  const panelComponent = (attributes) => React12.createElement(Panel, attributes ?? {});
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
      () => React12.createElement("span", null, translate("tab.title"))
    ));
    return () => {
      body();
      title();
    };
  }, "dsh-vcs-timeline: tab body");
  ctx.effect(() => {
    const slots = services.slots;
    let dispose;
    try {
      dispose = slots.inject("conversation.view", () => {
        try {
          return slots.register(
            {
              name: "conversation.view",
              id: VIEW_ID,
              order: 40,
              locale: NS,
              label: () => translate("view.tab")
            },
            panelComponent
          );
        } catch {
          return () => {
          };
        }
      });
    } catch {
      dispose = void 0;
    }
    return () => {
      dispose?.();
    };
  }, "dsh-vcs-timeline: conversation view");
}

    })(module, exports, require);
    return module.exports;
  },
});
