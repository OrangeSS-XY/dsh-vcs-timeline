/**
 * VCS client discovery and user configuration.
 *
 * The plugin runs two external clients (`git` and `svn`) through the managed
 * subprocess service. A client is resolved once, at plugin mount, through a
 * documented chain:
 *
 *  1. `<dataDir>/vcs-config.json` — an explicit absolute path the user pinned;
 *  2. the Host subprocess service's PATH resolution;
 *  3. a small list of well-known Windows install locations.
 *
 * Config wins over PATH, and PATH wins over probing. An invalid config entry is
 * never fatal: it becomes a diagnostics warning and resolution falls through,
 * so a typo in the file can only cost the user the shortcut, not the feature.
 * @module dsh-vcs-timeline/host/toolchain
 */

import { constants } from 'node:fs'
import { access, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

/** Optional configuration file name inside the plugin data directory. */
export const VCS_CONFIG_FILE_NAME = 'vcs-config.json'

/** Largest configuration file this module reads. */
export const MAX_VCS_CONFIG_BYTES = 16 * 1024

/** The two VCS clients this plugin runs. */
export type VcsTool = 'git' | 'svn'

/** Resolved absolute client paths; `null` when the client is not installed. */
export interface ToolPaths {
  git: string | null
  svn: string | null
}

/** Where a resolved client came from. */
export type ToolSource = 'config' | 'path' | 'probe' | 'missing'

/** User-provided executable overrides from `vcs-config.json`. */
export interface VcsConfigPaths {
  gitPath?: string
  svnPath?: string
}

/** One parsed configuration file and the warnings its entries produced. */
export interface ParsedVcsConfig {
  paths: VcsConfigPaths
  warnings: string[]
}

/** One resolved client and how it was found. */
export interface ToolResolution {
  paths: ToolPaths
  sources: Record<VcsTool, ToolSource>
  warnings: string[]
}

/** Dependencies of {@link resolveToolPaths}. */
export interface ToolResolutionDeps {
  /** Plugin data directory; holds `vcs-config.json`. */
  dataDir: string
  /** Resolve one bare command name on PATH; `null` when it is missing. */
  resolveOnPath: (tool: VcsTool) => Promise<string | null>
  /** Read the config file text; `null` when it is absent or unreadable. */
  readConfigText?: () => Promise<string | null>
  /** Whether one absolute path is a runnable file. */
  isRunnableFile?: (path: string) => Promise<boolean>
  /** Environment used for the probe locations; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Platform used for the probe locations; defaults to `process.platform`. */
  platform?: NodeJS.Platform
}

/** Resolved clients plus their lazily-started resolution. */
export interface Toolchain {
  /** Resolve once (idempotent) and return the full result. */
  resolve(): Promise<ToolResolution>
  /** Resolve once and return just the paths. */
  paths(): Promise<ToolPaths>
}

/** The empty result: neither client is available. */
function emptyToolPaths(): ToolPaths {
  return { git: null, svn: null }
}

/** Read one environment variable, tolerating Windows' key casing. */
function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const direct = env[key]
  if (typeof direct === 'string' && direct.trim() !== '') return direct.trim()
  for (const [candidate, value] of Object.entries(env)) {
    if (candidate.toLowerCase() === key.toLowerCase() && typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/** The diagnostic sentence naming a missing client and how to fix it. */
function missingWarning(tool: VcsTool, configPath: string): string {
  if (tool === 'git') {
    return `git client not found (install Git for Windows, add its cmd directory to PATH, or set gitPath in ${configPath})`
  }
  return `svn client not found (install TortoiseSVN with command line tools, SlikSVN, or set svnPath in ${configPath})`
}

/** The config key that overrides one tool. */
function configKeyFor(tool: VcsTool): 'gitPath' | 'svnPath' {
  return tool === 'git' ? 'gitPath' : 'svnPath'
}

/**
 * Read one optional config entry: a non-empty absolute path, or a warning.
 *
 * Type and shape are validated here; existence is checked by the caller, which
 * owns the filesystem seam.
 */
function configEntry(
  record: Record<string, unknown>,
  key: 'gitPath' | 'svnPath',
  configPath: string,
  warnings: string[],
): string | undefined {
  const value = record[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    warnings.push(`${configPath}: "${key}" must be a non-empty string; the entry is ignored`)
    return undefined
  }
  const path = value.trim()
  if (!isAbsolute(path)) {
    warnings.push(`${configPath}: "${key}" must be an absolute path; the entry is ignored`)
    return undefined
  }
  return path
}

/**
 * Parse `vcs-config.json` text into paths plus warnings.
 *
 * A missing file (`null` text) is the normal case and produces no warning. A
 * malformed file, a non-object root, or an entry of the wrong shape produces a
 * warning naming the exact problem and is ignored, never thrown.
 * @param text - file content, or null when the file does not exist.
 * @param configPath - absolute path shown in the warnings.
 * @returns the parsed paths and any warnings.
 */
export function parseVcsConfig(text: string | null, configPath = VCS_CONFIG_FILE_NAME): ParsedVcsConfig {
  const warnings: string[] = []
  if (text === null) return { paths: {}, warnings }
  const trimmed = text.trim()
  if (trimmed === '') return { paths: {}, warnings }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    warnings.push(`${configPath} is not valid JSON; the file is ignored`)
    return { paths: {}, warnings }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    warnings.push(`${configPath} must contain a JSON object; the file is ignored`)
    return { paths: {}, warnings }
  }
  const record = parsed as Record<string, unknown>
  const paths: VcsConfigPaths = {}
  const gitPath = configEntry(record, 'gitPath', configPath, warnings)
  if (gitPath !== undefined) paths.gitPath = gitPath
  const svnPath = configEntry(record, 'svnPath', configPath, warnings)
  if (svnPath !== undefined) paths.svnPath = svnPath
  return { paths, warnings }
}

/**
 * The Windows install locations probed when a client is not on PATH.
 *
 * Only absolute, spawnable paths are listed: on Windows the Host spawns without
 * a shell, so a `.cmd`/`.bat` shim can never be used and is not offered.
 * @param tool - which client to locate.
 * @param env - environment providing the standard Windows variables.
 * @param platform - platform gate; non-Windows machines probe nothing.
 * @returns candidate absolute paths, most common first.
 */
export function probePaths(
  tool: VcsTool,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== 'win32') return []
  const programFiles = envValue(env, 'ProgramFiles') ?? 'C:\\Program Files'
  const programFilesX86 = envValue(env, 'ProgramFiles(x86)') ?? 'C:\\Program Files (x86)'
  if (tool === 'git') {
    return [
      join(programFiles, 'Git', 'cmd', 'git.exe'),
      join(programFilesX86, 'Git', 'cmd', 'git.exe'),
    ]
  }
  const localAppData = envValue(env, 'LOCALAPPDATA')
  return [
    join(programFiles, 'TortoiseSVN', 'bin', 'svn.exe'),
    join(programFilesX86, 'TortoiseSVN', 'bin', 'svn.exe'),
    join(programFiles, 'SlikSvn', 'bin', 'svn.exe'),
    join(programFilesX86, 'SlikSvn', 'bin', 'svn.exe'),
    join(programFiles, 'VisualSVN Server', 'bin', 'svn.exe'),
    ...(localAppData === undefined ? [] : [join(localAppData, 'Programs', 'TortoiseSVN', 'bin', 'svn.exe')]),
  ]
}

/**
 * Whether one path names a program this Host can spawn without a shell.
 *
 * Windows requires an executable image (`.exe`/`.com`); a batch shim would need
 * a shell, which this plugin never uses. POSIX checks the execute bit.
 * @param path - absolute candidate path.
 * @param platform - platform whose rules apply.
 * @returns true when the path may be spawned directly.
 */
export async function isRunnableFile(path: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return false
  } catch {
    return false
  }
  if (platform === 'win32') return /\.(exe|com)$/i.test(path)
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Read `<dataDir>/vcs-config.json`, bounded; null when absent. */
async function readConfigFile(configPath: string): Promise<string | null> {
  try {
    const text = await readFile(configPath, 'utf8')
    return text.length > MAX_VCS_CONFIG_BYTES ? text.slice(0, MAX_VCS_CONFIG_BYTES) : text
  } catch {
    return null
  }
}

/**
 * Resolve both VCS clients through the documented chain.
 *
 * Never throws: every failure (missing file, malformed JSON, a broken or absent
 * client) becomes a warning naming the exact situation.
 * @param deps - data directory and the filesystem/PATH seams.
 * @returns the resolved paths, their sources, and warnings.
 */
export async function resolveToolPaths(deps: ToolResolutionDeps): Promise<ToolResolution> {
  const warnings: string[] = []
  const configPath = join(deps.dataDir, VCS_CONFIG_FILE_NAME)
  const env = deps.env ?? process.env
  const platform = deps.platform ?? process.platform
  const isRunnable = deps.isRunnableFile ?? ((path: string) => isRunnableFile(path, platform))
  const readConfig = deps.readConfigText ?? (() => readConfigFile(configPath))

  let configText: string | null = null
  try {
    configText = await readConfig()
  } catch {
    configText = null
  }
  const parsed = parseVcsConfig(configText, configPath)
  warnings.push(...parsed.warnings)

  const resolveOne = async (tool: VcsTool): Promise<{ path: string | null; source: ToolSource }> => {
    const key = configKeyFor(tool)
    const overridden = tool === 'git' ? parsed.paths.gitPath : parsed.paths.svnPath
    if (overridden !== undefined) {
      if (await isRunnable(overridden)) return { path: overridden, source: 'config' }
      warnings.push(`${configPath}: "${key}" does not point at an executable file (${overridden}); the entry is ignored`)
    }

    let onPath: string | null = null
    try {
      onPath = await deps.resolveOnPath(tool)
    } catch {
      onPath = null
    }
    if (typeof onPath === 'string' && onPath.trim() !== '') return { path: onPath.trim(), source: 'path' }

    for (const candidate of probePaths(tool, env, platform)) {
      if (await isRunnable(candidate)) {
        warnings.push(`${tool} client was not found on PATH; using ${candidate} (set ${key} in ${configPath} to pin it)`)
        return { path: candidate, source: 'probe' }
      }
    }

    warnings.push(missingWarning(tool, configPath))
    return { path: null, source: 'missing' }
  }

  const [git, svn] = await Promise.all([resolveOne('git'), resolveOne('svn')])
  return {
    paths: { git: git.path, svn: svn.path },
    sources: { git: git.source, svn: svn.source },
    warnings,
  }
}

/**
 * Create the mount-time toolchain handle.
 *
 * Resolution starts immediately (the plugin mount does not await it), and the
 * runner awaits {@link Toolchain.paths} on its first command. A resolution
 * failure can only degrade to "no clients", never break a command.
 * @param deps - data directory and the filesystem/PATH seams.
 * @returns the toolchain handle.
 */
export function createToolchain(deps: ToolResolutionDeps): Toolchain {
  let pending: Promise<ToolResolution> | undefined

  const start = (): Promise<ToolResolution> => {
    pending ??= resolveToolPaths(deps)
      .catch(() => ({
        paths: emptyToolPaths(),
        sources: { git: 'missing' as const, svn: 'missing' as const },
        warnings: ['VCS client discovery failed; git and svn are unavailable'],
      }))
    return pending
  }

  // Kick off at mount: the resolution is one small file read plus two PATH
  // lookups, and starting it now means the first command never waits for it.
  void start()

  return {
    resolve: start,
    async paths() {
      return (await start()).paths
    },
  }
}
