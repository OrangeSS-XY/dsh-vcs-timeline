// src/host/adapters/git/adapter.ts
import { realpath } from "node:fs/promises";

// src/shared/contracts.ts
var SCHEMA_VERSION = 1;
var MAX_PAGE_SIZE = 100;
var DEFAULT_PAGE_SIZE = 30;
var DEFAULT_DIFF_MAX_BYTES = 256 * 1024;
var HARD_DIFF_MAX_BYTES = 2 * 1024 * 1024;
function isRepository(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return record.schemaVersion === SCHEMA_VERSION && typeof record.id === "string" && (record.vcsType === "git" || record.vcsType === "svn") && typeof record.rootPath === "string" && typeof record.displayName === "string";
}
function isOperationAttempt(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return record.schemaVersion === SCHEMA_VERSION && typeof record.id === "string" && typeof record.operation === "string" && typeof record.state === "string" && typeof record.correlationId === "string";
}
function isWriteOperation(operation) {
  switch (operation) {
    case "fetch":
    case "pull":
    case "update":
    case "commit":
    case "push":
      return true;
    default:
      return false;
  }
}

// src/host/security.ts
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
var SECRET_QUERY_KEYS = [
  "access_token",
  "auth",
  "key",
  "password",
  "passwd",
  "pwd",
  "secret",
  "sig",
  "signature",
  "token",
  "apikey",
  "api_key",
  "private_token",
  "client_secret",
  "session",
  "credential"
];
function redactUrl(raw) {
  let value = raw.trim();
  value = value.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]+@/, "$1");
  value = value.replace(/([?&])([A-Za-z0-9_.-]+)=([^&#\s]*)/g, (match, prefix, key, rawValue) => {
    return SECRET_QUERY_KEYS.includes(key.toLowerCase()) ? `${prefix}${key}=***` : match;
  });
  return value;
}
function redactText(raw) {
  let value = raw;
  value = value.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]+@/g, "$1***@");
  for (const key of SECRET_QUERY_KEYS) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    value = value.replace(new RegExp(`(${escaped}\\s*[=:]\\s*)([^\\s&,'"]+)`, "gi"), "$1***");
  }
  value = value.replace(/(authorization\s*:\s*)(bearer|basic|token)\s+[^\s]+/gi, "$1$2 ***");
  value = value.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "***private key redacted***");
  return value;
}
function safeErrorMessage(error, maxLength = 500) {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = redactText(raw).replace(/\s+/g, " ").trim();
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}\u2026` : redacted;
}
function resolveDshHome(env = process.env, home = homedir()) {
  const raw = env.DSH_HOME;
  if (raw !== void 0 && raw.trim() !== "") {
    const expanded = raw.trim();
    if (expanded === "~") return home;
    if (expanded.startsWith("~/") || expanded.startsWith("~\\")) return join(home, expanded.slice(2));
    return isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded);
  }
  return join(home, ".dsh");
}
function resolveDataDir(override) {
  if (override !== void 0 && override.trim() !== "") return resolve(override.trim());
  return join(resolveDshHome(), "storages", "dsh-vcs-timeline");
}
function normalizeRepoRelativePath(raw) {
  if (typeof raw !== "string" || raw === "" || raw.includes("\0")) return null;
  let value = raw.replace(/\\/g, "/").trim();
  if (value === "") return null;
  if (value.startsWith("/")) return null;
  if (/^[a-zA-Z]:/.test(value)) return null;
  while (value.startsWith("./")) value = value.slice(2);
  const segments = value.split("/");
  if (segments.some((segment) => segment === "..")) return null;
  const cleaned = segments.filter((segment) => segment !== "" && segment !== ".");
  if (cleaned.length === 0) return null;
  return cleaned.join("/");
}
function isInside(root, candidate) {
  const rootResolved = resolve(root);
  const candidateResolved = resolve(candidate);
  const rel = relative(rootResolved, candidateResolved);
  return rel === "" || !rel.startsWith("..") && !isAbsolute(rel);
}
function joinRepoPath(root, relativePath) {
  const normalized = normalizeRepoRelativePath(relativePath);
  if (normalized === null) return null;
  const joined = resolve(root, ...normalized.split("/"));
  if (!isInside(root, joined)) return null;
  return joined;
}
function clampInt(value, min, max, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
function parseIsoTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
function decodeCursor(value) {
  if (typeof value !== "string" || value === "") return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (typeof entry === "string" || typeof entry === "number" || entry === null) record[key] = entry;
    }
    return record;
  } catch {
    return null;
  }
}
function displayArgv(argv) {
  return argv.map((arg) => /\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
}
function repositoryId(vcsType, canonicalRoot) {
  const normalized = canonicalRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const lower = process.platform === "win32" ? normalized.toLowerCase() : normalized;
  return `${vcsType}:${lower}`;
}
function truncateUtf8(text, maxBytes) {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return { text, truncated: false };
  const buffer = Buffer.from(text, "utf8");
  let end = Math.max(0, maxBytes);
  while (end > 0 && (buffer[end] & 192) === 128) end -= 1;
  return { text: buffer.subarray(0, end).toString("utf8"), truncated: true };
}

// src/host/adapters/git/commands.ts
import { basename } from "node:path";
var NUL = "\0";
var LOG_FORMAT = "%H%x00%P%x00%an%x00%ae%x00%aI%x00%D%x00%s%x00%b";
function gitBase() {
  return ["git", "--no-pager", "-c", "core.quotepath=false", "-c", "i18n.logOutputEncoding=UTF-8"];
}
function detectArgs(path) {
  return ["git", "-C", path, "rev-parse", "--show-toplevel"];
}
function branchArgs() {
  return [...gitBase(), "rev-parse", "--abbrev-ref", "HEAD"];
}
function headArgs() {
  return [...gitBase(), "rev-parse", "HEAD"];
}
function remoteArgs() {
  return [...gitBase(), "remote", "-v"];
}
function originHeadArgs() {
  return [...gitBase(), "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"];
}
function configDefaultBranchArgs() {
  return [...gitBase(), "config", "--get", "init.defaultBranch"];
}
function aheadBehindArgs() {
  return [...gitBase(), "rev-list", "--left-right", "--count", "@{upstream}...HEAD"];
}
function logArgs(input) {
  const argv = [
    ...gitBase(),
    "log",
    "--no-color",
    "-z",
    "--date-order",
    `--max-count=${Math.max(1, input.limit)}`,
    `--skip=${Math.max(0, input.skip)}`,
    `--format=${LOG_FORMAT}`
  ];
  if (input.author !== void 0 && input.author !== "") {
    argv.push("--fixed-strings", `--author=${input.author}`);
  }
  if (input.text !== void 0 && input.text !== "") {
    argv.push("--regexp-ignore-case", "--fixed-strings", `--grep=${input.text}`);
  }
  if (input.since !== void 0) argv.push(`--since=${input.since}`);
  if (input.until !== void 0) argv.push(`--until=${input.until}`);
  return argv;
}
function isCommitHash(value) {
  return typeof value === "string" && /^[0-9a-f]{7,64}$/i.test(value);
}
function commitMetaArgs(revision) {
  return [...gitBase(), "show", "-s", "--no-color", "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%B", revision];
}
function commitNameStatusArgs(revision) {
  return [...gitBase(), "show", "--no-color", "--format=", "--name-status", "-z", "--find-renames", revision];
}
function commitNumstatArgs(revision) {
  return [...gitBase(), "show", "--no-color", "--format=", "--numstat", "-z", "--find-renames", revision];
}
function showDiffArgs(revision, contextLines, filePath) {
  const argv = [
    ...gitBase(),
    "show",
    "--no-color",
    "--format=",
    "--find-renames",
    `-U${contextLines}`,
    revision
  ];
  if (filePath !== void 0) argv.push("--", filePath);
  return argv;
}
function rangeDiffArgs(revisionA, revisionB, contextLines, filePath) {
  const argv = [
    ...gitBase(),
    "diff",
    "--no-color",
    "--find-renames",
    `-U${contextLines}`,
    revisionA,
    revisionB
  ];
  if (filePath !== void 0) argv.push("--", filePath);
  return argv;
}
function statusArgs() {
  return [...gitBase(), "status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"];
}
function statusV1Args() {
  return [...gitBase(), "status", "--porcelain", "-z", "--untracked-files=all"];
}
function stagedNamesArgs() {
  return [...gitBase(), "diff", "--cached", "--name-only", "-z"];
}
function remoteNamesArgs() {
  return [...gitBase(), "remote"];
}
function currentBranchArgs() {
  return [...gitBase(), "branch", "--show-current"];
}
function fetchArgs() {
  return [...gitBase(), "fetch"];
}
function pullArgs() {
  return [...gitBase(), "pull", "--ff-only"];
}
function commitArgs(message) {
  return [...gitBase(), "commit", "-m", message];
}
function pushArgs(remote, branch) {
  return [...gitBase(), "push", "--porcelain", remote, branch];
}
function isSafeRemoteName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 255 && !value.startsWith("-") && !/[\s~^:?*[\\"'`$&|;<>]/.test(value);
}
function isSafeBranchName(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 255 && !value.startsWith("-") && !value.startsWith("/") && !value.endsWith("/") && !value.includes("..") && !/[\s~^:?*[\\"'`$&|;<>]/.test(value);
}
function parseLogOutput(text) {
  if (text === "") return [];
  const tokens = text.split(NUL);
  if (tokens.length > 0 && tokens[tokens.length - 1] === "") tokens.pop();
  const commits = [];
  for (let index = 0; index + 7 < tokens.length; index += 8) {
    commits.push({
      hash: tokens[index] ?? "",
      parents: (tokens[index + 1] ?? "").split(" ").filter((value) => value !== ""),
      author: tokens[index + 2] ?? "",
      authorEmail: tokens[index + 3] ?? "",
      authorDate: tokens[index + 4] ?? "",
      decorations: tokens[index + 5] ?? "",
      subject: tokens[index + 6] ?? "",
      body: (tokens[index + 7] ?? "").replace(/\n+$/, "")
    });
  }
  return commits;
}
function isEmptyRepositoryError(stderr) {
  return /does not have any commits yet|bad revision|unknown revision|ambiguous argument 'HEAD'|your current branch .* does not have any commits/i.test(stderr);
}
function branchFromDecoration(decorations) {
  if (decorations === "") return void 0;
  const head = /HEAD -> ([^,]+)/.exec(decorations);
  if (head !== null) return head[1]?.trim();
  for (const entry of decorations.split(",")) {
    const name = entry.trim();
    if (name === "" || name.startsWith("tag:") || name.includes("/")) continue;
    return name;
  }
  return void 0;
}
function commitToEvent(commit, repositoryId2, fallbackBranch) {
  const timestamp = parseIsoTimestamp(commit.authorDate) ?? (/* @__PURE__ */ new Date(0)).toISOString();
  const branch = branchFromDecoration(commit.decorations) ?? fallbackBranch;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `commit:${repositoryId2}:${commit.hash}`,
    repositoryId: repositoryId2,
    vcsType: "git",
    eventType: "commit",
    source: "repository",
    timestamp,
    ...commit.author === "" ? {} : { actor: commit.author },
    summary: commit.subject,
    commitHash: commit.hash,
    ...commit.parents.length === 0 ? {} : { parentHashes: commit.parents },
    ...branch === void 0 ? {} : { branch },
    changeSetId: `${repositoryId2}:${commit.hash}`,
    metadata: {
      authorEmail: commit.authorEmail,
      parentCount: commit.parents.length,
      ...commit.decorations === "" ? {} : { decorations: commit.decorations.slice(0, 500) }
    }
  };
}
function parseNameStatusZ(text) {
  const tokens = text.split(NUL).filter((token) => token !== "");
  const entries = [];
  let index = 0;
  while (index < tokens.length) {
    const code = tokens[index] ?? "";
    index += 1;
    if (code === "") continue;
    const letter = code[0]?.toUpperCase() ?? "?";
    if (letter === "R" || letter === "C") {
      const oldPath = tokens[index] ?? "";
      const newPath = tokens[index + 1] ?? "";
      index += 2;
      entries.push({ status: code, path: newPath, oldPath });
    } else {
      const path = tokens[index] ?? "";
      index += 1;
      entries.push({ status: code, path });
    }
  }
  return entries;
}
function parseNumstatZ(text) {
  const tokens = text.split(NUL);
  if (tokens.length > 0 && tokens[tokens.length - 1] === "") tokens.pop();
  const entries = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    index += 1;
    if (token === "") continue;
    const parts = token.split("	");
    if (parts.length < 3) continue;
    const additionsRaw = parts[0] ?? "";
    const deletionsRaw = parts[1] ?? "";
    let path = parts[2] ?? "";
    let oldPath;
    if (path === "") {
      oldPath = tokens[index];
      path = tokens[index + 1] ?? "";
      index += 2;
    }
    const binary = additionsRaw === "-" || deletionsRaw === "-";
    entries.push({
      path,
      ...oldPath === void 0 ? {} : { oldPath },
      ...binary ? {} : { additions: Number.parseInt(additionsRaw, 10) || 0, deletions: Number.parseInt(deletionsRaw, 10) || 0 },
      binary
    });
  }
  return entries;
}
function statusLetterToChangeStatus(code) {
  const letter = code[0]?.toUpperCase() ?? "?";
  switch (letter) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    default:
      return "unknown";
  }
}
function mergeChangedFiles(nameStatus, numstat, maxFiles) {
  const stats = /* @__PURE__ */ new Map();
  for (const entry of numstat) {
    stats.set(`${entry.oldPath ?? ""}\0${entry.path}`, entry);
    if (!stats.has(`\0${entry.path}`)) stats.set(`\0${entry.path}`, entry);
  }
  const files = [];
  for (const entry of nameStatus) {
    const stat4 = stats.get(`${entry.oldPath ?? ""}\0${entry.path}`) ?? stats.get(`\0${entry.path}`);
    const status = statusLetterToChangeStatus(entry.status);
    files.push({
      path: entry.path,
      ...entry.oldPath === void 0 ? {} : { oldPath: entry.oldPath },
      status,
      ...stat4?.binary === true ? { binary: true } : {},
      ...stat4?.additions === void 0 ? {} : { additions: stat4.additions },
      ...stat4?.deletions === void 0 ? {} : { deletions: stat4.deletions }
    });
    if (files.length >= maxFiles) break;
  }
  return { files, truncated: nameStatus.length > files.length };
}
function parseCommitMeta(text) {
  const tokens = text.split(NUL);
  return {
    hash: tokens[0] ?? "",
    parents: (tokens[1] ?? "").split(" ").filter((value) => value !== ""),
    author: tokens[2] ?? "",
    authorEmail: tokens[3] ?? "",
    authorDate: tokens[4] ?? "",
    commitDate: tokens[5] ?? "",
    message: tokens[6] ?? ""
  };
}
function buildChangeSet(input) {
  const merged = mergeChangedFiles(input.nameStatus, input.numstat, input.maxFiles);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `${input.repositoryId}:${input.revision}`,
    repositoryId: input.repositoryId,
    vcsType: "git",
    revision: input.revision,
    ...input.meta.parents[0] === void 0 ? {} : { parentRevision: input.meta.parents[0] },
    createdAt: parseIsoTimestamp(input.meta.commitDate) ?? parseIsoTimestamp(input.meta.authorDate) ?? input.now,
    files: merged.files,
    ...merged.truncated ? { truncated: true, truncationReason: `file list capped at ${input.maxFiles} entries` } : {}
  };
}
function parseStatusV2(text, maxEntries = 2e3) {
  const tokens = text.split(NUL);
  const entries = [];
  const conflicts = [];
  let branch;
  let head;
  let ahead = 0;
  let behind = 0;
  let truncated = false;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    index += 1;
    if (token === "") continue;
    if (token.startsWith("# ")) {
      const branchHead = /^# branch\.head (.+)$/.exec(token);
      if (branchHead !== null) branch = branchHead[1] === "(detached)" ? void 0 : branchHead[1];
      const oid = /^# branch\.oid (.+)$/.exec(token);
      if (oid !== null && oid[1] !== "(initial)") head = oid[1];
      const ab = /^# branch\.ab \+(\d+) -(\d+)$/.exec(token);
      if (ab !== null) {
        ahead = Number.parseInt(ab[1] ?? "0", 10);
        behind = Number.parseInt(ab[2] ?? "0", 10);
      }
      continue;
    }
    if (token.startsWith("1 ")) {
      const match = /^1 ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.+)$/.exec(token);
      if (match === null) continue;
      if (entries.length >= maxEntries) {
        truncated = true;
        continue;
      }
      const xy = match[1] ?? "";
      const path = normalizeRepoRelativePath(match[8] ?? "") ?? (match[8] ?? "");
      const contentStatus = xy[0] !== void 0 && xy[0] !== "." ? xy[0] : xy[1];
      entries.push({ path, status: contentStatus ?? "?", worktreeStatus: xy[1] ?? "?", staged: xy[0] !== "." });
      continue;
    }
    if (token.startsWith("2 ")) {
      const match = /^2 ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.+)$/.exec(token);
      const original = tokens[index];
      index += 1;
      if (match === null) continue;
      if (entries.length >= maxEntries) {
        truncated = true;
        continue;
      }
      const xy = match[1] ?? "";
      const path = normalizeRepoRelativePath(match[9] ?? "") ?? (match[9] ?? "");
      void original;
      entries.push({ path, status: xy[0] ?? "R", worktreeStatus: xy[1] ?? "R", staged: true });
      continue;
    }
    if (token.startsWith("u ")) {
      const match = /^u ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) ([^ ]+) (.+)$/.exec(token);
      if (match === null) continue;
      const path = normalizeRepoRelativePath(match[10] ?? "") ?? (match[10] ?? "");
      conflicts.push(path);
      entries.push({ path, status: "U", worktreeStatus: "U" });
      continue;
    }
    if (token.startsWith("? ")) {
      if (entries.length >= maxEntries) {
        truncated = true;
        continue;
      }
      const path = normalizeRepoRelativePath(token.slice(2)) ?? token.slice(2);
      entries.push({ path, status: "?" });
      continue;
    }
    if (token.startsWith("! ")) continue;
  }
  const meaningful = entries.filter((entry) => entry.status !== "?" || true);
  return {
    ...branch === void 0 ? {} : { branch },
    ...head === void 0 ? {} : { head },
    ahead,
    behind,
    entries,
    conflicts,
    clean: meaningful.filter((entry) => entry.status !== "?").length === 0 && conflicts.length === 0,
    truncated
  };
}
function parseStatusV1(text, maxEntries = 2e3) {
  const tokens = text.split(NUL).filter((token) => token !== "");
  const entries = [];
  const conflicts = [];
  let truncated = false;
  for (const token of tokens) {
    if (token.length < 4) continue;
    const xy = token.slice(0, 2);
    const path = normalizeRepoRelativePath(token.slice(3)) ?? token.slice(3);
    if (entries.length >= maxEntries) {
      truncated = true;
      continue;
    }
    if (xy === "UU" || xy === "AA" || xy === "DD" || xy === "AU" || xy === "UA" || xy === "DU" || xy === "UD") {
      conflicts.push(path);
    }
    entries.push({ path, status: xy[0] ?? "?", worktreeStatus: xy[1] ?? "?", staged: (xy[0] ?? " ") !== " " });
  }
  return {
    ahead: 0,
    behind: 0,
    entries,
    conflicts,
    clean: entries.filter((entry) => entry.status !== "?").length === 0 && conflicts.length === 0,
    truncated
  };
}
function buildStatus(repositoryId2, parsed, warnings) {
  return {
    repositoryId: repositoryId2,
    vcsType: "git",
    clean: parsed.clean && parsed.entries.length === 0,
    ...parsed.branch === void 0 ? {} : { branch: parsed.branch },
    ...parsed.head === void 0 ? {} : { head: parsed.head },
    entries: parsed.entries,
    conflicts: parsed.conflicts,
    ...parsed.truncated ? { truncated: true } : {},
    ...warnings === void 0 ? {} : { warnings }
  };
}
function parseRemotes(text) {
  const urls = /* @__PURE__ */ new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\S+\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (match === null) continue;
    const url = match[1] ?? "";
    if (url !== "") urls.add(redactUrl(url));
  }
  return [...urls];
}
function parseRemoteNames(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
}
function buildRepository(input) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "",
    vcsType: "git",
    rootPath: input.rootPath,
    displayName: basename(input.rootPath),
    ...input.remotes.length === 0 ? {} : { remoteUrls: input.remotes },
    ...input.defaultBranch === void 0 ? {} : { defaultBranch: input.defaultBranch },
    ...input.branch === void 0 ? {} : { currentBranch: input.branch },
    ...input.head === void 0 ? {} : { currentRevision: input.head },
    detectedAt: input.now,
    lastSeenAt: input.now
  };
}
function hasBinaryHeader(text) {
  return /^Binary files .* differ$/m.test(text);
}

// src/host/adapters/git/adapter.ts
var READ_TIMEOUT_MS = 2e4;
var CHANGESET_TIMEOUT_MS = 3e4;
var STATUS_TIMEOUT_MS = 15e3;
var READ_OUTPUT_CAP = 8 * 1024 * 1024;
var MAX_CHANGED_FILES = 5e3;
var MAX_STATUS_ENTRIES = 2e3;
function failure(code, message, detail) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...detail === void 0 ? {} : { detail: detail.slice(0, 500) }
    }
  };
}
function runFailure(result, what) {
  if (result.spawnFailed === true) {
    return failure("vcs-not-installed", "git is not available on this machine", safeErrorMessage(result.failureMessage ?? "spawn failed"));
  }
  if (result.timedOut === true) {
    return failure("timeout", `${what} timed out`, safeErrorMessage(result.stderr, 300));
  }
  const stderr = safeErrorMessage(result.stderr.trim() === "" ? "git exited with an error" : result.stderr, 500);
  return failure("operation-failed", `${what} failed`, stderr);
}
function firstLine(text) {
  return (text.split(/\r?\n/)[0] ?? "").trim();
}
function nulTokens(text) {
  return text.split("\0").filter((token) => token !== "");
}
function stateWarnings(before) {
  const warnings = [];
  if (before.clean === false) warnings.push("the working tree has uncommitted changes");
  if (before.branch === void 0) warnings.push("HEAD is detached; no branch is checked out");
  if ((before.remoteUrls ?? []).length === 0) warnings.push("this repository has no configured remote");
  if (typeof before.behind === "number" && before.behind > 0) warnings.push(`the branch is ${before.behind} commit(s) behind its upstream`);
  if (typeof before.ahead === "number" && before.ahead > 0) warnings.push(`the branch is ${before.ahead} commit(s) ahead of its upstream`);
  return warnings;
}
function createGitAdapter(runner) {
  const run = async (argv, cwd, signal, timeoutMs, maxBytes = READ_OUTPUT_CAP) => runner.run(argv, cwd, { ...signal === void 0 ? {} : { signal }, timeoutMs, maxBytes });
  const adapter = {
    vcsType: "git",
    async detect(path) {
      const result = await run(detectArgs(path), process.cwd(), void 0, 1e4, 64 * 1024);
      if (result.spawnFailed === true) return runFailure(result, "git detection");
      if (result.exitCode !== 0) return { ok: true, value: null };
      const rootPath = firstLine(result.stdout);
      if (rootPath === "") return { ok: true, value: null };
      let canonical = rootPath;
      try {
        canonical = await realpath(rootPath);
      } catch {
        canonical = rootPath;
      }
      return { ok: true, value: { rootPath: canonical } };
    },
    async info(root, signal) {
      const [branch, head, remotes, originHead, defaultBranchConfig] = await Promise.all([
        run(branchArgs(), root, signal, READ_TIMEOUT_MS, 64 * 1024),
        run(headArgs(), root, signal, READ_TIMEOUT_MS, 64 * 1024),
        run(remoteArgs(), root, signal, READ_TIMEOUT_MS, 256 * 1024),
        run(originHeadArgs(), root, signal, READ_TIMEOUT_MS, 64 * 1024),
        run(configDefaultBranchArgs(), root, signal, READ_TIMEOUT_MS, 64 * 1024)
      ]);
      if (branch.spawnFailed === true && head.spawnFailed === true) {
        return runFailure(head, "reading repository information");
      }
      const branchName = branch.exitCode === 0 ? firstLine(branch.stdout) : "";
      const headHash = head.exitCode === 0 ? firstLine(head.stdout) : "";
      const remoteUrls = remotes.exitCode === 0 ? parseRemotes(remotes.stdout) : [];
      let defaultBranch;
      if (originHead.exitCode === 0) {
        const match = /refs\/remotes\/[^/]+\/(.+)$/.exec(firstLine(originHead.stdout));
        if (match !== null) defaultBranch = match[1];
      }
      if (defaultBranch === void 0 && defaultBranchConfig.exitCode === 0) {
        const configured = firstLine(defaultBranchConfig.stdout);
        if (configured !== "") defaultBranch = configured;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const repository = buildRepository({
        rootPath: root,
        ...branchName === "" || branchName === "HEAD" ? {} : { branch: branchName },
        ...headHash === "" ? {} : { head: headHash },
        remotes: remoteUrls,
        ...defaultBranch === void 0 ? {} : { defaultBranch },
        now
      });
      return { ok: true, value: { ...repository, id: repositoryId("git", root) } };
    },
    async history(root, repositoryIdValue, query, signal) {
      const limit = clampInt(query.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
      const cursor = decodeCursor(query.cursor ?? null);
      const offset = cursor !== null && typeof cursor.o === "number" && cursor.o >= 0 ? Math.trunc(cursor.o) : 0;
      const argv = logArgs({
        skip: offset,
        limit: limit + 1,
        ...query.author === void 0 ? {} : { author: query.author },
        ...query.text === void 0 ? {} : { text: query.text },
        ...query.since === void 0 ? {} : { since: query.since },
        ...query.until === void 0 ? {} : { until: query.until }
      });
      const result = await run(argv, root, signal, READ_TIMEOUT_MS);
      if (result.exitCode !== 0) {
        if (isEmptyRepositoryError(result.stderr)) {
          return { ok: true, value: { events: [], nextCursor: null, hasMore: false, warnings: ["this repository has no commits yet"] } };
        }
        return runFailure(result, "reading git history");
      }
      const parsed = parseLogOutput(result.stdout);
      const hasMore = parsed.length > limit;
      const page = hasMore ? parsed.slice(0, limit) : parsed;
      const events = page.map((commit) => commitToEvent(commit, repositoryIdValue));
      const nextCursor = hasMore ? encodeCursor({ o: offset + limit }) : null;
      return {
        ok: true,
        value: {
          events,
          nextCursor,
          hasMore,
          ...parsed.length === 0 && offset === 0 ? {} : {}
        }
      };
    },
    async changeSet(root, repositoryIdValue, revision, signal) {
      if (!isCommitHash(revision)) {
        return failure("invalid-request", "a full commit hash is required");
      }
      const collect = async (argv, timeout) => run(argv, root, signal, timeout);
      const metaResult = await collect(commitMetaArgs(revision), CHANGESET_TIMEOUT_MS);
      if (metaResult.exitCode !== 0) return runFailure(metaResult, "reading commit metadata");
      const [namesResult, numstatResult] = await Promise.all([
        collect(commitNameStatusArgs(revision), CHANGESET_TIMEOUT_MS),
        collect(commitNumstatArgs(revision), CHANGESET_TIMEOUT_MS)
      ]);
      if (namesResult.exitCode !== 0) return runFailure(namesResult, "reading changed files");
      const meta = parseCommitMeta(metaResult.stdout);
      const changeSet = buildChangeSet({
        repositoryId: repositoryIdValue,
        revision,
        meta,
        nameStatus: parseNameStatusZ(namesResult.stdout),
        numstat: numstatResult.exitCode === 0 ? parseNumstatZ(numstatResult.stdout) : [],
        maxFiles: MAX_CHANGED_FILES,
        now: (/* @__PURE__ */ new Date()).toISOString()
      });
      return { ok: true, value: changeSet };
    },
    async diff(root, repositoryIdValue, query, signal) {
      const revisionA = query.revisionA ?? (query.revisionB === void 0 ? void 0 : void 0);
      const revisionB = query.revisionB;
      const older = query.revisionA;
      for (const candidate of [older, revisionB]) {
        if (candidate !== void 0 && !isCommitHash(candidate)) {
          return failure("invalid-request", "a commit hash is required for a diff");
        }
      }
      if (older === void 0 && revisionB === void 0) {
        return failure("invalid-request", "a commit hash or a revision range is required");
      }
      let filePath;
      if (query.filePath !== void 0 && query.filePath !== "") {
        const normalized = normalizeRepoRelativePath(query.filePath);
        if (normalized === null) return failure("invalid-request", "the file path must stay inside the repository");
        filePath = normalized;
      }
      const contextLines = clampInt(query.contextLines, 0, 32, 3);
      const argv = older !== void 0 && revisionB !== void 0 ? rangeDiffArgs(older, revisionB, contextLines, filePath) : showDiffArgs(revisionB, contextLines, filePath);
      const maxBytes = clampInt(query.maxBytes, 1024, HARD_DIFF_MAX_BYTES, 256 * 1024);
      const result = await run(argv, root, signal, CHANGESET_TIMEOUT_MS, Math.min(HARD_DIFF_MAX_BYTES * 2, Math.max(maxBytes * 2, 1 << 20)));
      if (result.exitCode !== 0) return runFailure(result, "reading a diff");
      void revisionA;
      const binary = hasBinaryHeader(result.stdout);
      if (binary) {
        return {
          ok: true,
          value: {
            repositoryId: repositoryIdValue,
            revisionA: older ?? null,
            revisionB: revisionB ?? null,
            ...filePath === void 0 ? {} : { filePath },
            text: "",
            truncated: false,
            binary: true,
            bytes: 0
          }
        };
      }
      const capped = truncateUtf8(result.stdout, maxBytes);
      return {
        ok: true,
        value: {
          repositoryId: repositoryIdValue,
          revisionA: older ?? null,
          revisionB: revisionB ?? null,
          ...filePath === void 0 ? {} : { filePath },
          text: capped.text,
          truncated: capped.truncated,
          ...capped.truncated ? { truncationReason: `diff capped at ${maxBytes} bytes` } : {},
          binary: false,
          bytes: Buffer.byteLength(capped.text, "utf8")
        }
      };
    },
    async status(root, repositoryIdValue, signal) {
      const result = await run(statusArgs(), root, signal, STATUS_TIMEOUT_MS, 4 * 1024 * 1024);
      if (result.exitCode !== 0) {
        const fallback = await run(statusV1Args(), root, signal, STATUS_TIMEOUT_MS, 4 * 1024 * 1024);
        if (fallback.exitCode !== 0) return runFailure(result, "reading working-tree status");
        const parsedV1 = parseStatusV1(fallback.stdout, MAX_STATUS_ENTRIES);
        return { ok: true, value: buildStatus(repositoryIdValue, parsedV1) };
      }
      const parsed = parseStatusV2(result.stdout, MAX_STATUS_ENTRIES);
      return { ok: true, value: buildStatus(repositoryIdValue, parsed) };
    },
    async beforeState(root, _operation, signal) {
      const [branch, head, status, staged, remotes, aheadBehind] = await Promise.all([
        run(currentBranchArgs(), root, signal, READ_TIMEOUT_MS, 64 * 1024),
        run(headArgs(), root, signal, READ_TIMEOUT_MS, 64 * 1024),
        run(statusArgs(), root, signal, STATUS_TIMEOUT_MS, 4 * 1024 * 1024),
        run(stagedNamesArgs(), root, signal, STATUS_TIMEOUT_MS, 512 * 1024),
        run(remoteArgs(), root, signal, READ_TIMEOUT_MS, 256 * 1024),
        run(aheadBehindArgs(), root, signal, READ_TIMEOUT_MS, 64 * 1024)
      ]);
      const state = {};
      const branchName = branch.exitCode === 0 ? firstLine(branch.stdout) : "";
      if (branchName !== "") state.branch = branchName;
      const headHash = head.exitCode === 0 ? firstLine(head.stdout) : "";
      if (headHash !== "") {
        state.head = headHash;
        state.revision = headHash;
      }
      if (status.exitCode === 0) {
        const parsed = parseStatusV2(status.stdout, MAX_STATUS_ENTRIES);
        state.clean = parsed.clean && parsed.entries.length === 0;
      }
      if (staged.exitCode === 0) {
        state.stagedFiles = nulTokens(staged.stdout).map((path) => normalizeRepoRelativePath(path) ?? path).slice(0, 500);
      }
      if (remotes.exitCode === 0) {
        state.remoteUrls = parseRemotes(remotes.stdout);
      }
      if (aheadBehind.exitCode === 0) {
        const parts = firstLine(aheadBehind.stdout).split(/\s+/);
        const behind = Number.parseInt(parts[0] ?? "", 10);
        const ahead = Number.parseInt(parts[1] ?? "", 10);
        if (Number.isFinite(behind)) state.behind = behind;
        if (Number.isFinite(ahead)) state.ahead = ahead;
      }
      return { ok: true, value: state };
    },
    async planOperation(root, operation, params, before) {
      const executable = await runner.resolveExecutable("git");
      if (executable === null) {
        return failure("vcs-not-installed", "git is not available on this machine");
      }
      const warnings = stateWarnings(before);
      const blocked = (blockedReason) => ({
        allowed: false,
        blockedReason,
        argv: [],
        cwd: root,
        summary: `${operation} blocked`,
        warnings,
        network: operation !== "commit"
      });
      switch (operation) {
        case "fetch": {
          return {
            ok: true,
            value: {
              allowed: true,
              argv: fetchArgs(),
              cwd: root,
              summary: "fetch new commits and objects from the default remote",
              warnings,
              network: true
            }
          };
        }
        case "pull": {
          if (before.clean === false) return { ok: true, value: blocked("the working tree has uncommitted changes; commit or discard them first") };
          if ((before.remoteUrls ?? []).length === 0) return { ok: true, value: blocked("this repository has no configured remote") };
          if (before.ahead === void 0 && before.behind === void 0) {
            return { ok: true, value: blocked("the current branch has no upstream; set one before pulling") };
          }
          return {
            ok: true,
            value: {
              allowed: true,
              argv: pullArgs(),
              cwd: root,
              summary: "pull from the upstream with fast-forward only (no merge commit, no rebase)",
              warnings,
              network: true
            }
          };
        }
        case "commit": {
          const message = typeof params.message === "string" ? params.message : "";
          if (message.trim() === "") return { ok: true, value: blocked("a commit message is required") };
          if (message.length > 4e3) return { ok: true, value: blocked("the commit message is longer than 4000 characters") };
          if ((before.stagedFiles ?? []).length === 0) return { ok: true, value: blocked("nothing is staged; stage changes first (this plugin never stages files for you)") };
          return {
            ok: true,
            value: {
              allowed: true,
              argv: commitArgs(message),
              cwd: root,
              summary: `commit ${before.stagedFiles?.length ?? 0} staged path(s) on ${before.branch ?? "the current branch"}`,
              warnings,
              network: false
            }
          };
        }
        case "push": {
          if (before.branch === void 0) return { ok: true, value: blocked("HEAD is detached; check out a branch before pushing") };
          if ((before.remoteUrls ?? []).length === 0) return { ok: true, value: blocked("this repository has no configured remote") };
          const remotes = await run(remoteNamesArgs(), root, void 0, READ_TIMEOUT_MS, 64 * 1024);
          const names = remotes.exitCode === 0 ? parseRemoteNames(remotes.stdout) : [];
          const remote = typeof params.remote === "string" && params.remote !== "" ? params.remote : names.includes("origin") ? "origin" : names[0];
          if (remote === void 0 || remote === "") return { ok: true, value: blocked("this repository has no configured remote") };
          if (!names.includes(remote)) return { ok: true, value: blocked(`unknown remote "${remote}"`) };
          const branch = typeof params.branch === "string" && params.branch !== "" ? params.branch : before.branch;
          if (!isSafeRemoteName(remote)) return { ok: true, value: blocked("the remote name contains unsupported characters") };
          if (!isSafeBranchName(branch)) return { ok: true, value: blocked("the branch name contains unsupported characters") };
          if (branch !== before.branch) {
            return { ok: true, value: blocked(`only the current branch (${before.branch}) can be pushed in this version`) };
          }
          return {
            ok: true,
            value: {
              allowed: true,
              argv: pushArgs(remote, branch),
              cwd: root,
              summary: `push ${branch} to ${remote}`,
              warnings,
              network: true
            }
          };
        }
        default:
          return {
            ok: true,
            value: blocked(`the ${operation} operation is not implemented by this plugin version`)
          };
      }
    }
  };
  return adapter;
}

// src/host/adapters/svn/adapter.ts
import { stat, realpath as realpath2 } from "node:fs/promises";
import { basename as basename2, dirname, join as join2, resolve as resolve2 } from "node:path";

// src/host/adapters/svn/xml.ts
var XmlParseError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "XmlParseError";
  }
};
var MAX_DEPTH = 64;
var MAX_NODES = 2e5;
var NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'"
};
function decodeXmlEntities(raw) {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&(#(?:[xX])?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9._-]*);/g, (match, entity) => {
    if (entity.startsWith("#")) {
      const hexadecimal = entity.startsWith("#x") || entity.startsWith("#X");
      const digits = hexadecimal ? entity.slice(2) : entity.slice(1);
      const code = Number.parseInt(digits, hexadecimal ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 1114111) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}
function isXmlSpace(character) {
  return character === " " || character === "	" || character === "\n" || character === "\r";
}
function readName(source, start) {
  let index = start;
  while (index < source.length) {
    const character = source[index];
    if (character === ">" || character === "/" || isXmlSpace(character)) break;
    if (character === "<") throw new XmlParseError("unexpected < inside a tag");
    index += 1;
  }
  const name = source.slice(start, index);
  if (name === "") throw new XmlParseError("element name is missing");
  return { name, end: index };
}
function parseOpenTag(source, start) {
  const { name, end } = readName(source, start);
  let index = end;
  const attributes = {};
  while (index < source.length) {
    while (index < source.length && isXmlSpace(source[index])) index += 1;
    if (index >= source.length) throw new XmlParseError(`unterminated tag <${name}>`);
    const character = source[index];
    if (character === ">") return { name, attributes, selfClosing: false, end: index + 1 };
    if (character === "/") {
      if (source[index + 1] === ">") return { name, attributes, selfClosing: true, end: index + 2 };
      throw new XmlParseError(`malformed self-closing tag <${name}>`);
    }
    const nameStart = index;
    while (index < source.length) {
      const candidate = source[index];
      if (candidate === "=" || candidate === ">" || candidate === "/" || isXmlSpace(candidate)) break;
      index += 1;
    }
    const attributeName = source.slice(nameStart, index);
    if (attributeName === "") throw new XmlParseError(`malformed attribute in <${name}>`);
    while (index < source.length && isXmlSpace(source[index])) index += 1;
    if (source[index] !== "=") throw new XmlParseError(`attribute "${attributeName}" in <${name}> has no value`);
    index += 1;
    while (index < source.length && isXmlSpace(source[index])) index += 1;
    const quote = source[index];
    if (quote !== '"' && quote !== "'") throw new XmlParseError(`attribute "${attributeName}" in <${name}> is not quoted`);
    index += 1;
    const valueEnd = source.indexOf(quote, index);
    if (valueEnd === -1) throw new XmlParseError(`unterminated attribute value in <${name}>`);
    attributes[attributeName] = decodeXmlEntities(source.slice(index, valueEnd));
    index = valueEnd + 1;
  }
  throw new XmlParseError(`unterminated tag <${name}>`);
}
function parseCloseTag(source, start) {
  const { name, end } = readName(source, start);
  let index = end;
  while (index < source.length && isXmlSpace(source[index])) index += 1;
  if (source[index] !== ">") throw new XmlParseError(`malformed closing tag </${name}>`);
  return { name, end: index + 1 };
}
function skipDeclaration(source, start) {
  let index = start;
  let bracketDepth = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (character === ">" && bracketDepth === 0) return index + 1;
    index += 1;
  }
  throw new XmlParseError("unterminated declaration");
}
function parseXml(source) {
  if (typeof source !== "string") throw new XmlParseError("XML source must be a string");
  const document = { name: "#document", attributes: {}, children: [], text: "" };
  const stack = [document];
  let position = 0;
  let nodeCount = 0;
  const appendText = (raw) => {
    if (raw === "") return;
    const top = stack[stack.length - 1];
    if (top === document) {
      if (raw.trim() !== "") throw new XmlParseError("text outside the document element");
      return;
    }
    top.text += decodeXmlEntities(raw);
  };
  while (position < source.length) {
    const open2 = source.indexOf("<", position);
    if (open2 === -1) {
      appendText(source.slice(position));
      break;
    }
    appendText(source.slice(position, open2));
    position = open2;
    if (source.startsWith("<?", position)) {
      const end = source.indexOf("?>", position + 2);
      if (end === -1) throw new XmlParseError("unterminated processing instruction");
      position = end + 2;
      continue;
    }
    if (source.startsWith("<!--", position)) {
      const end = source.indexOf("-->", position + 4);
      if (end === -1) throw new XmlParseError("unterminated comment");
      position = end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", position)) {
      const end = source.indexOf("]]>", position + 9);
      if (end === -1) throw new XmlParseError("unterminated CDATA section");
      const top = stack[stack.length - 1];
      if (top === document) throw new XmlParseError("CDATA outside the document element");
      top.text += source.slice(position + 9, end);
      position = end + 3;
      continue;
    }
    if (source.startsWith("<!", position)) {
      position = skipDeclaration(source, position + 2);
      continue;
    }
    if (source.startsWith("</", position)) {
      const closing = parseCloseTag(source, position + 2);
      const current = stack.pop();
      if (current === void 0 || current === document) throw new XmlParseError(`unexpected closing tag </${closing.name}>`);
      if (current.name !== closing.name) throw new XmlParseError(`mismatched closing tag </${closing.name}>; expected </${current.name}>`);
      position = closing.end;
      continue;
    }
    const tag = parseOpenTag(source, position + 1);
    nodeCount += 1;
    if (nodeCount > MAX_NODES) throw new XmlParseError("XML document has too many elements");
    const parent = stack[stack.length - 1];
    const node = { name: tag.name, attributes: tag.attributes, children: [], text: "" };
    parent.children.push(node);
    if (!tag.selfClosing) {
      if (stack.length + 1 > MAX_DEPTH) throw new XmlParseError("XML document is nested too deeply");
      stack.push(node);
    }
    position = tag.end;
  }
  if (stack.length !== 1) {
    const openElement = stack[stack.length - 1];
    throw new XmlParseError(`unclosed element <${openElement.name}>`);
  }
  if (document.children.length === 0) throw new XmlParseError("XML document has no root element");
  if (document.children.length > 1) throw new XmlParseError("XML document has multiple root elements");
  return document;
}
function rootElement(document, expectedName) {
  const root = document.children[0];
  if (root === void 0) throw new XmlParseError("XML document has no root element");
  if (expectedName !== void 0 && root.name !== expectedName) {
    throw new XmlParseError(`unexpected root element <${root.name}>; expected <${expectedName}>`);
  }
  return root;
}
function childElements(node, name) {
  return name === void 0 ? [...node.children] : node.children.filter((child) => child.name === name);
}
function firstChild(node, name) {
  return node.children.find((child) => child.name === name);
}
function childText(node, name) {
  const child = firstChild(node, name);
  if (child === void 0) return void 0;
  const text = child.text.trim();
  return text === "" ? void 0 : text;
}
function attributeText(node, name) {
  const value = node.attributes[name];
  if (value === void 0) return void 0;
  const trimmed = value.trim();
  return trimmed === "" ? void 0 : trimmed;
}

// src/host/adapters/svn/commands.ts
var MAX_SVN_REVISION_DIGITS = 12;
var MAX_COMMIT_MESSAGE_LENGTH = 4e3;
var MAX_CHANGESET_FILES = 2e3;
var DEFAULT_HISTORY_LIMIT = 30;
var NON_INTERACTIVE = "--non-interactive";
function parseRevision(value) {
  if (typeof value !== "string") return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const trimmed = value.trim();
  if (!new RegExp(`^[0-9]{1,${MAX_SVN_REVISION_DIGITS}}$`).test(trimmed)) return null;
  const number = Number(trimmed);
  if (!Number.isSafeInteger(number) || number < 0) return null;
  return String(number);
}
function parseRevisionNumber(value) {
  const revision = parseRevision(value);
  if (revision === null) return null;
  const number = Number(revision);
  return Number.isSafeInteger(number) ? number : null;
}
function parseSvnDate(raw) {
  if (typeof raw !== "string") return void 0;
  const trimmed = raw.trim();
  if (trimmed === "") return void 0;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(trimmed);
  const candidate = match === null ? trimmed : `${match[1]}.${(match[2] ?? "").padEnd(3, "0").slice(0, 3)}${match[3] ?? "Z"}`;
  const milliseconds = Date.parse(candidate);
  if (Number.isNaN(milliseconds)) return void 0;
  return new Date(milliseconds).toISOString();
}
function requireTarget(target) {
  if (typeof target !== "string" || target.trim() === "") throw new Error("svn target is required");
  return target;
}
function requireExecutable(executable) {
  if (typeof executable !== "string" || executable.trim() === "") throw new Error("svn executable is required");
  return executable;
}
function requireRevision(value) {
  const revision = parseRevision(value);
  if (revision === null) throw new Error("invalid svn revision");
  return revision;
}
function requireRevisionNumber(value) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("invalid svn revision number");
  return value;
}
function buildInfoArgs(executable, target) {
  return [requireExecutable(executable), "info", "--xml", NON_INTERACTIVE, "--", requireTarget(target)];
}
function buildLogArgs(executable, target, options) {
  const range = options.revisionRange.trim();
  if (!/^(?:HEAD|[0-9]{1,12})(?::(?:HEAD|[0-9]{1,12}))?$/.test(range)) throw new Error("invalid svn revision range");
  const argv = [requireExecutable(executable), "log", "--xml", NON_INTERACTIVE];
  if (options.verbose !== false) argv.push("-v");
  argv.push("-r", range);
  if (options.limit !== void 0) {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1) throw new Error("invalid svn log limit");
    argv.push("-l", String(options.limit));
  }
  argv.push("--", requireTarget(target));
  return argv;
}
function buildStatusArgs(executable, target) {
  return [requireExecutable(executable), "status", "--xml", NON_INTERACTIVE, "--", requireTarget(target)];
}
function buildDiffArgs(executable, target, options) {
  const hasRevision = options.revision !== void 0;
  const hasRange = options.range !== void 0;
  if (hasRevision === hasRange) throw new Error("svn diff requires exactly one revision or one range");
  const argv = [requireExecutable(executable), "diff", NON_INTERACTIVE];
  if (options.range !== void 0) {
    argv.push("-r", `${requireRevisionNumber(options.range.from)}:${requireRevisionNumber(options.range.to)}`);
  } else {
    argv.push("-c", requireRevision(options.revision));
  }
  argv.push("--", requireTarget(target));
  return argv;
}
function buildDiffSummarizeArgs(executable, target, revision) {
  return [
    requireExecutable(executable),
    "diff",
    "--summarize",
    NON_INTERACTIVE,
    "-c",
    requireRevision(revision),
    "--",
    requireTarget(target)
  ];
}
function buildUpdateArgs(executable, target) {
  return [
    requireExecutable(executable),
    "update",
    NON_INTERACTIVE,
    "--accept",
    "postpone",
    "--",
    requireTarget(target)
  ];
}
function buildCommitArgs(executable, message, targets) {
  if (typeof message !== "string" || message.trim() === "") throw new Error("svn commit message is required");
  const argv = [requireExecutable(executable), "commit", NON_INTERACTIVE, "-m", message, "--"];
  for (const target of targets) argv.push(requireTarget(target));
  return argv;
}
function parseBooleanAttribute(raw) {
  if (raw === void 0) return void 0;
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return void 0;
}
function parseLogXml(xml) {
  const document = parseXml(xml);
  const log = rootElement(document, "log");
  const entries = [];
  for (const entryNode of childElements(log, "logentry")) {
    const revision = parseRevision(attributeText(entryNode, "revision"));
    if (revision === null) throw new XmlParseError("svn log entry has no numeric revision");
    const author = childText(entryNode, "author");
    const date = parseSvnDate(childText(entryNode, "date"));
    const messageNode = firstChild(entryNode, "msg");
    const message = messageNode === void 0 ? "" : messageNode.text;
    const paths = [];
    const pathsNode = firstChild(entryNode, "paths");
    if (pathsNode !== void 0) {
      for (const pathNode of childElements(pathsNode, "path")) {
        const rawPath = pathNode.text.trim();
        const action = (attributeText(pathNode, "action") ?? "").toUpperCase();
        if (rawPath === "" || action === "") continue;
        const path = {
          action,
          path: rawPath,
          ...attributeText(pathNode, "kind") === void 0 ? {} : { kind: attributeText(pathNode, "kind") },
          ...attributeText(pathNode, "copyfrom-path") === void 0 ? {} : { copyFromPath: attributeText(pathNode, "copyfrom-path") },
          ...parseRevision(attributeText(pathNode, "copyfrom-rev")) === null ? {} : { copyFromRevision: parseRevision(attributeText(pathNode, "copyfrom-rev")) },
          ...parseBooleanAttribute(attributeText(pathNode, "prop-mods")) === void 0 ? {} : { propMods: parseBooleanAttribute(attributeText(pathNode, "prop-mods")) },
          ...parseBooleanAttribute(attributeText(pathNode, "text-mods")) === void 0 ? {} : { textMods: parseBooleanAttribute(attributeText(pathNode, "text-mods")) }
        };
        paths.push(path);
      }
    }
    entries.push({
      revision,
      ...author === void 0 ? {} : { author },
      ...date === void 0 ? {} : { date },
      message,
      paths
    });
  }
  return entries;
}
function parseInfoXml(xml) {
  const document = parseXml(xml);
  const info = rootElement(document, "info");
  const entry = firstChild(info, "entry");
  if (entry === void 0) throw new XmlParseError("svn info output has no entry");
  const repository = firstChild(entry, "repository");
  const wcInfo = firstChild(entry, "wc-info");
  const commit = firstChild(entry, "commit");
  const revision = parseRevision(attributeText(entry, "revision"));
  const lastChangedRevision = parseRevision(commit === void 0 ? void 0 : attributeText(commit, "revision"));
  const lastChangedDate = commit === void 0 ? void 0 : parseSvnDate(childText(commit, "date"));
  return {
    ...attributeText(entry, "path") === void 0 ? {} : { entryPath: attributeText(entry, "path") },
    ...attributeText(entry, "kind") === void 0 ? {} : { kind: attributeText(entry, "kind") },
    ...revision === null ? {} : { revision },
    ...childText(entry, "url") === void 0 ? {} : { url: childText(entry, "url") },
    ...childText(entry, "relative-url") === void 0 ? {} : { relativeUrl: childText(entry, "relative-url") },
    ...repository === void 0 || childText(repository, "root") === void 0 ? {} : { repositoryRoot: childText(repository, "root") },
    ...repository === void 0 || childText(repository, "uuid") === void 0 ? {} : { repositoryUuid: childText(repository, "uuid") },
    ...wcInfo === void 0 || childText(wcInfo, "wcroot-abspath") === void 0 ? {} : { wcRootPath: childText(wcInfo, "wcroot-abspath") },
    ...wcInfo === void 0 || childText(wcInfo, "schedule") === void 0 ? {} : { schedule: childText(wcInfo, "schedule") },
    ...wcInfo === void 0 || childText(wcInfo, "depth") === void 0 ? {} : { depth: childText(wcInfo, "depth") },
    ...lastChangedRevision === null ? {} : { lastChangedRevision },
    ...commit === void 0 || childText(commit, "author") === void 0 ? {} : { lastChangedAuthor: childText(commit, "author") },
    ...lastChangedDate === void 0 ? {} : { lastChangedDate }
  };
}
var STATUS_ITEMS = /* @__PURE__ */ new Set([
  "added",
  "conflicted",
  "deleted",
  "external",
  "ignored",
  "incomplete",
  "merged",
  "missing",
  "modified",
  "none",
  "normal",
  "obstructed",
  "replaced",
  "unversioned"
]);
var STATUS_LETTERS = {
  "?": "unversioned",
  "!": "missing",
  a: "added",
  c: "conflicted",
  d: "deleted",
  i: "ignored",
  m: "modified",
  r: "replaced",
  x: "external",
  "~": "obstructed"
};
function normalizeStatusItem(raw) {
  const value = raw.trim().toLowerCase();
  if (value === "") return "none";
  const letter = STATUS_LETTERS[value];
  if (letter !== void 0) return letter;
  return STATUS_ITEMS.has(value) ? value : "unknown";
}
function parseStatusXml(xml) {
  const document = parseXml(xml);
  const status = rootElement(document, "status");
  const entries = [];
  for (const target of childElements(status, "target")) {
    for (const entry of childElements(target, "entry")) {
      const rawPath = (attributeText(entry, "path") ?? "").trim();
      if (rawPath === "") continue;
      const wcStatus = firstChild(entry, "wc-status");
      const item = normalizeStatusItem(wcStatus === void 0 ? "none" : attributeText(wcStatus, "item") ?? "none");
      const props = wcStatus === void 0 ? "none" : normalizeStatusItem(attributeText(wcStatus, "props") ?? "none");
      const revision = parseRevision(wcStatus === void 0 ? void 0 : attributeText(wcStatus, "revision"));
      const treeConflicted = parseBooleanAttribute(
        wcStatus === void 0 ? void 0 : attributeText(wcStatus, "tree-conflicted")
      );
      entries.push({
        path: rawPath,
        item,
        props,
        ...revision === null ? {} : { revision },
        ...treeConflicted === void 0 || treeConflicted === false ? {} : { treeConflicted: true }
      });
    }
  }
  return entries;
}
function parseDiffSummarize(text) {
  const entries = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.trim() === "") continue;
    const match = /^\s*([A-Za-z?~!])\s+(?:\+\s+)?(.*)$/.exec(line);
    if (match === null) continue;
    const action = match[1].toUpperCase();
    let pathPart = match[2].trim();
    if (pathPart === "") continue;
    let copyFromPath;
    let copyFromRevision;
    const copyMatch = /^(.*?)\s+\(from (.+?):([0-9]{1,12})\)$/.exec(pathPart);
    if (copyMatch !== null) {
      pathPart = copyMatch[1].trim();
      copyFromPath = copyMatch[2].trim();
      copyFromRevision = parseRevision(copyMatch[3]) ?? void 0;
    }
    if (pathPart === "") continue;
    entries.push({
      action,
      path: pathPart,
      ...copyFromPath === void 0 ? {} : { copyFromPath },
      ...copyFromRevision === void 0 ? {} : { copyFromRevision }
    });
  }
  return entries;
}
function decodeUriPath(raw) {
  return raw.split("/").map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }).join("/");
}
function svnPrefixFromInfo(info) {
  const relative2 = info.relativeUrl?.trim();
  if (relative2 !== void 0 && relative2 !== "") {
    if (relative2 === "^" || relative2 === "^/") return "";
    const withoutCaret = relative2.startsWith("^/") ? relative2.slice(2) : relative2;
    return decodeUriPath(withoutCaret).replace(/^\/+|\/+$/g, "");
  }
  if (info.url !== void 0 && info.repositoryRoot !== void 0) {
    const url = info.url.trim().replace(/\/+$/, "");
    const rootUrl = info.repositoryRoot.trim().replace(/\/+$/, "");
    if (url === rootUrl) return "";
    if (url.startsWith(`${rootUrl}/`)) {
      return decodeUriPath(url.slice(rootUrl.length + 1)).replace(/^\/+|\/+$/g, "");
    }
  }
  return "";
}
function repoPathToRelative(rawPath, wcPrefix) {
  if (typeof rawPath !== "string") return null;
  let path = rawPath.trim().replace(/\\/g, "/");
  if (path === "") return null;
  if (path.startsWith("^/")) path = path.slice(1);
  if (path.startsWith("/")) path = path.slice(1);
  const prefix = wcPrefix.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (prefix !== "") {
    if (path === prefix) return null;
    if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length + 1);
  }
  return normalizeRepoRelativePath(path);
}
function samePath(a, b) {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function pathStartsWithRoot(path, root) {
  if (root === "") return false;
  const normalizedPath = process.platform === "win32" ? path.toLowerCase() : path;
  const normalizedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}
function targetPathToRelative(rawPath, wcRoot) {
  if (typeof rawPath !== "string") return null;
  let path = rawPath.trim().replace(/\\/g, "/");
  if (path === "" || path === ".") return null;
  const root = wcRoot.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (root !== "" && pathStartsWithRoot(path, root)) path = path.slice(root.length);
  if (path.startsWith("^/")) path = path.slice(1);
  if (path.startsWith("/")) path = path.slice(1);
  if (samePath(path, root)) return null;
  return normalizeRepoRelativePath(path);
}

// src/host/adapters/svn/adapter.ts
var CLEAN_WORTHY_STATUSES = /* @__PURE__ */ new Set([
  "added",
  "conflicted",
  "deleted",
  "incomplete",
  "merged",
  "missing",
  "modified",
  "obstructed",
  "replaced"
]);
var INFO_OUTPUT_CAP_BYTES = 256 * 1024;
var LOG_OUTPUT_CAP_BYTES = 4 * 1024 * 1024;
var STATUS_OUTPUT_CAP_BYTES = 4 * 1024 * 1024;
var DIFF_OUTPUT_CAP_BYTES = HARD_DIFF_MAX_BYTES + 64 * 1024;
var LOCAL_TIMEOUT_MS = 2e4;
var NETWORK_TIMEOUT_MS = 6e4;
var DIFF_TIMEOUT_MS = 3e4;
var MAX_STATUS_ENTRIES2 = 2e3;
var EPOCH_ISO = "1970-01-01T00:00:00.000Z";
var VCS_TYPE = "svn";
var NOT_A_WORKING_COPY_PATTERN = /E155007|E155010|E155004.*not a working copy|is not a working copy/i;
var AUTH_PATTERN = /E170001|E215004|E170013|authorization failed|authentication failed|not authorized|403 forbidden/i;
var CONNECT_PATTERN = /E175002|E670008|E730054|E731001|E731002|could not connect|unable to connect|connection refused|connection timed out|network is unreachable|no route to host|ssl handshake|e230001/i;
var CONFLICT_PATTERN = /E155015|E195020|E205000.*conflict|remains in conflict|in conflict/i;
var MISSING_CLIENT_PATTERN = /ENOENT|not found|not recognized|无法将|cannot find|could not find/i;
function ok(value) {
  return { ok: true, value };
}
function err(error) {
  return { ok: false, error };
}
function invalidRequest(message, detail) {
  return { code: "invalid-request", message, ...detail === void 0 ? {} : { detail }, retryable: false };
}
function internalError(error) {
  return {
    code: "internal",
    message: "the SVN adapter failed unexpectedly",
    detail: safeErrorMessage(error),
    retryable: false
  };
}
function firstLine2(message) {
  const normalized = message.replace(/\r\n?/g, "\n");
  const line = normalized.split("\n")[0];
  return line === void 0 ? "" : line.trim();
}
function resolveRoot(rootPath) {
  if (typeof rootPath !== "string" || rootPath.trim() === "") return null;
  return resolve2(rootPath.trim());
}
function requireRepositoryId(repositoryIdValue) {
  if (typeof repositoryIdValue !== "string" || repositoryIdValue.trim() === "") return null;
  return repositoryIdValue.trim();
}
async function isDirectory(path) {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}
async function canonicalizeDirectory(path) {
  try {
    const resolved = await realpath2(path);
    const info = await stat(resolved);
    return info.isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}
async function findMetadataAncestor(start) {
  let current = start;
  try {
    const info = await stat(current);
    if (!info.isDirectory()) current = dirname(current);
  } catch {
    return null;
  }
  for (let depth = 0; depth < 40; depth += 1) {
    if (await isDirectory(join2(current, ".svn"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
function resolveInfoRoot(info) {
  if (info.wcRootPath !== void 0 && info.wcRootPath.trim() !== "") return resolve2(info.wcRootPath.trim());
  if (info.entryPath !== void 0 && info.entryPath.trim() !== "") {
    const entryPath = info.entryPath.trim();
    if (/^[a-zA-Z]:[\\/]/.test(entryPath) || entryPath.startsWith("/") || entryPath.startsWith("\\\\")) {
      return resolve2(entryPath);
    }
  }
  return null;
}
function classifyFailure(result, fallback, signal) {
  const stderr = redactText(result.stderr ?? "");
  const spawnMessage = redactText(result.failureMessage ?? "");
  const combined = `${stderr}
${spawnMessage}`.trim();
  const detail = safeErrorMessage(combined === "" ? fallback : combined, 500);
  if (result.spawnFailed === true) {
    if (MISSING_CLIENT_PATTERN.test(combined)) {
      return {
        code: "vcs-not-installed",
        message: "the svn client could not be started; install Subversion and make sure svn is on PATH",
        detail,
        retryable: false
      };
    }
    return { code: "operation-failed", message: "the svn client could not be started", detail, retryable: false };
  }
  if (signal?.aborted === true) {
    return { code: "operation-failed", message: "the svn command was cancelled", detail, retryable: true };
  }
  if (result.timedOut === true) {
    return { code: "timeout", message: "the svn command exceeded its deadline", detail, retryable: true };
  }
  if (NOT_A_WORKING_COPY_PATTERN.test(combined)) {
    return { code: "not-a-repository", message: "the path is not an SVN working copy", detail, retryable: false };
  }
  if (AUTH_PATTERN.test(combined)) {
    return {
      code: "network-unknown",
      message: "svn authentication failed; the remote state is unknown",
      detail,
      retryable: false
    };
  }
  if (CONNECT_PATTERN.test(combined)) {
    return {
      code: "network-unknown",
      message: "svn could not reach the repository; the remote state is unknown",
      detail,
      retryable: true
    };
  }
  if (CONFLICT_PATTERN.test(combined)) {
    return { code: "conflict", message: "the operation stopped because the working copy has conflicts", detail, retryable: false };
  }
  return { code: "operation-failed", message: fallback, detail, retryable: false };
}
function parseOrError(stdout, capBytes, parser) {
  try {
    return ok(parser(stdout));
  } catch (error) {
    const bytes = Buffer.byteLength(stdout, "utf8");
    const likelyCapped = capBytes > 0 && bytes >= Math.floor(capBytes * 0.95);
    if (likelyCapped) {
      return err({
        code: "output-too-large",
        message: "svn output exceeded the capture limit and could not be parsed",
        retryable: false
      });
    }
    const message = error instanceof XmlParseError ? `could not parse svn XML output (${error.message})` : `could not parse svn output (${safeErrorMessage(error, 200)})`;
    return err({ code: "operation-failed", message, retryable: false });
  }
}
function summarizeActionToStatus(action) {
  switch (action) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "modified";
    case "C":
      return "copied";
    default:
      return "unknown";
  }
}
function classifyLogPath(path, wcPrefix, deletedPaths) {
  switch (path.action) {
    case "A": {
      if (path.copyFromPath !== void 0) {
        const oldPath = repoPathToRelative(path.copyFromPath, wcPrefix);
        if (oldPath !== null) {
          return { status: deletedPaths.has(oldPath) ? "renamed" : "copied", oldPath };
        }
      }
      return { status: "added" };
    }
    case "D":
      return { status: "deleted" };
    case "R":
      return { status: "modified" };
    case "M":
      return { status: "modified" };
    default:
      return null;
  }
}
function summarizePathToRelative(raw, wcRoot, wcPrefix) {
  if (typeof raw !== "string") return null;
  const slashed = raw.trim().replace(/\\/g, "/");
  if (slashed === "") return null;
  const root = wcRoot.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const comparable = process.platform === "win32" ? slashed.toLowerCase() : slashed;
  const comparableRoot = process.platform === "win32" ? root.toLowerCase() : root;
  const underRoot = root !== "" && (comparable === comparableRoot || comparable.startsWith(`${comparableRoot}/`));
  if (!underRoot && (slashed.startsWith("/") || slashed.startsWith("^/"))) {
    return repoPathToRelative(slashed, wcPrefix);
  }
  const prefix = wcPrefix.replace(/^\/+/, "").replace(/\/+$/, "");
  if (prefix !== "") {
    const comparablePrefix = process.platform === "win32" ? prefix.toLowerCase() : prefix;
    const comparableSlashed = process.platform === "win32" ? slashed.toLowerCase() : slashed;
    if (comparableSlashed === comparablePrefix || comparableSlashed.startsWith(`${comparablePrefix}/`)) {
      const byRepo = repoPathToRelative(`/${slashed}`, wcPrefix);
      if (byRepo !== null) return byRepo;
    }
  }
  return targetPathToRelative(slashed, wcRoot);
}
function buildCommitEvent(repositoryIdValue, entry) {
  const revisionNumber = Number(entry.revision);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `${repositoryIdValue}:${entry.revision}`,
    repositoryId: repositoryIdValue,
    vcsType: VCS_TYPE,
    eventType: "commit",
    source: "repository",
    timestamp: entry.date ?? EPOCH_ISO,
    ...entry.author === void 0 ? {} : { actor: entry.author },
    summary: firstLine2(entry.message),
    revision: entry.revision,
    changeSetId: `${repositoryIdValue}:${entry.revision}`,
    metadata: {
      parentCount: revisionNumber <= 1 ? 0 : 1,
      pathCount: entry.paths.length
    }
  };
}
function createSvnAdapter(runner) {
  const resolveClient = async () => {
    try {
      const executable = await runner.resolveExecutable("svn");
      if (executable === null || executable.trim() === "") {
        return {
          ok: false,
          error: {
            code: "vcs-not-installed",
            message: "the svn client is not installed or not on PATH; SVN repositories are unavailable",
            retryable: false
          }
        };
      }
      return { ok: true, value: executable };
    } catch (error) {
      return { ok: false, error: internalError(error) };
    }
  };
  const runSvn = async (argv, cwd, signal, options = {}) => {
    const runOptions = {
      timeoutMs: options.timeoutMs ?? LOCAL_TIMEOUT_MS,
      maxBytes: options.maxBytes ?? INFO_OUTPUT_CAP_BYTES
    };
    if (signal !== void 0) runOptions.signal = signal;
    return runner.run(argv, cwd, runOptions);
  };
  const readInfo = async (executable, root, signal) => {
    const run = await runSvn(buildInfoArgs(executable, root), root, signal, {
      timeoutMs: LOCAL_TIMEOUT_MS,
      maxBytes: INFO_OUTPUT_CAP_BYTES
    });
    if (run.exitCode !== 0) return err(classifyFailure(run, "svn info failed", signal));
    return parseOrError(run.stdout, INFO_OUTPUT_CAP_BYTES, parseInfoXml);
  };
  const readWcPrefix = async (executable, root, signal) => {
    try {
      const info = await readInfo(executable, root, signal);
      return info.ok ? svnPrefixFromInfo(info.value) : "";
    } catch {
      return "";
    }
  };
  const readStatus = async (executable, root, signal) => {
    const run = await runSvn(buildStatusArgs(executable, root), root, signal, {
      timeoutMs: LOCAL_TIMEOUT_MS,
      maxBytes: STATUS_OUTPUT_CAP_BYTES
    });
    if (run.exitCode !== 0) return err(classifyFailure(run, "svn status failed", signal));
    const parsed = parseOrError(run.stdout, STATUS_OUTPUT_CAP_BYTES, parseStatusXml);
    if (!parsed.ok) return parsed;
    const entries = [];
    const conflicts = [];
    const seen = /* @__PURE__ */ new Set();
    let changed = false;
    let unversioned = 0;
    let external = 0;
    for (const item of parsed.value) {
      const relative2 = targetPathToRelative(item.path, root);
      if (relative2 === null || seen.has(relative2)) continue;
      seen.add(relative2);
      const propChanged = item.props === "modified" || item.props === "conflicted";
      let status = item.item;
      if ((status === "normal" || status === "none") && propChanged) status = "modified";
      const conflicted = status === "conflicted" || item.treeConflicted === true || item.props === "conflicted";
      if (conflicted) conflicts.push(relative2);
      if (status === "unversioned") unversioned += 1;
      else if (status === "external") external += 1;
      if (CLEAN_WORTHY_STATUSES.has(status)) changed = true;
      entries.push({ path: relative2, status });
    }
    const warnings = [];
    if (unversioned > 0) warnings.push(`${unversioned} unversioned path(s) are not counted as local modifications`);
    if (external > 0) warnings.push(`${external} unversioned external path(s) are not counted as local modifications`);
    let truncated = false;
    let limitedEntries = entries;
    if (limitedEntries.length > MAX_STATUS_ENTRIES2) {
      limitedEntries = limitedEntries.slice(0, MAX_STATUS_ENTRIES2);
      truncated = true;
      warnings.push(`working copy status was truncated to ${MAX_STATUS_ENTRIES2} entries`);
    }
    return ok({ entries: limitedEntries, conflicts, changed, unversioned, external, truncated, warnings });
  };
  return {
    vcsType: VCS_TYPE,
    async detect(path) {
      try {
        const client = await resolveClient();
        if (!client.ok) return client;
        if (typeof path !== "string" || path.trim() === "") return ok(null);
        const start = resolve2(path.trim());
        const ancestor = await findMetadataAncestor(start);
        if (ancestor !== null) {
          const canonicalAncestor = await canonicalizeDirectory(ancestor) ?? ancestor;
          const info2 = await readInfo(client.value, canonicalAncestor, void 0);
          if (info2.ok) {
            const detected = resolveInfoRoot(info2.value);
            if (detected !== null) {
              const canonicalRoot = await canonicalizeDirectory(detected);
              if (canonicalRoot !== null) return ok({ rootPath: canonicalRoot });
            }
          }
          return ok({ rootPath: canonicalAncestor });
        }
        const info = await readInfo(client.value, start, void 0);
        if (info.ok) {
          const detected = resolveInfoRoot(info.value);
          if (detected !== null) {
            const canonicalRoot = await canonicalizeDirectory(detected);
            if (canonicalRoot !== null) return ok({ rootPath: canonicalRoot });
          }
        }
        return ok(null);
      } catch {
        return ok(null);
      }
    },
    async info(rootPath, signal) {
      try {
        const client = await resolveClient();
        if (!client.ok) return client;
        const root = resolveRoot(rootPath);
        if (root === null) return err(invalidRequest("repository root is required"));
        const infoResult = await readInfo(client.value, root, signal);
        if (!infoResult.ok) return infoResult;
        const facts = infoResult.value;
        const timestamp = (/* @__PURE__ */ new Date()).toISOString();
        const name = basename2(root);
        const repository = {
          schemaVersion: SCHEMA_VERSION,
          id: repositoryId(VCS_TYPE, root),
          vcsType: VCS_TYPE,
          rootPath: root,
          displayName: name === "" ? root : name,
          ...facts.url === void 0 ? {} : { remoteUrls: [redactUrl(facts.url)] },
          ...facts.revision === void 0 ? {} : { currentRevision: facts.revision },
          detectedAt: timestamp,
          lastSeenAt: timestamp
        };
        return ok(repository);
      } catch (error) {
        return err(internalError(error));
      }
    },
    async history(rootPath, repositoryIdValue, query, signal) {
      try {
        const requestedId = requireRepositoryId(repositoryIdValue);
        if (requestedId === null) return err(invalidRequest("repositoryId is required"));
        if (typeof query !== "object" || query === null) return err(invalidRequest("history query is required"));
        const client = await resolveClient();
        if (!client.ok) return client;
        const root = resolveRoot(rootPath);
        if (root === null) return err(invalidRequest("repository root is required"));
        const limit = clampInt(query.limit, 1, MAX_PAGE_SIZE, DEFAULT_HISTORY_LIMIT);
        if (Array.isArray(query.eventTypes) && query.eventTypes.length > 0 && !query.eventTypes.includes("commit")) {
          return ok({ events: [], nextCursor: null, hasMore: false });
        }
        let afterRevision = null;
        if (typeof query.cursor === "string" && query.cursor !== "") {
          const decoded = decodeCursor(query.cursor);
          const raw = decoded === null ? null : decoded["r"];
          const parsed2 = typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : typeof raw === "string" ? parseRevisionNumber(raw) : null;
          if (parsed2 === null) return err(invalidRequest("invalid history cursor"));
          afterRevision = parsed2;
        }
        if (afterRevision !== null && afterRevision <= 1) {
          return ok({ events: [], nextCursor: null, hasMore: false });
        }
        const revisionRange = afterRevision === null ? "HEAD:1" : `${afterRevision - 1}:1`;
        const argv = buildLogArgs(client.value, root, { revisionRange, limit, verbose: true });
        const run = await runSvn(argv, root, signal, { timeoutMs: NETWORK_TIMEOUT_MS, maxBytes: LOG_OUTPUT_CAP_BYTES });
        if (run.exitCode !== 0) return err(classifyFailure(run, "svn log failed", signal));
        const parsed = parseOrError(run.stdout, LOG_OUTPUT_CAP_BYTES, parseLogXml);
        if (!parsed.ok) return parsed;
        const rawEntries = parsed.value;
        const hasMore = rawEntries.length >= limit;
        const lastEntry = rawEntries[rawEntries.length - 1];
        const authorFilter = typeof query.author === "string" && query.author.trim() !== "" ? query.author.trim().toLowerCase() : void 0;
        const textFilter = typeof query.text === "string" && query.text.trim() !== "" ? query.text.trim().toLowerCase() : void 0;
        const since = typeof query.since === "string" ? Date.parse(query.since) : Number.NaN;
        const until = typeof query.until === "string" ? Date.parse(query.until) : Number.NaN;
        const events = [];
        for (const entry of rawEntries) {
          if (authorFilter !== void 0 && !(entry.author ?? "").toLowerCase().includes(authorFilter)) continue;
          if (textFilter !== void 0 && !entry.message.toLowerCase().includes(textFilter)) continue;
          const timestampMs = Date.parse(entry.date ?? EPOCH_ISO);
          if (Number.isFinite(since) && Number.isFinite(timestampMs) && timestampMs < since) continue;
          if (Number.isFinite(until) && Number.isFinite(timestampMs) && timestampMs > until) continue;
          events.push(buildCommitEvent(requestedId, entry));
        }
        const nextCursor = hasMore && lastEntry !== void 0 ? encodeCursor({ r: Number(lastEntry.revision) }) : null;
        return ok({ events, nextCursor, hasMore });
      } catch (error) {
        return err(internalError(error));
      }
    },
    async changeSet(rootPath, repositoryIdValue, revision, signal) {
      try {
        const requestedId = requireRepositoryId(repositoryIdValue);
        if (requestedId === null) return err(invalidRequest("repositoryId is required"));
        const canonicalRevision = parseRevision(revision);
        if (canonicalRevision === null) {
          return err(invalidRequest("revision must be a numeric SVN revision", "expected 1-12 decimal digits"));
        }
        const client = await resolveClient();
        if (!client.ok) return client;
        const root = resolveRoot(rootPath);
        if (root === null) return err(invalidRequest("repository root is required"));
        const logRun = await runSvn(
          buildLogArgs(client.value, root, { revisionRange: canonicalRevision, verbose: true }),
          root,
          signal,
          { timeoutMs: NETWORK_TIMEOUT_MS, maxBytes: LOG_OUTPUT_CAP_BYTES }
        );
        if (logRun.exitCode !== 0) return err(classifyFailure(logRun, "svn log failed", signal));
        const parsedLog = parseOrError(logRun.stdout, LOG_OUTPUT_CAP_BYTES, parseLogXml);
        if (!parsedLog.ok) return parsedLog;
        const entry = parsedLog.value.find((candidate) => candidate.revision === canonicalRevision);
        if (entry === void 0) {
          return err({
            code: "operation-failed",
            message: `revision r${canonicalRevision} is not present in the working copy history`,
            retryable: false
          });
        }
        const wcPrefix = await readWcPrefix(client.value, root, signal);
        const summarizeRun = await runSvn(
          buildDiffSummarizeArgs(client.value, root, canonicalRevision),
          root,
          signal,
          { timeoutMs: LOCAL_TIMEOUT_MS, maxBytes: LOG_OUTPUT_CAP_BYTES }
        );
        const summarizeEntries = summarizeRun.exitCode === 0 ? parseDiffSummarize(summarizeRun.stdout) : [];
        const summarizeByPath = /* @__PURE__ */ new Map();
        for (const item of summarizeEntries) {
          const relative2 = summarizePathToRelative(item.path, root, wcPrefix);
          if (relative2 !== null) summarizeByPath.set(relative2, item);
        }
        const deletedPaths = /* @__PURE__ */ new Set();
        for (const path of entry.paths) {
          if (path.action !== "D") continue;
          const relative2 = repoPathToRelative(path.path, wcPrefix);
          if (relative2 !== null) deletedPaths.add(relative2);
        }
        const seen = /* @__PURE__ */ new Set();
        const merged = [];
        for (const path of entry.paths) {
          const relative2 = repoPathToRelative(path.path, wcPrefix);
          if (relative2 === null || seen.has(relative2)) continue;
          seen.add(relative2);
          const classified = classifyLogPath(path, wcPrefix, deletedPaths);
          const summarize = summarizeByPath.get(relative2);
          if (classified === null) {
            merged.push({ path: relative2, status: summarize === void 0 ? "unknown" : summarizeActionToStatus(summarize.action) });
            continue;
          }
          merged.push({ path: relative2, ...classified });
        }
        for (const [relative2, item] of summarizeByPath) {
          if (seen.has(relative2)) continue;
          seen.add(relative2);
          merged.push({ path: relative2, status: summarizeActionToStatus(item.action) });
        }
        const files = [];
        let truncated = false;
        for (const item of merged) {
          if (files.length >= MAX_CHANGESET_FILES) {
            truncated = true;
            break;
          }
          files.push({
            path: item.path,
            status: item.status,
            ...item.oldPath === void 0 ? {} : { oldPath: item.oldPath }
          });
        }
        const revisionNumber = Number(canonicalRevision);
        const changeSet = {
          schemaVersion: SCHEMA_VERSION,
          id: `${requestedId}:${canonicalRevision}`,
          repositoryId: requestedId,
          vcsType: VCS_TYPE,
          revision: canonicalRevision,
          ...revisionNumber > 0 ? { parentRevision: String(revisionNumber - 1) } : {},
          createdAt: entry.date ?? EPOCH_ISO,
          files,
          ...truncated ? {
            truncated: true,
            truncationReason: `changeset has more than ${MAX_CHANGESET_FILES} changed paths; the file list was truncated`
          } : {}
        };
        return ok(changeSet);
      } catch (error) {
        return err(internalError(error));
      }
    },
    async diff(rootPath, repositoryIdValue, query, signal) {
      try {
        const requestedId = requireRepositoryId(repositoryIdValue);
        if (requestedId === null) return err(invalidRequest("repositoryId is required"));
        if (typeof query !== "object" || query === null) return err(invalidRequest("diff query is required"));
        const client = await resolveClient();
        if (!client.ok) return client;
        const root = resolveRoot(rootPath);
        if (root === null) return err(invalidRequest("repository root is required"));
        const revisionA = query.revisionA === void 0 ? null : parseRevision(query.revisionA);
        const revisionB = query.revisionB === void 0 ? null : parseRevision(query.revisionB);
        if (query.revisionA !== void 0 && revisionA === null) {
          return err(invalidRequest("revisionA must be a numeric SVN revision"));
        }
        if (query.revisionB !== void 0 && revisionB === null) {
          return err(invalidRequest("revisionB must be a numeric SVN revision"));
        }
        if (revisionA === null && revisionB === null) {
          return err(invalidRequest("an SVN diff needs revisionB (single revision) or both revisionA and revisionB (range)"));
        }
        let filePath;
        let target = root;
        if (query.filePath !== void 0) {
          const normalized = normalizeRepoRelativePath(query.filePath);
          if (normalized === null) {
            return err({ code: "path-not-allowed", message: "filePath must be a repository-relative path inside the working copy", retryable: false });
          }
          const joined = joinRepoPath(root, normalized);
          if (joined === null) {
            return err({ code: "path-not-allowed", message: "filePath escapes the working copy root", retryable: false });
          }
          filePath = normalized;
          target = joined;
        }
        const argv = revisionA !== null && revisionB !== null ? buildDiffArgs(client.value, target, { range: { from: Number(revisionA), to: Number(revisionB) } }) : buildDiffArgs(client.value, target, { revision: revisionB ?? revisionA });
        const maxBytes = clampInt(query.maxBytes, 1, HARD_DIFF_MAX_BYTES, DEFAULT_DIFF_MAX_BYTES);
        const run = await runSvn(argv, root, signal, { timeoutMs: DIFF_TIMEOUT_MS, maxBytes: DIFF_OUTPUT_CAP_BYTES });
        const combined = `${run.stdout}
${run.stderr}`;
        const binaryMarker = /Cannot display: file marked as a binary type/i.test(combined);
        if (run.exitCode !== 0) {
          if (binaryMarker) {
            return ok({
              repositoryId: requestedId,
              revisionA,
              revisionB,
              ...filePath === void 0 ? {} : { filePath },
              text: "",
              truncated: false,
              binary: true,
              bytes: 0
            });
          }
          return err(classifyFailure(run, "svn diff failed", signal));
        }
        if (binaryMarker || run.stdout.includes("\0")) {
          return ok({
            repositoryId: requestedId,
            revisionA,
            revisionB,
            ...filePath === void 0 ? {} : { filePath },
            text: "",
            truncated: false,
            binary: true,
            bytes: 0
          });
        }
        const capped = truncateUtf8(run.stdout, maxBytes);
        const bytes = Buffer.byteLength(capped.text, "utf8");
        return ok({
          repositoryId: requestedId,
          revisionA,
          revisionB,
          ...filePath === void 0 ? {} : { filePath },
          text: capped.text,
          truncated: capped.truncated,
          ...capped.truncated ? { truncationReason: `diff exceeds the ${maxBytes} byte limit` } : {},
          binary: false,
          bytes
        });
      } catch (error) {
        return err(internalError(error));
      }
    },
    async status(rootPath, repositoryIdValue, signal) {
      try {
        const requestedId = requireRepositoryId(repositoryIdValue);
        if (requestedId === null) return err(invalidRequest("repositoryId is required"));
        const client = await resolveClient();
        if (!client.ok) return client;
        const root = resolveRoot(rootPath);
        if (root === null) return err(invalidRequest("repository root is required"));
        const statusResult = await readStatus(client.value, root, signal);
        if (!statusResult.ok) return statusResult;
        const summary = statusResult.value;
        const warnings = [...summary.warnings];
        let head;
        const infoResult = await readInfo(client.value, root, signal);
        if (infoResult.ok) {
          head = infoResult.value.revision;
        } else {
          warnings.push("the working copy base revision could not be read");
        }
        const workingTree = {
          repositoryId: requestedId,
          vcsType: VCS_TYPE,
          clean: summary.changed === false,
          ...head === void 0 ? {} : { head },
          entries: summary.entries,
          conflicts: summary.conflicts,
          ...summary.truncated ? { truncated: true } : {},
          ...warnings.length > 0 ? { warnings } : {}
        };
        return ok(workingTree);
      } catch (error) {
        return err(internalError(error));
      }
    },
    async beforeState(rootPath, _operation, signal) {
      try {
        const client = await resolveClient();
        if (!client.ok) return client;
        const root = resolveRoot(rootPath);
        if (root === null) return err(invalidRequest("repository root is required"));
        const infoResult = await readInfo(client.value, root, signal);
        if (!infoResult.ok) return infoResult;
        const statusResult = await readStatus(client.value, root, signal);
        if (!statusResult.ok) return statusResult;
        const facts = infoResult.value;
        const baseRevision = facts.revision;
        const before = {
          ...baseRevision === void 0 ? {} : { revision: baseRevision },
          ...baseRevision === void 0 ? {} : { head: baseRevision },
          clean: statusResult.value.changed === false,
          ...facts.url === void 0 ? {} : { remoteUrls: [redactUrl(facts.url)] }
        };
        return ok(before);
      } catch (error) {
        return err(internalError(error));
      }
    },
    async planOperation(rootPath, operation, params, before) {
      try {
        const root = resolveRoot(rootPath);
        if (root === null) return err(invalidRequest("repository root is required"));
        const safeParams = typeof params === "object" && params !== null ? params : {};
        const state = typeof before === "object" && before !== null ? before : {};
        switch (operation) {
          case "update": {
            const client = await resolveClient();
            if (!client.ok) return client;
            const warnings = [];
            if (state.clean === false) {
              warnings.push("the working copy has local modifications; svn update may produce conflicts, which are reported after it runs");
            }
            const summary = state.revision === void 0 ? `update the SVN working copy at ${root}` : `update the SVN working copy at ${root} (base r${state.revision})`;
            return ok({
              allowed: true,
              argv: buildUpdateArgs(client.value, root),
              cwd: root,
              summary,
              warnings,
              network: true
            });
          }
          case "commit": {
            const message = readCommitMessage(safeParams);
            if (!message.ok) return err(message.error);
            const paths = readCommitPaths(safeParams["paths"], root);
            if (!paths.ok) return err(paths.error);
            const client = await resolveClient();
            if (!client.ok) return client;
            const targets = paths.value.length > 0 ? paths.value : [root];
            const warnings = [];
            const statusResult = await readStatus(client.value, root, void 0);
            if (statusResult.ok) {
              if (statusResult.value.changed === false) {
                warnings.push("no local modifications were detected; svn commit has nothing to send");
              }
              if (statusResult.value.conflicts.length > 0) {
                warnings.push(`the working copy has ${statusResult.value.conflicts.length} conflicted path(s); commit may fail until they are resolved`);
              }
            } else {
              warnings.push("the working copy status could not be read; the commit will still be attempted");
            }
            if (paths.value.length === 0) {
              warnings.push("no explicit paths were given; every modified versioned path under the working copy root will be committed");
            }
            const preview = firstLine2(message.value).slice(0, 80);
            const scope = paths.value.length > 0 ? `${paths.value.length} explicit path(s)` : "all modified paths";
            const summary = preview === "" ? `commit ${scope} in ${root}` : `commit ${scope} in ${root}: ${preview}`;
            return ok({
              allowed: true,
              argv: buildCommitArgs(client.value, message.value, targets),
              cwd: root,
              summary,
              warnings,
              network: true
            });
          }
          case "fetch":
          case "pull":
          case "push":
          case "merge":
          case "rebase":
            return ok({
              allowed: false,
              blockedReason: `${operation} is not applicable to an SVN working copy; use update to receive changes and commit to publish them`,
              argv: [],
              cwd: root,
              summary: `${operation} is not applicable to SVN`,
              warnings: [],
              network: false
            });
          case "switch":
            return ok({
              allowed: false,
              blockedReason: "switch is not implemented in dsh-vcs-timeline v1",
              argv: [],
              cwd: root,
              summary: "switch is not implemented in dsh-vcs-timeline v1",
              warnings: [],
              network: false
            });
          case "status":
          case "diff":
            return ok({
              allowed: false,
              blockedReason: `${operation} is a read-only operation and is not planned as a write`,
              argv: [],
              cwd: root,
              summary: `${operation} is a read-only operation`,
              warnings: [],
              network: false
            });
          default:
            return ok({
              allowed: false,
              blockedReason: "operation is not implemented for SVN",
              argv: [],
              cwd: root,
              summary: "operation is not implemented for SVN",
              warnings: [],
              network: false
            });
        }
      } catch (error) {
        return err(internalError(error));
      }
    }
  };
}
function readCommitMessage(params) {
  const raw = params["message"];
  if (typeof raw !== "string") {
    return { ok: false, error: invalidRequest("a commit message is required", "params.message must be a non-empty string") };
  }
  if (raw.trim() === "") {
    return { ok: false, error: invalidRequest("a commit message is required", "params.message must not be blank") };
  }
  if (raw.length > MAX_COMMIT_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: invalidRequest(`the commit message exceeds ${MAX_COMMIT_MESSAGE_LENGTH} characters`)
    };
  }
  return { ok: true, value: raw };
}
function readCommitPaths(raw, root) {
  if (raw === void 0) return { ok: true, value: [] };
  let candidates = [];
  if (Array.isArray(raw)) {
    candidates = raw.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter((entry) => entry !== "");
    if (candidates.length === 0) {
      return { ok: false, error: invalidRequest("the explicit commit path list is empty", "pass no paths to commit every modified path") };
    }
  } else if (typeof raw === "string") {
    if (raw.trim() === "") {
      return { ok: false, error: invalidRequest("the explicit commit path list is empty", "pass no paths to commit every modified path") };
    }
    candidates = raw.split(",").map((entry) => entry.trim()).filter((entry) => entry !== "");
  } else {
    return { ok: false, error: invalidRequest("params.paths must be a comma-separated string or an array of strings") };
  }
  const targets = [];
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    const relative2 = normalizeRepoRelativePath(candidate);
    if (relative2 === null) {
      return {
        ok: false,
        error: {
          code: "path-not-allowed",
          message: "commit paths must be repository-relative and must stay inside the working copy",
          detail: safeErrorMessage(candidate, 200),
          retryable: false
        }
      };
    }
    const joined = joinRepoPath(root, relative2);
    if (joined === null) {
      return {
        ok: false,
        error: {
          code: "path-not-allowed",
          message: "commit paths must stay inside the working copy root",
          detail: safeErrorMessage(candidate, 200),
          retryable: false
        }
      };
    }
    if (seen.has(joined)) continue;
    seen.add(joined);
    targets.push(joined);
  }
  if (targets.length === 0) {
    return { ok: false, error: invalidRequest("the explicit commit path list is empty", "pass no paths to commit every modified path") };
  }
  return { ok: true, value: targets };
}

// src/host/audit/audit-service.ts
import { randomBytes } from "node:crypto";

// src/host/storage/interface.ts
var StoreError = class extends Error {
  /** Machine code (`storage-failure` by default). */
  code;
  constructor(message, code = "storage-failure") {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
};

// src/host/audit/audit-service.ts
var REQUEST_SUMMARY_MAX = 500;
var OUTPUT_SUMMARY_MAX = 2e3;
var OUTPUT_SUMMARY_LINES = 20;
var SAFE_ERROR_MAX = 500;
var ERROR_CODE_MAX = 120;
var CORRELATION_ID_MAX = 200;
var REVISION_MAX = 200;
var CHANGED_PATHS_MAX = 200;
var CHANGED_PATH_MAX = 500;
var TERMINAL_STATES = ["succeeded", "failed", "partial", "unknown"];
function boundedText(raw, max) {
  const redacted = redactText(raw).replace(/\u0000/g, "");
  return redacted.length > max ? `${redacted.slice(0, max - 1)}\u2026` : redacted;
}
function boundedErrorText(raw) {
  return boundedText(raw.replace(/\s+/g, " ").trim(), SAFE_ERROR_MAX);
}
function summariseOutput(raw) {
  const redacted = redactText(raw).replace(/\u0000/g, "");
  const head = redacted.split(/\r?\n/).slice(0, OUTPUT_SUMMARY_LINES).join("\n").trim();
  return boundedText(head, OUTPUT_SUMMARY_MAX);
}
function asStoreError(action, error) {
  if (error instanceof StoreError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new StoreError(`audit: ${action} could not be persisted: ${boundedText(message, 200)}`, "storage-failure");
}
function pickRevision(state) {
  if (typeof state !== "object" || state === null) return void 0;
  for (const candidate of [state.revision, state.head]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim().slice(0, REVISION_MAX);
  }
  return void 0;
}
function capChangedPaths(paths) {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of paths) {
    if (typeof candidate !== "string") continue;
    const path = candidate.trim();
    if (path === "" || seen.has(path)) continue;
    seen.add(path);
    result.push(path.slice(0, CHANGED_PATH_MAX));
    if (result.length >= CHANGED_PATHS_MAX) break;
  }
  return result;
}
function createAuditService(store, options = {}) {
  if (typeof store !== "object" || store === null || typeof store.appendOperation !== "function") {
    throw new StoreError("audit service requires a store with appendOperation", "invalid-request");
  }
  const injected = typeof options === "object" && options !== null ? options.now : void 0;
  if (injected !== void 0 && typeof injected !== "function") {
    throw new StoreError("audit service clock must be a function returning a Date", "invalid-request");
  }
  const now = () => {
    const value = injected === void 0 ? /* @__PURE__ */ new Date() : injected();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new StoreError("audit service clock returned an invalid date", "storage-failure");
    }
    return value;
  };
  const nowIso = () => now().toISOString();
  return {
    async start(input) {
      if (typeof input !== "object" || input === null) {
        throw new StoreError("audit start requires an input object", "invalid-request");
      }
      const repositoryId2 = typeof input.repositoryId === "string" ? input.repositoryId.trim() : "";
      if (repositoryId2 === "") {
        throw new StoreError("audit start requires a repositoryId", "invalid-request");
      }
      if (input.vcsType !== "git" && input.vcsType !== "svn") {
        throw new StoreError("audit start requires a vcsType of git or svn", "invalid-request");
      }
      const operation = typeof input.operation === "string" ? input.operation.trim() : "";
      if (operation === "") {
        throw new StoreError("audit start requires an operation", "invalid-request");
      }
      const startedAt = nowIso();
      const requestSummary = boundedText(typeof input.requestSummary === "string" ? input.requestSummary : "", REQUEST_SUMMARY_MAX);
      const suppliedCorrelation = typeof input.correlationId === "string" ? input.correlationId.trim() : "";
      const correlationId = suppliedCorrelation === "" ? `corr-${randomBytes(16).toString("hex")}` : suppliedCorrelation.slice(0, CORRELATION_ID_MAX);
      const beforeRevision = pickRevision(input.before);
      const attempt = {
        schemaVersion: SCHEMA_VERSION,
        id: `op-${randomBytes(8).toString("hex")}`,
        repositoryId: repositoryId2,
        vcsType: input.vcsType,
        operation: input.operation,
        state: "started",
        startedAt,
        actor: "user-via-plugin",
        requestSummary,
        correlationId,
        ...beforeRevision === void 0 ? {} : { beforeRevision }
      };
      try {
        await store.appendOperation(attempt);
      } catch (error) {
        throw asStoreError("started record", error);
      }
      return attempt;
    },
    async finish(attempt, input) {
      if (typeof attempt !== "object" || attempt === null || typeof attempt.id !== "string" || attempt.id.trim() === "") {
        throw new StoreError("audit finish requires the started attempt record", "invalid-request");
      }
      if (typeof input !== "object" || input === null) {
        throw new StoreError("audit finish requires an input object", "invalid-request");
      }
      if (!TERMINAL_STATES.includes(input.state)) {
        throw new StoreError("audit finish requires a terminal state", "invalid-request");
      }
      const record = {
        ...attempt,
        schemaVersion: SCHEMA_VERSION,
        state: input.state,
        startedAt: attempt.startedAt,
        finishedAt: nowIso()
      };
      if (typeof input.exitCode === "number" && Number.isFinite(input.exitCode)) {
        record.exitCode = Math.trunc(input.exitCode);
      } else {
        delete record.exitCode;
      }
      if (typeof input.errorCode === "string" && input.errorCode.trim() !== "") {
        record.errorCode = boundedText(input.errorCode.trim(), ERROR_CODE_MAX);
      } else {
        delete record.errorCode;
      }
      if (typeof input.safeErrorMessage === "string" && input.safeErrorMessage.trim() !== "") {
        record.safeErrorMessage = boundedErrorText(input.safeErrorMessage);
      } else {
        delete record.safeErrorMessage;
      }
      if (typeof input.outputSummary === "string" && input.outputSummary.trim() !== "") {
        record.outputSummary = summariseOutput(input.outputSummary);
      } else {
        delete record.outputSummary;
      }
      const afterRevision = pickRevision(input.after);
      if (afterRevision !== void 0) {
        record.afterRevision = afterRevision;
      } else {
        delete record.afterRevision;
      }
      if (Array.isArray(input.changedPaths)) {
        const changedPaths = capChangedPaths(input.changedPaths);
        if (changedPaths.length > 0) record.changedPaths = changedPaths;
        else delete record.changedPaths;
      } else {
        delete record.changedPaths;
      }
      if (input.remoteOutcome === "confirmed-success" || input.remoteOutcome === "confirmed-failure" || input.remoteOutcome === "unknown") {
        record.remoteOutcome = input.remoteOutcome;
      } else {
        delete record.remoteOutcome;
      }
      try {
        await store.appendOperation(record);
      } catch (error) {
        throw asStoreError("terminal record", error);
      }
      return record;
    }
  };
}

// src/host/diagnostics.ts
import { readFile } from "node:fs/promises";
var CACHE_TTL_MS = 3e4;
async function toolVersion(runner, tool) {
  const executable = await runner.resolveExecutable(tool);
  if (executable === null) return null;
  const result = await runner.run([tool, "--version"], process.cwd(), { timeoutMs: 5e3, maxBytes: 64 * 1024 });
  if (result.exitCode !== 0) return null;
  const first = result.stdout.split(/\r?\n/)[0]?.trim();
  return first === void 0 || first === "" ? null : first;
}
async function dshVersion() {
  const candidates = [
    process.env.DSH_VERSION,
    process.env.DSH_DESKTOP_VERSION
  ].filter((value) => typeof value === "string" && value !== "");
  if (candidates.length > 0) return candidates[0];
  try {
    const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}
function createDiagnosticsProvider(deps) {
  let cache;
  return async () => {
    const current = Date.now();
    if (cache !== void 0 && current - cache.at < CACHE_TTL_MS) return cache.value;
    const [gitVersion, svnVersion, version] = await Promise.all([
      toolVersion(deps.runner, "git"),
      toolVersion(deps.runner, "svn"),
      dshVersion()
    ]);
    const warnings = [];
    if (gitVersion === null) warnings.push("git executable not found");
    if (svnVersion === null) warnings.push("svn executable not found");
    const value = {
      pluginVersion: deps.pluginVersion,
      dshVersion: version,
      platform: `${process.platform} ${process.arch}`,
      dataDir: deps.dataDir,
      gitVersion,
      svnVersion,
      workspaceCount: deps.workspaces().length,
      warnings
    };
    cache = { at: current, value };
    return value;
  };
}

// src/host/discovery.ts
import { constants } from "node:fs";
import { access, readdir, realpath as realpath3, stat as stat2 } from "node:fs/promises";
import { basename as basename3, sep as sep2 } from "node:path";
var SKIP_DIRECTORIES = /* @__PURE__ */ new Set([
  ".git",
  ".svn",
  ".hg",
  "node_modules",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".output",
  "target",
  "obj",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".cache",
  ".gradle",
  ".idea",
  "coverage",
  ".pytest_cache",
  ".mypy_cache",
  ".svelte-kit"
]);
var MAX_DISCOVERY_DEPTH = 3;
var MAX_DISCOVERY_ENTRIES = 4e3;
async function isDirectory2(path) {
  try {
    const info = await stat2(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}
async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
async function canonicalize(path) {
  try {
    return await realpath3(path);
  } catch {
    return null;
  }
}
async function detectRootKind(dir) {
  if (await exists(`${dir}${sep2}.git`)) return "git";
  if (await exists(`${dir}${sep2}.svn`)) return "svn";
  return null;
}
async function discoverUnder(root, depthLimit, maxEntries) {
  const found = [];
  let visited = 0;
  let queue = [{ path: root, depth: 0 }];
  while (queue.length > 0 && visited < maxEntries) {
    const next = [];
    for (const current of queue) {
      if (visited >= maxEntries) break;
      visited += 1;
      const kind = await detectRootKind(current.path);
      if (kind !== null) {
        found.push({ rootPath: current.path, vcsType: kind });
        continue;
      }
      if (current.depth >= depthLimit) continue;
      let entries;
      try {
        entries = await readdir(current.path, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;
        next.push({ path: `${current.path}${sep2}${entry.name}`, depth: current.depth + 1 });
      }
    }
    queue = next;
  }
  return found;
}
function createRepositoryRegistry(deps) {
  const now = deps.now ?? (() => /* @__PURE__ */ new Date());
  const cache = /* @__PURE__ */ new Map();
  const granted = /* @__PURE__ */ new Set();
  const enrich = async (root, kind) => {
    const adapter = kind === "git" ? deps.adapters.git : deps.adapters.svn;
    const info = await adapter.info(root);
    if (!info.ok) {
      deps.log?.(`dsh-vcs-timeline: info failed for ${root}: ${info.error.message}`);
      return null;
    }
    const repository = { ...info.value, id: repositoryId(kind, info.value.rootPath) };
    cache.set(repository.id, repository);
    return repository;
  };
  const persist = async (repository) => {
    if (deps.store === void 0) return;
    try {
      await deps.store.appendRepository(repository);
    } catch (error) {
      deps.log?.(`dsh-vcs-timeline: repository persist failed: ${safeErrorMessage(error)}`);
    }
  };
  const collect = async (workspacePath) => {
    const warnings = [];
    const workspaces = deps.workspaces();
    const roots = /* @__PURE__ */ new Set();
    if (workspacePath !== null && workspacePath.trim() !== "") {
      const canonical = await canonicalize(workspacePath);
      if (canonical === null) {
        warnings.push(`workspace path does not resolve: ${workspacePath}`);
      } else if (!workspaces.some((workspace) => canonical === workspace.path || canonical.startsWith(`${workspace.path}${sep2}`))) {
        warnings.push("workspace path is not a registered workspace");
      } else {
        roots.add(canonical);
      }
    } else {
      for (const workspace of workspaces) roots.add(workspace.path);
    }
    for (const grantedRoot of granted) roots.add(grantedRoot);
    const detected = [];
    const seen = /* @__PURE__ */ new Set();
    for (const root of roots) {
      const kind = await detectRootKind(root);
      const picked = kind !== null ? [{ rootPath: root, vcsType: kind }] : await discoverUnder(root, MAX_DISCOVERY_DEPTH, MAX_DISCOVERY_ENTRIES);
      for (const item of picked) {
        const key = `${item.vcsType}:${item.rootPath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        detected.push(item);
      }
    }
    const repositories = [];
    for (const item of detected) {
      const previous = [...cache.values()].find((repository2) => repository2.rootPath === item.rootPath && repository2.vcsType === item.vcsType);
      const repository = await enrich(item.rootPath, item.vcsType);
      if (repository === null) continue;
      const snapshot = {
        ...repository,
        detectedAt: previous?.detectedAt ?? repository.detectedAt,
        lastSeenAt: now().toISOString()
      };
      cache.set(snapshot.id, snapshot);
      if (previous === void 0 || previous.currentRevision !== snapshot.currentRevision || previous.currentBranch !== snapshot.currentBranch) {
        await persist(snapshot);
      }
      repositories.push(snapshot);
    }
    repositories.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.rootPath.localeCompare(b.rootPath));
    return { repositories, warnings };
  };
  return {
    list: collect,
    async add(path) {
      if (typeof path !== "string" || path.trim() === "") {
        return { ok: false, error: { code: "invalid-request", message: "repository path is required" } };
      }
      if (!await isDirectory2(path)) {
        return { ok: false, error: { code: "invalid-request", message: "path does not exist or is not a directory", detail: safeErrorMessage(path) } };
      }
      const canonical = await canonicalize(path);
      if (canonical === null) {
        return { ok: false, error: { code: "invalid-request", message: "path does not resolve", detail: safeErrorMessage(path) } };
      }
      const root = await findRootFor(canonical);
      if (root === null) {
        return { ok: false, error: { code: "not-a-repository", message: "no Git or SVN metadata was found at this path" } };
      }
      granted.add(root.rootPath);
      const repository = await enrich(root.rootPath, root.vcsType);
      if (repository === null) {
        return { ok: false, error: { code: "internal", message: "repository metadata could not be read" } };
      }
      const snapshot = { ...repository, lastSeenAt: now().toISOString(), detectedAt: now().toISOString() };
      cache.set(snapshot.id, snapshot);
      await persist(snapshot);
      return { ok: true, repository: snapshot };
    },
    async remove(id) {
      const repository = cache.get(id);
      if (repository === void 0) return false;
      if (!granted.has(repository.rootPath)) return false;
      granted.delete(repository.rootPath);
      cache.delete(id);
      return true;
    },
    get(id) {
      return cache.get(id);
    },
    async gate(id) {
      const location = id.indexOf(":");
      if (location <= 0) return { ok: false, error: { code: "unknown-repository", message: "unknown repository id" } };
      const vcsType = id.slice(0, location);
      if (vcsType !== "git" && vcsType !== "svn") {
        return { ok: false, error: { code: "unknown-repository", message: "unknown repository id" } };
      }
      const cached = cache.get(id);
      if (cached === void 0) return { ok: false, error: { code: "unknown-repository", message: "repository is not known in this session; refresh the repository list" } };
      const canonical = await canonicalize(cached.rootPath);
      if (canonical === null) {
        return { ok: false, error: { code: "unknown-repository", message: "repository path no longer resolves" } };
      }
      if (repositoryId(vcsType, canonical) !== id) {
        return { ok: false, error: { code: "path-not-allowed", message: "repository path changed after discovery" } };
      }
      const allowed = granted.has(canonical) || deps.workspaces().some((workspace) => canonical === workspace.path || canonical.startsWith(`${workspace.path}${sep2}`));
      if (!allowed) {
        return { ok: false, error: { code: "path-not-allowed", message: "repository is outside every registered workspace" } };
      }
      const kind = await detectRootKind(canonical);
      if (kind === null || kind !== vcsType) {
        return { ok: false, error: { code: "not-a-repository", message: "path is no longer a repository root of the expected type" } };
      }
      const adapter = kind === "git" ? deps.adapters.git : deps.adapters.svn;
      const info = await adapter.info(canonical);
      if (!info.ok) return { ok: false, error: info.error };
      const repository = { ...info.value, id, rootPath: canonical };
      cache.set(id, repository);
      return { ok: true, repository, canonicalRoot: canonical };
    },
    knownRoots() {
      return [...cache.values()].map((repository) => repository.rootPath);
    }
  };
  async function findRootFor(canonicalPath) {
    let current = canonicalPath;
    for (let depth = 0; depth < 40; depth += 1) {
      const kind = await detectRootKind(current);
      if (kind !== null) {
        const canonicalRoot = await canonicalize(current);
        return canonicalRoot === null ? null : { rootPath: canonicalRoot, vcsType: kind };
      }
      const parent = current.slice(0, Math.max(0, current.lastIndexOf(sep2)));
      if (parent === "" || parent === current) break;
      current = parent;
    }
    return null;
  }
}

// src/host/services/timeline-service.ts
function createRepositoryResolver(registry, adapters) {
  return {
    adapters,
    async resolve(id) {
      if (typeof id !== "string" || id === "") {
        return { ok: false, error: { code: "invalid-request", message: "repositoryId is required" } };
      }
      const gated = await registry.gate(id);
      if (!gated.ok) return { ok: false, error: gated.error };
      const adapter = gated.repository.vcsType === "git" ? adapters.git : adapters.svn;
      return { ok: true, value: { repository: gated.repository, root: gated.canonicalRoot, adapter } };
    }
  };
}
var ServiceError = class extends Error {
  code;
  detail;
  retryable;
  constructor(error) {
    super(error.message);
    this.name = "ServiceError";
    this.code = error.code;
    this.detail = error.detail;
    this.retryable = error.retryable;
  }
  toApiError() {
    return {
      code: this.code,
      message: this.message,
      ...this.detail === void 0 ? {} : { detail: this.detail },
      ...this.retryable === void 0 ? {} : { retryable: this.retryable }
    };
  }
};
function fail(code, message, detail) {
  throw new ServiceError({ code, message, ...detail === void 0 ? {} : { detail } });
}
function pageSize(value) {
  return clampInt(value, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
}
function normalizeWindow(query) {
  const since = parseIsoTimestamp(query.since) ?? void 0;
  const until = parseIsoTimestamp(query.until) ?? void 0;
  return {
    ...since === void 0 ? {} : { since },
    ...until === void 0 ? {} : { until }
  };
}
function createTimelineService(deps) {
  return {
    async listRepositories(workspacePath) {
      const result = await deps.registry.list(workspacePath);
      const diagnostics = await deps.diagnostics();
      return {
        repositories: result.repositories,
        diagnostics: { ...diagnostics, warnings: [...diagnostics.warnings, ...result.warnings] }
      };
    },
    async addRepository(path) {
      if (typeof path !== "string" || path.trim() === "") fail("invalid-request", "path is required");
      const added = await deps.registry.add(path);
      if (!added.ok) throw new ServiceError(added.error);
      return added.repository;
    },
    async removeRepository(id) {
      const removed = await deps.registry.remove(id);
      return { removed };
    },
    async repository(id) {
      const resolved = await deps.resolver.resolve(id);
      if (!resolved.ok) throw new ServiceError(resolved.error);
      return resolved.value.repository;
    },
    async timeline(query) {
      if (typeof query !== "object" || query === null) fail("invalid-request", "query is required");
      const resolved = await deps.resolver.resolve(query.repositoryId);
      if (!resolved.ok) throw new ServiceError(resolved.error);
      const { adapter, repository, root } = resolved.value;
      const limit = pageSize(query.limit);
      const window = normalizeWindow(query);
      const eventTypes = Array.isArray(query.eventTypes) ? query.eventTypes.filter((type) => type === "commit") : void 0;
      const history = await adapter.history(root, repository.id, {
        ...typeof query.cursor === "string" ? { cursor: query.cursor } : {},
        limit,
        ...typeof query.author === "string" && query.author.trim() !== "" ? { author: query.author.trim().slice(0, 200) } : {},
        ...typeof query.text === "string" && query.text.trim() !== "" ? { text: query.text.trim().slice(0, 200) } : {},
        ...window,
        ...eventTypes === void 0 ? {} : { eventTypes }
      });
      if (!history.ok) throw new ServiceError(history.error);
      return {
        events: history.value.events,
        nextCursor: history.value.nextCursor,
        hasMore: history.value.hasMore,
        ...history.value.warnings === void 0 ? {} : { warnings: history.value.warnings, partial: true }
      };
    },
    async changeSet(repositoryId2, revision) {
      const resolved = await deps.resolver.resolve(repositoryId2);
      if (!resolved.ok) throw new ServiceError(resolved.error);
      const result = await resolved.value.adapter.changeSet(resolved.value.root, resolved.value.repository.id, revision);
      if (!result.ok) throw new ServiceError(result.error);
      try {
        await deps.store.appendChangeSet(result.value);
      } catch {
      }
      return result.value;
    },
    async diff(query) {
      const resolved = await deps.resolver.resolve(query.repositoryId);
      if (!resolved.ok) throw new ServiceError(resolved.error);
      const maxBytes = clampInt(query.maxBytes, 1024, HARD_DIFF_MAX_BYTES, DEFAULT_DIFF_MAX_BYTES);
      const result = await resolved.value.adapter.diff(resolved.value.root, resolved.value.repository.id, {
        ...typeof query.revisionA === "string" ? { revisionA: query.revisionA } : {},
        ...typeof query.revisionB === "string" ? { revisionB: query.revisionB } : {},
        ...typeof query.filePath === "string" ? { filePath: query.filePath } : {},
        ...typeof query.contextLines === "number" ? { contextLines: clampInt(query.contextLines, 0, 32, 3) } : {},
        maxBytes
      });
      if (!result.ok) throw new ServiceError(result.error);
      return result.value;
    },
    async status(repositoryId2) {
      const resolved = await deps.resolver.resolve(repositoryId2);
      if (!resolved.ok) throw new ServiceError(resolved.error);
      const result = await resolved.value.adapter.status(resolved.value.root, resolved.value.repository.id);
      if (!result.ok) throw new ServiceError(result.error);
      return result.value;
    }
  };
}

// src/host/routes.ts
var BODY_MAX_BYTES = 256 * 1024;
function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store"
  });
  res.end(payload);
}
function ok2(value) {
  return { ok: true, value };
}
function fail2(error) {
  return { ok: false, error };
}
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk;
    size += buffer.length;
    if (size > BODY_MAX_BYTES) {
      req.destroy();
      return null;
    }
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function isLoopbackAddress(address) {
  if (address === void 0) return false;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin === "") return true;
  const host = req.headers.host;
  if (typeof host !== "string" || host === "") return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
function requiredString(payload, key, max = 512) {
  const value = payload[key];
  if (typeof value !== "string" || value === "") {
    throw new ServiceError({ code: "invalid-request", message: `${key} is required` });
  }
  return value.slice(0, max);
}
function optionalString(payload, key, max = 4096) {
  const value = payload[key];
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "string") {
    throw new ServiceError({ code: "invalid-request", message: `${key} must be a string` });
  }
  return value.slice(0, max);
}
function optionalLimit(payload) {
  const value = payload.limit;
  if (value === void 0 || value === null) return void 0;
  return clampInt(value, 1, MAX_PAGE_SIZE, 30);
}
function timelineQuery(payload) {
  const eventTypes = payload.eventTypes;
  const cursor = payload.cursor;
  const author = optionalString(payload, "author", 200);
  const text = optionalString(payload, "text", 200);
  const since = optionalString(payload, "since", 64);
  const until = optionalString(payload, "until", 64);
  const limit = optionalLimit(payload);
  return {
    repositoryId: requiredString(payload, "repositoryId", 1024),
    ...Array.isArray(eventTypes) ? { eventTypes: eventTypes.filter((entry) => typeof entry === "string") } : {},
    ...author === void 0 ? {} : { author },
    ...text === void 0 ? {} : { text },
    ...since === void 0 ? {} : { since },
    ...until === void 0 ? {} : { until },
    ...typeof cursor === "string" && cursor !== "" ? { cursor } : {},
    ...limit === void 0 ? {} : { limit }
  };
}
function operationRequest(payload) {
  const operation = requiredString(payload, "operation", 32);
  const params = payload.params;
  const token = optionalString(payload, "confirmationToken", 256);
  return {
    repositoryId: requiredString(payload, "repositoryId", 1024),
    operation,
    ...params === void 0 ? {} : { params },
    ...token === void 0 ? {} : { confirmationToken: token }
  };
}
function operationQuery(payload) {
  const repositoryId2 = optionalString(payload, "repositoryId", 1024);
  const cursor = optionalString(payload, "cursor", 256);
  return {
    ...repositoryId2 === void 0 ? {} : { repositoryId: repositoryId2 },
    ...cursor === void 0 ? {} : { cursor },
    ...optionalLimit(payload) === void 0 ? {} : { limit: optionalLimit(payload) }
  };
}
function registerVcsRoutes(ctx, deps) {
  const log = deps.log ?? ((message) => ctx.logger.warn(message));
  const handle = async (req, res) => {
    if (!isLoopbackAddress(req.socket.remoteAddress) && !isLoopbackAddress(req.socket.localAddress)) {
      writeJson(res, 403, fail2({ code: "path-not-allowed", message: "this route family is loopback-only" }));
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (!isSameOrigin(req)) {
      writeJson(res, 403, fail2({ code: "path-not-allowed", message: "cross-origin request rejected" }));
      return;
    }
    const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
    if (!contentType.startsWith("application/json")) {
      res.writeHead(415);
      res.end();
      return;
    }
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    const payload = await readJsonBody(req);
    if (payload === null) {
      writeJson(res, 200, fail2({ code: "invalid-request", message: "malformed request body" }));
      return;
    }
    try {
      switch (pathname) {
        case "/vcs/diagnostics":
          writeJson(res, 200, ok2(await deps.diagnostics()));
          return;
        case "/vcs/repos/list": {
          const workspacePath = optionalString(payload, "workspacePath", 4096) ?? null;
          const value = await deps.timeline.listRepositories(workspacePath);
          writeJson(res, 200, ok2(value));
          return;
        }
        case "/vcs/repos/add":
          writeJson(res, 200, ok2(await deps.timeline.addRepository(requiredString(payload, "path", 4096))));
          return;
        case "/vcs/repos/remove":
          writeJson(res, 200, ok2(await deps.timeline.removeRepository(requiredString(payload, "repositoryId", 1024))));
          return;
        case "/vcs/repository":
          writeJson(res, 200, ok2(await deps.timeline.repository(requiredString(payload, "repositoryId", 1024))));
          return;
        case "/vcs/timeline":
          writeJson(res, 200, ok2(await deps.timeline.timeline(timelineQuery(payload))));
          return;
        case "/vcs/changeset": {
          const revision = requiredString(payload, "revision", 128);
          writeJson(res, 200, ok2(await deps.timeline.changeSet(requiredString(payload, "repositoryId", 1024), revision)));
          return;
        }
        case "/vcs/diff": {
          const repositoryId2 = requiredString(payload, "repositoryId", 1024);
          const revisionA = optionalString(payload, "revisionA", 128);
          const revisionB = optionalString(payload, "revisionB", 128);
          const filePath = optionalString(payload, "filePath", 4096);
          const contextLines = payload.contextLines;
          const maxBytes = payload.maxBytes;
          writeJson(res, 200, ok2(await deps.timeline.diff({
            repositoryId: repositoryId2,
            ...revisionA === void 0 ? {} : { revisionA },
            ...revisionB === void 0 ? {} : { revisionB },
            ...filePath === void 0 ? {} : { filePath },
            ...typeof contextLines === "number" ? { contextLines } : {},
            ...typeof maxBytes === "number" ? { maxBytes } : {}
          })));
          return;
        }
        case "/vcs/status":
          writeJson(res, 200, ok2(await deps.timeline.status(requiredString(payload, "repositoryId", 1024))));
          return;
        case "/vcs/op/preview":
          writeJson(res, 200, ok2(await deps.operations.preview(operationRequest(payload))));
          return;
        case "/vcs/op/execute":
          writeJson(res, 200, ok2(await deps.operations.execute(operationRequest(payload))));
          return;
        case "/vcs/op/list":
          writeJson(res, 200, ok2(await deps.operations.listOperations(operationQuery(payload))));
          return;
        case "/vcs/op/get":
          writeJson(res, 200, ok2(await deps.operations.getOperation(requiredString(payload, "operationId", 128))));
          return;
        default:
          res.writeHead(404);
          res.end();
      }
    } catch (error) {
      if (error instanceof ServiceError) {
        writeJson(res, 200, fail2(error.toApiError()));
        return;
      }
      if (error instanceof StoreError) {
        writeJson(res, 200, fail2({ code: "storage-failure", message: "the plugin data store failed", detail: safeErrorMessage(error, 300) }));
        return;
      }
      log(`dsh-vcs-timeline: ${pathname} failed: ${safeErrorMessage(error)}`);
      writeJson(res, 200, fail2({ code: "internal", message: "unexpected host error" }));
    }
  };
  return ctx.webServer.register({ kind: "prefix", path: "/vcs", handler: handle });
}

// src/host/runner.ts
var DEFAULT_OUTPUT_CAP_BYTES = 1 << 20;
var DEFAULT_TIMEOUT_MS = 2e4;
function failureText(error) {
  if (error instanceof Error) return error.message.replace(/\s+/g, " ").slice(0, 300);
  return String(error).replace(/\s+/g, " ").slice(0, 300);
}
function createRunner(subprocess) {
  return {
    async run(argv, cwd, options = {}) {
      options.signal?.throwIfAborted();
      const maxBytes = options.maxBytes ?? DEFAULT_OUTPUT_CAP_BYTES;
      const deadlineMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const controller = new AbortController();
      const forwardAbort = () => controller.abort(options.signal?.reason);
      if (options.signal !== void 0) {
        if (options.signal.aborted) controller.abort(options.signal.reason);
        else options.signal.addEventListener("abort", forwardAbort, { once: true });
      }
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error("command deadline exceeded"));
      }, deadlineMs);
      let handle;
      try {
        handle = subprocess.spawn({
          argv,
          cwd,
          stdio: {
            stdin: "ignore",
            stdout: { maxBytes },
            stderr: { maxBytes }
          },
          graceMs: 5e3,
          signal: controller.signal
        });
      } catch (error) {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", forwardAbort);
        return {
          exitCode: null,
          stdout: "",
          stderr: "",
          spawnFailed: true,
          failureMessage: failureText(error)
        };
      }
      try {
        const outcome = await handle.done;
        const stdout = handle.collected.stdout?.readFrom(0).text ?? "";
        const stderr = handle.collected.stderr?.readFrom(0).text ?? "";
        return {
          exitCode: outcome.exitCode,
          stdout,
          stderr,
          ...timedOut ? { timedOut: true } : {}
        };
      } catch (error) {
        const stdout = handle.collected.stdout?.readFrom(0).text ?? "";
        const stderr = handle.collected.stderr?.readFrom(0).text ?? "";
        return {
          exitCode: null,
          stdout,
          stderr,
          ...timedOut ? { timedOut: true } : {},
          spawnFailed: false,
          failureMessage: failureText(error)
        };
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", forwardAbort);
      }
    },
    async resolveExecutable(command) {
      try {
        const resolved = await subprocess.resolveExecutable(command);
        return typeof resolved === "string" && resolved !== "" ? resolved : null;
      } catch {
        return null;
      }
    }
  };
}

// src/host/services/operation-service.ts
import { randomBytes as randomBytes2 } from "node:crypto";
var PREVIEW_TTL_MS = 12e4;
var MAX_PENDING_PREVIEWS = 32;
var NETWORK_OPERATION_TIMEOUT_MS = 18e4;
var LOCAL_OPERATION_TIMEOUT_MS = 6e4;
var OPERATION_OUTPUT_CAP = 2 * 1024 * 1024;
function paramsHash(params) {
  if (params === void 0) return "";
  const keys = Object.keys(params).sort();
  return JSON.stringify(keys.map((key) => [key, params[key]]));
}
function normalizeParams(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const params = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params[key] = value.slice(0, 4e3);
    else if (typeof value === "number" && Number.isFinite(value)) params[key] = value;
    else if (typeof value === "boolean") params[key] = value;
    else if (Array.isArray(value)) params[key] = value.filter((entry) => typeof entry === "string").slice(0, 500).join(",");
  }
  return params;
}
function outputSummary(stdout, stderr) {
  const text = `${stdout}
${stderr}`.trim();
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "").slice(0, 12).join("\n");
  return lines.slice(0, 2e3);
}
function looksMissingTool(message) {
  return /ENOENT|not found|not recognized|无法将|cannot find/i.test(message);
}
function eventTypeOf(operation) {
  switch (operation) {
    case "fetch":
      return "fetch";
    case "pull":
      return "pull";
    case "update":
      return "update";
    case "commit":
      return "commit";
    case "push":
      return "push";
    default:
      return "unknown";
  }
}
function eventOutcome(state) {
  switch (state) {
    case "succeeded":
      return "success";
    case "failed":
      return "failure";
    case "partial":
      return "partial";
    default:
      return "unknown";
  }
}
function createOperationService(deps) {
  const now = deps.now ?? (() => /* @__PURE__ */ new Date());
  const pending = /* @__PURE__ */ new Map();
  const inFlight = /* @__PURE__ */ new Set();
  const pruneExpired = () => {
    const current = now().getTime();
    for (const [token, value] of pending) {
      if (value.expiresAt <= current) pending.delete(token);
    }
    while (pending.size > MAX_PENDING_PREVIEWS) {
      const oldest = pending.keys().next();
      if (oldest.done === true) break;
      pending.delete(oldest.value);
    }
  };
  const appendEvent = async (attempt) => {
    const event = {
      schemaVersion: SCHEMA_VERSION,
      id: `evt-${randomBytes2(8).toString("hex")}`,
      repositoryId: attempt.repositoryId,
      vcsType: attempt.vcsType,
      eventType: eventTypeOf(attempt.operation),
      source: "plugin-audit",
      timestamp: attempt.finishedAt ?? attempt.startedAt,
      actor: "user-via-plugin",
      summary: `${attempt.operation} ${attempt.state}`,
      ...attempt.beforeRevision === void 0 ? {} : { beforeRevision: attempt.beforeRevision },
      ...attempt.afterRevision === void 0 ? {} : { afterRevision: attempt.afterRevision },
      operationAttemptId: attempt.id,
      outcome: eventOutcome(attempt.state),
      metadata: { exitCode: attempt.exitCode ?? null }
    };
    try {
      await deps.store.appendEvent(event);
    } catch (error) {
      deps.log?.(`dsh-vcs-timeline: audit event append failed: ${safeErrorMessage(error)}`);
    }
  };
  return {
    async preview(request) {
      if (typeof request !== "object" || request === null) fail("invalid-request", "request is required");
      if (!isWriteOperation(request.operation)) {
        fail("invalid-request", `operation ${String(request.operation)} is not a supported write operation`);
      }
      const operation = request.operation;
      const resolved = await deps.resolver.resolve(request.repositoryId);
      if (!resolved.ok) throw new ServiceError(resolved.error);
      const { repository, root, adapter } = resolved.value;
      const params = normalizeParams(request.params);
      const beforeResult = await adapter.beforeState(root, operation);
      if (!beforeResult.ok) throw new ServiceError(beforeResult.error);
      const before = beforeResult.value;
      const planResult = await adapter.planOperation(root, operation, params, before);
      if (!planResult.ok) throw new ServiceError(planResult.error);
      const plan = planResult.value;
      pruneExpired();
      if (!plan.allowed) {
        return {
          repositoryId: repository.id,
          operation,
          allowed: false,
          ...plan.blockedReason === void 0 ? {} : { blockedReason: plan.blockedReason },
          summary: plan.summary,
          argv: displayArgv(plan.argv),
          before,
          warnings: plan.warnings,
          confirmationToken: "",
          expiresAt: now().toISOString()
        };
      }
      const token = randomBytes2(24).toString("hex");
      const expiresAtMs = now().getTime() + PREVIEW_TTL_MS;
      pending.set(token, {
        repositoryId: repository.id,
        operation,
        paramsHash: paramsHash(params),
        argv: plan.argv,
        summary: plan.summary,
        network: plan.network,
        before,
        expiresAt: expiresAtMs
      });
      return {
        repositoryId: repository.id,
        operation,
        allowed: true,
        summary: plan.summary,
        argv: displayArgv(plan.argv),
        before,
        warnings: plan.warnings,
        confirmationToken: token,
        expiresAt: new Date(expiresAtMs).toISOString()
      };
    },
    async execute(request) {
      if (typeof request !== "object" || request === null) fail("invalid-request", "request is required");
      const token = typeof request.confirmationToken === "string" ? request.confirmationToken : "";
      if (token === "") fail("confirmation-required", "a preview and its confirmation token are required");
      pruneExpired();
      const preview = pending.get(token);
      if (preview === void 0) {
        fail("confirmation-invalid", "the confirmation token is unknown, used, or expired; preview again");
      }
      pending.delete(token);
      if (preview.expiresAt <= now().getTime()) {
        fail("confirmation-invalid", "the confirmation token expired; preview again");
      }
      if (!isWriteOperation(request.operation) || preview.operation !== request.operation) {
        fail("confirmation-invalid", "the confirmation token belongs to a different operation");
      }
      if (preview.repositoryId !== request.repositoryId) {
        fail("confirmation-invalid", "the confirmation token belongs to a different repository");
      }
      if (preview.paramsHash !== paramsHash(normalizeParams(request.params))) {
        fail("confirmation-invalid", "the operation parameters changed after preview; preview again");
      }
      if (inFlight.has(preview.repositoryId)) {
        fail("operation-blocked", "another operation is already running on this repository");
      }
      const resolved = await deps.resolver.resolve(request.repositoryId);
      if (!resolved.ok) throw new ServiceError(resolved.error);
      const { repository, root, adapter } = resolved.value;
      const beforeResult = await adapter.beforeState(root, preview.operation);
      if (!beforeResult.ok) throw new ServiceError(beforeResult.error);
      const before = beforeResult.value;
      const planResult = await adapter.planOperation(root, preview.operation, normalizeParams(request.params), before);
      if (!planResult.ok) throw new ServiceError(planResult.error);
      if (!planResult.value.allowed) {
        fail("operation-blocked", planResult.value.blockedReason ?? "operation is not allowed in the current state");
      }
      if (JSON.stringify(planResult.value.argv) !== JSON.stringify(preview.argv)) {
        fail("confirmation-invalid", "repository state changed after preview; preview again");
      }
      inFlight.add(repository.id);
      let attempt;
      try {
        attempt = await deps.audit.start({
          repositoryId: repository.id,
          vcsType: repository.vcsType,
          operation: preview.operation,
          requestSummary: preview.summary,
          before
        });
      } catch (error) {
        inFlight.delete(repository.id);
        throw new ServiceError({
          code: "storage-failure",
          message: "the operation was not started because its audit record could not be written",
          detail: safeErrorMessage(error)
        });
      }
      const timeoutMs = preview.network ? NETWORK_OPERATION_TIMEOUT_MS : LOCAL_OPERATION_TIMEOUT_MS;
      const result = await deps.runner.run(planResult.value.argv, root, { timeoutMs, maxBytes: OPERATION_OUTPUT_CAP });
      let after = before;
      try {
        const afterResult = await adapter.beforeState(root, preview.operation);
        if (afterResult.ok) after = afterResult.value;
      } catch {
      }
      let state;
      let remoteOutcome;
      let errorCode2;
      if (result.spawnFailed === true) {
        state = "failed";
        errorCode2 = looksMissingTool(result.failureMessage ?? "") ? "vcs-not-installed" : "operation-failed";
      } else if (result.exitCode === 0) {
        state = "succeeded";
        if (preview.network) remoteOutcome = "confirmed-success";
      } else if (result.timedOut === true || result.exitCode === null) {
        state = preview.network ? "unknown" : "failed";
        errorCode2 = "timeout";
        if (preview.network) remoteOutcome = "unknown";
      } else {
        state = "failed";
        errorCode2 = "operation-failed";
        if (preview.network) remoteOutcome = "confirmed-failure";
      }
      const summaryText = outputSummary(result.stdout, result.stderr);
      const failedText = result.exitCode === 0 ? void 0 : safeErrorMessage(result.failureMessage ?? result.stderr ?? "the command failed", 500);
      try {
        const finished = await deps.audit.finish(attempt, {
          state,
          exitCode: result.exitCode,
          ...errorCode2 === void 0 ? {} : { errorCode: errorCode2 },
          ...failedText === void 0 ? {} : { safeErrorMessage: failedText },
          ...summaryText === "" ? {} : { outputSummary: summaryText },
          after,
          ...before.stagedFiles === void 0 ? {} : { changedPaths: before.stagedFiles },
          ...remoteOutcome === void 0 ? {} : { remoteOutcome }
        });
        attempt = finished;
      } catch (error) {
        deps.log?.(`dsh-vcs-timeline: audit finish failed: ${safeErrorMessage(error)}`);
      } finally {
        inFlight.delete(repository.id);
      }
      await appendEvent(attempt);
      return attempt;
    },
    async listOperations(query) {
      return deps.store.queryOperations(query ?? {});
    },
    async getOperation(id) {
      if (typeof id !== "string" || id === "") fail("invalid-request", "operationId is required");
      const attempt = await deps.store.getOperation(id);
      if (attempt === void 0) fail("invalid-request", "unknown operation id");
      return attempt;
    }
  };
}

// src/host/storage/jsonl.ts
import { appendFile, mkdir, open, rename, stat as stat3 } from "node:fs/promises";
import { join as join3, resolve as resolve3 } from "node:path";
var DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024;
var DEFAULT_MAX_SCAN_RECORDS = 2e5;
var READ_CHUNK_BYTES = 64 * 1024;
var MAX_LINE_BYTES = 8 * 1024 * 1024;
var REQUEST_SUMMARY_MAX2 = 500;
var OUTPUT_SUMMARY_MAX2 = 2e3;
var SAFE_ERROR_MAX2 = 500;
var FILE_NAMES = {
  repositories: "repositories.jsonl",
  events: "events.jsonl",
  changesets: "changesets.jsonl",
  operations: "operations.jsonl"
};
var TIME_FIELDS = {
  repositories: "lastSeenAt",
  events: "timestamp",
  changesets: "createdAt",
  operations: "startedAt"
};
var indexCache = /* @__PURE__ */ new Map();
var verifiedEnds = /* @__PURE__ */ new Map();
function timeNeedle(field) {
  return Buffer.from(`"${field}"`, "latin1");
}
function extractTime(line, needle, pattern) {
  const at = line.indexOf(needle);
  if (at === -1) return null;
  const end = Math.min(line.length, at + needle.length + 80);
  const match = pattern.exec(line.subarray(at, end).toString("latin1"));
  return match?.[1] ?? null;
}
function errorCode(error) {
  if (typeof error !== "object" || error === null) return void 0;
  const code = error.code;
  return typeof code === "string" ? code : void 0;
}
function toStoreError(action, error) {
  if (error instanceof Error && error instanceof StoreError) return error;
  const code = errorCode(error);
  const message = error instanceof Error ? error.message : String(error);
  const detail = redactText(message).replace(/'[^']*'/g, "'\u2026'").replace(/\s+/g, " ").trim();
  const suffix = code === void 0 ? "" : ` (${code})`;
  return new StoreError(`jsonl store: ${action} failed${suffix}: ${detail.slice(0, 200)}`, "storage-failure");
}
function boundedText2(raw, max) {
  const redacted = redactText(raw);
  return redacted.length > max ? `${redacted.slice(0, max - 1)}\u2026` : redacted;
}
function parseStoredLine(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: "unreadable" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { kind: "unreadable" };
  const record = value;
  if (record.schemaVersion !== SCHEMA_VERSION) return { kind: "unsupported" };
  return { kind: "record", value: record };
}
function isVcsEvent(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return record.schemaVersion === SCHEMA_VERSION && typeof record.id === "string" && typeof record.repositoryId === "string" && typeof record.eventType === "string" && typeof record.timestamp === "string" && typeof record.summary === "string";
}
function appendSkipWarning(warnings, fileName, stats) {
  const parts = [];
  if (stats.unreadable > 0) parts.push(`${stats.unreadable} unreadable`);
  if (stats.unsupported > 0) parts.push(`${stats.unsupported} incompatible-schema`);
  if (parts.length > 0) warnings.push(`skipped ${parts.join(" / ")} record(s) in ${fileName}`);
  if (stats.capped) warnings.push(`stopped scanning ${fileName} after the scan cap; results may be incomplete`);
}
function readCursorOffset(cursor, warnings) {
  if (cursor === null || cursor === void 0) return 0;
  const decoded = decodeCursor(cursor);
  if (decoded === null) {
    warnings.push("ignored a malformed pagination cursor");
    return 0;
  }
  const raw = decoded["o"];
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    warnings.push("ignored a malformed pagination cursor");
    return 0;
  }
  return raw;
}
function toMillis(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
function filterText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.toLowerCase();
}
function buildEventFilter(query, repositoryId2) {
  const requestedTypes = Array.isArray(query.eventTypes) ? query.eventTypes : [];
  const requested = requestedTypes.filter((value) => typeof value === "string" && value !== "");
  return {
    repositoryId: repositoryId2,
    eventTypes: requested.length > 0 ? new Set(requested) : null,
    author: filterText(query.author),
    text: filterText(query.text),
    sinceMs: toMillis(query.since),
    untilMs: toMillis(query.until)
  };
}
function matchesEventFilter(event, filter) {
  if (event.repositoryId !== filter.repositoryId) return false;
  if (filter.eventTypes !== null && !filter.eventTypes.has(event.eventType)) return false;
  if (filter.author !== null) {
    const actor = typeof event.actor === "string" ? event.actor.toLowerCase() : "";
    if (!actor.includes(filter.author)) return false;
  }
  if (filter.text !== null) {
    const summary = typeof event.summary === "string" ? event.summary.toLowerCase() : "";
    if (!summary.includes(filter.text)) return false;
  }
  if (filter.sinceMs !== null || filter.untilMs !== null) {
    const stamp = typeof event.timestamp === "string" ? Date.parse(event.timestamp) : Number.NaN;
    if (Number.isNaN(stamp)) return false;
    if (filter.sinceMs !== null && stamp < filter.sinceMs) return false;
    if (filter.untilMs !== null && stamp > filter.untilMs) return false;
  }
  return true;
}
function foldRepositories(records) {
  const byId = /* @__PURE__ */ new Map();
  records.forEach((record, order) => {
    const existing = byId.get(record.id);
    if (existing === void 0) {
      byId.set(record.id, { record, order });
      return;
    }
    const existingAt = toMillis(existing.record.lastSeenAt);
    const recordAt = toMillis(record.lastSeenAt);
    if (recordAt !== null && existingAt !== null && recordAt < existingAt) return;
    byId.set(record.id, { record, order });
  });
  const folded = [...byId.values()];
  folded.sort((left, right) => {
    const leftAt = toMillis(left.record.lastSeenAt);
    const rightAt = toMillis(right.record.lastSeenAt);
    const leftValue = leftAt === null ? Number.NEGATIVE_INFINITY : leftAt;
    const rightValue = rightAt === null ? Number.NEGATIVE_INFINITY : rightAt;
    if (leftValue !== rightValue) return rightValue - leftValue;
    return right.order - left.order;
  });
  return folded.map((entry) => entry.record);
}
function foldOperations(records) {
  const byId = /* @__PURE__ */ new Map();
  records.forEach((record, order) => {
    const existing = byId.get(record.id);
    if (existing === void 0) {
      byId.set(record.id, { attempt: record, order });
      return;
    }
    byId.set(record.id, { attempt: { ...record, startedAt: existing.attempt.startedAt }, order });
  });
  const folded = [...byId.values()];
  folded.sort((left, right) => {
    const leftAt = toMillis(left.attempt.startedAt);
    const rightAt = toMillis(right.attempt.startedAt);
    const leftValue = leftAt === null ? Number.NEGATIVE_INFINITY : leftAt;
    const rightValue = rightAt === null ? Number.NEGATIVE_INFINITY : rightAt;
    if (leftValue !== rightValue) return rightValue - leftValue;
    return right.order - left.order;
  });
  return folded;
}
function prepareOperationRecord(record) {
  const output = { ...record, schemaVersion: SCHEMA_VERSION };
  output.requestSummary = boundedText2(typeof record.requestSummary === "string" ? record.requestSummary : "", REQUEST_SUMMARY_MAX2);
  if (typeof record.outputSummary === "string") {
    output.outputSummary = boundedText2(record.outputSummary, OUTPUT_SUMMARY_MAX2);
  }
  if (typeof record.safeErrorMessage === "string") {
    output.safeErrorMessage = boundedText2(record.safeErrorMessage, SAFE_ERROR_MAX2);
  }
  return output;
}
function createJsonlStore(options) {
  const rawDir = typeof options === "object" && options !== null && typeof options.dir === "string" ? options.dir.trim() : "";
  if (rawDir === "") throw new StoreError("jsonl store: options.dir is required", "storage-failure");
  const dir = resolve3(rawDir);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  if (typeof maxFileBytes !== "number" || !Number.isFinite(maxFileBytes) || maxFileBytes <= 0) {
    throw new StoreError("jsonl store: options.maxFileBytes must be a positive number", "storage-failure");
  }
  const maxScanRecords = options.maxScanRecords ?? DEFAULT_MAX_SCAN_RECORDS;
  if (typeof maxScanRecords !== "number" || !Number.isInteger(maxScanRecords) || maxScanRecords < 1) {
    throw new StoreError("jsonl store: options.maxScanRecords must be a positive integer", "storage-failure");
  }
  const chains = /* @__PURE__ */ new Map();
  let initPromise;
  const pathOf = (key) => join3(dir, FILE_NAMES[key]);
  const rotatedPathOf = (key) => join3(dir, FILE_NAMES[key].replace(/\.jsonl$/, ".1.jsonl"));
  const ensureInit = () => {
    if (initPromise !== void 0) return initPromise;
    initPromise = mkdir(dir, { recursive: true }).then(
      () => void 0,
      (error) => {
        initPromise = void 0;
        throw toStoreError("create store directory", error);
      }
    );
    return initPromise;
  };
  const enqueue = (file, task) => {
    const previous = chains.get(file) ?? Promise.resolve();
    const next = previous.then(task, task);
    chains.set(file, next.then(() => void 0, () => void 0));
    return next;
  };
  const emptyIndex = () => ({ size: 0, mtimeMs: 0, entries: [], order: [] });
  const buildIndex = async (key, file) => {
    let handle;
    try {
      handle = await open(file, "r");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return emptyIndex();
      throw toStoreError(`read ${FILE_NAMES[key]}`, error);
    }
    try {
      const info = await handle.stat();
      const needle = timeNeedle(TIME_FIELDS[key]);
      const pattern = new RegExp(`"${TIME_FIELDS[key]}"\\s*:\\s*"([^"]*)"`);
      const entries = [];
      const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      let position = 0;
      let lineStart = 0;
      let carry = null;
      for (; ; ) {
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
        if (bytesRead === 0) break;
        const view = chunk.subarray(0, bytesRead);
        let cursor = 0;
        for (; ; ) {
          const newlineAt = view.indexOf(10, cursor);
          if (newlineAt === -1) {
            if (cursor < view.length) {
              const rest = Buffer.from(view.subarray(cursor));
              carry = carry === null ? rest : Buffer.concat([carry, rest]);
            }
            break;
          }
          const segment = view.subarray(cursor, newlineAt);
          const lineBytes = carry === null ? segment : Buffer.concat([carry, segment]);
          carry = null;
          const lineEnd = position + newlineAt;
          entries.push({ offset: lineStart, length: lineEnd - lineStart, time: extractTime(lineBytes, needle, pattern) });
          lineStart = lineEnd + 1;
          cursor = newlineAt + 1;
        }
        position += bytesRead;
      }
      if (carry !== null && carry.length > 0) {
        entries.push({ offset: lineStart, length: carry.length, time: extractTime(carry, needle, pattern) });
      }
      const order = entries.map((_, index) => index);
      order.sort((left, right) => {
        const leftTime = entries[left]?.time ?? "";
        const rightTime = entries[right]?.time ?? "";
        if (leftTime !== rightTime) return leftTime < rightTime ? 1 : -1;
        return right - left;
      });
      return { size: info.size, mtimeMs: info.mtimeMs, entries, order };
    } catch (error) {
      throw toStoreError(`read ${FILE_NAMES[key]}`, error);
    } finally {
      await handle.close();
    }
  };
  const getIndex = async (key) => {
    const file = pathOf(key);
    let info;
    try {
      info = await stat3(file);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return emptyIndex();
      throw toStoreError(`stat ${FILE_NAMES[key]}`, error);
    }
    const cached = indexCache.get(file);
    if (cached !== void 0 && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached;
    const built = await buildIndex(key, file);
    indexCache.set(file, built);
    return built;
  };
  const openForRead = async (file) => {
    try {
      return await open(file, "r");
    } catch (error) {
      if (errorCode(error) === "ENOENT") return null;
      throw toStoreError("read store file", error);
    }
  };
  const readLine = async (handle, entry) => {
    const buffer = Buffer.allocUnsafe(entry.length);
    let filled = 0;
    while (filled < entry.length) {
      const { bytesRead } = await handle.read(buffer, filled, entry.length - filled, entry.offset + filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    if (filled === 0) return null;
    return buffer.subarray(0, filled).toString("utf8");
  };
  const readAllRecords = async (key, guard) => {
    const file = pathOf(key);
    const index = await getIndex(key);
    const stats = { unreadable: 0, unsupported: 0, capped: false };
    const records = [];
    const warnings = [];
    if (index.entries.length > 0) {
      const handle = await openForRead(file);
      if (handle !== null) {
        try {
          let scanned = 0;
          for (const entry of index.entries) {
            if (entry.length === 0) continue;
            if (entry.length > MAX_LINE_BYTES) {
              stats.unreadable += 1;
              continue;
            }
            scanned += 1;
            if (scanned > maxScanRecords) {
              stats.capped = true;
              break;
            }
            const text = await readLine(handle, entry);
            if (text === null) break;
            const parsed = parseStoredLine(text);
            if (parsed.kind === "unreadable") {
              stats.unreadable += 1;
              continue;
            }
            if (parsed.kind === "unsupported") {
              stats.unsupported += 1;
              continue;
            }
            if (!guard(parsed.value)) {
              stats.unreadable += 1;
              continue;
            }
            records.push(parsed.value);
          }
        } finally {
          await handle.close();
        }
      }
    }
    appendSkipWarning(warnings, FILE_NAMES[key], stats);
    return { records, warnings };
  };
  const endsWithNewline = async (file, size) => {
    if (verifiedEnds.get(file) === size) return true;
    try {
      const handle = await open(file, "r");
      try {
        const byte = Buffer.allocUnsafe(1);
        const { bytesRead } = await handle.read(byte, 0, 1, size - 1);
        return bytesRead === 1 && byte[0] === 10;
      } finally {
        await handle.close();
      }
    } catch {
      return true;
    }
  };
  const prepareAppend = async (key) => {
    const file = pathOf(key);
    let size = 0;
    try {
      const info = await stat3(file);
      size = info.size;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") return 0;
      verifiedEnds.delete(file);
      indexCache.delete(file);
      return 0;
    }
    if (size <= maxFileBytes) return size;
    try {
      await rename(file, rotatedPathOf(key));
    } catch {
      return size;
    }
    verifiedEnds.delete(file);
    indexCache.delete(file);
    return 0;
  };
  const writeRecord = (key, build) => {
    const file = pathOf(key);
    return enqueue(file, async () => {
      await ensureInit();
      let line;
      try {
        line = `${JSON.stringify({ ...build(), schemaVersion: SCHEMA_VERSION })}
`;
      } catch (error) {
        throw toStoreError(`serialize ${FILE_NAMES[key]}`, error);
      }
      const size = await prepareAppend(key);
      const needsSeparator = size > 0 && !await endsWithNewline(file, size);
      const lineBuffer = Buffer.from(line, "utf8");
      const payload = needsSeparator ? Buffer.concat([Buffer.from("\n", "utf8"), lineBuffer]) : lineBuffer;
      try {
        await appendFile(file, payload, { flag: "a" });
      } catch (error) {
        indexCache.delete(file);
        throw toStoreError(`append ${FILE_NAMES[key]}`, error);
      }
      verifiedEnds.set(file, size + payload.length);
      indexCache.delete(file);
    });
  };
  const store = {
    location() {
      return dir;
    },
    async init() {
      await ensureInit();
    },
    appendRepository(record) {
      return writeRecord("repositories", () => ({ ...record }));
    },
    appendEvent(record) {
      return writeRecord("events", () => ({ ...record }));
    },
    appendChangeSet(record) {
      return writeRecord("changesets", () => ({ ...record }));
    },
    appendOperation(record) {
      if (typeof record !== "object" || record === null) {
        return Promise.reject(new StoreError("jsonl store: operation record must be an object", "invalid-request"));
      }
      return writeRecord("operations", () => prepareOperationRecord(record));
    },
    async listRepositories() {
      const read = await readAllRecords("repositories", isRepository);
      return foldRepositories(read.records);
    },
    async getRepository(id) {
      const wanted = typeof id === "string" ? id.trim() : "";
      if (wanted === "") return void 0;
      const read = await readAllRecords("repositories", isRepository);
      return foldRepositories(read.records).find((record) => record.id === wanted);
    },
    async queryEvents(query) {
      const warnings = [];
      const repositoryId2 = typeof query?.repositoryId === "string" ? query.repositoryId.trim() : "";
      if (repositoryId2 === "") {
        return { events: [], nextCursor: null, hasMore: false, warnings: ["queryEvents requires a repositoryId"] };
      }
      const limit = clampInt(query.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
      const offset = readCursorOffset(query.cursor, warnings);
      const filter = buildEventFilter(query, repositoryId2);
      const index = await getIndex("events");
      const stats = { unreadable: 0, unsupported: 0, capped: false };
      const events = [];
      if (index.order.length > 0) {
        const handle = await openForRead(pathOf("events"));
        if (handle !== null) {
          try {
            let remainingSkip = offset;
            let hasMore = false;
            let scanned = 0;
            for (const entryIndex of index.order) {
              const entry = index.entries[entryIndex];
              if (entry === void 0 || entry.length === 0) continue;
              if (entry.length > MAX_LINE_BYTES) {
                stats.unreadable += 1;
                continue;
              }
              scanned += 1;
              if (scanned > maxScanRecords) {
                stats.capped = true;
                break;
              }
              const text = await readLine(handle, entry);
              if (text === null) break;
              const parsed = parseStoredLine(text);
              if (parsed.kind === "unreadable") {
                stats.unreadable += 1;
                continue;
              }
              if (parsed.kind === "unsupported") {
                stats.unsupported += 1;
                continue;
              }
              if (!isVcsEvent(parsed.value)) {
                stats.unreadable += 1;
                continue;
              }
              const event = parsed.value;
              if (!matchesEventFilter(event, filter)) continue;
              if (remainingSkip > 0) {
                remainingSkip -= 1;
                continue;
              }
              if (events.length < limit) {
                events.push(event);
                continue;
              }
              hasMore = true;
              break;
            }
            appendSkipWarning(warnings, FILE_NAMES.events, stats);
            return {
              events,
              nextCursor: hasMore ? encodeCursor({ o: offset + events.length }) : null,
              hasMore,
              warnings
            };
          } finally {
            await handle.close();
          }
        }
      }
      appendSkipWarning(warnings, FILE_NAMES.events, stats);
      return { events, nextCursor: null, hasMore: false, warnings };
    },
    async queryOperations(query) {
      const warnings = [];
      const limit = clampInt(query?.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
      const offset = readCursorOffset(query?.cursor, warnings);
      const repositoryId2 = typeof query?.repositoryId === "string" ? query.repositoryId.trim() : "";
      const read = await readAllRecords("operations", isOperationAttempt);
      warnings.push(...read.warnings);
      const folded = foldOperations(read.records);
      const filtered = repositoryId2 === "" ? folded : folded.filter((entry) => entry.attempt.repositoryId === repositoryId2);
      const page = filtered.slice(offset, offset + limit);
      const hasMore = offset + page.length < filtered.length;
      return {
        operations: page.map((entry) => entry.attempt),
        nextCursor: hasMore ? encodeCursor({ o: offset + page.length }) : null,
        hasMore,
        warnings
      };
    },
    async getOperation(id) {
      const wanted = typeof id === "string" ? id.trim() : "";
      if (wanted === "") return void 0;
      const read = await readAllRecords("operations", isOperationAttempt);
      return foldOperations(read.records).find((entry) => entry.attempt.id === wanted)?.attempt;
    },
    async close() {
      const pending = [...chains.values()];
      await Promise.allSettled(pending);
      chains.clear();
      verifiedEnds.clear();
    },
    async migrate(context) {
      if (typeof context !== "object" || context === null) {
        throw new StoreError("jsonl store: migrate requires a migration context", "invalid-request");
      }
      if (context.toVersion !== SCHEMA_VERSION) {
        throw new StoreError(`jsonl store: no migration path to schema version ${String(context.toVersion)}`, "storage-failure");
      }
      await ensureInit();
    }
  };
  return store;
}

// src/host/index.ts
var inject = ["webServer", "subprocess", "workspaceRegistry"];
function apply(ctx, config) {
  const dataDir = resolveDataDir(typeof config?.dataDir === "string" ? config.dataDir : void 0);
  const store = createJsonlStore({ dir: dataDir });
  const runner = createRunner(ctx.subprocess);
  const adapters = {
    git: createGitAdapter(runner),
    svn: createSvnAdapter(runner)
  };
  const workspaces = () => ctx.workspaceRegistry.list().map((workspace) => ({
    id: String(workspace.id),
    path: workspace.path
  }));
  const log = (message) => ctx.logger.warn(message);
  const registry = createRepositoryRegistry({ workspaces, adapters, store, log });
  const resolver = createRepositoryResolver(registry, adapters);
  const audit = createAuditService(store);
  const diagnostics = createDiagnosticsProvider({
    runner,
    workspaces,
    pluginVersion: "0.1.0",
    dataDir
  });
  const timeline = createTimelineService({ resolver, registry, store, diagnostics });
  const operations = createOperationService({ resolver, runner, store, audit, log });
  ctx.effect(() => {
    const disposeRoutes = registerVcsRoutes(ctx, { timeline, operations, diagnostics, log });
    return () => {
      disposeRoutes();
      void store.close();
    };
  }, "dsh-vcs-timeline: /vcs routes and services");
}
export {
  apply,
  inject
};
