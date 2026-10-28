/**
 * Environment diagnostics reported in the panel footer: plugin/runtime
 * versions, VCS client availability, workspace count, and the data directory.
 * @module dsh-vcs-timeline/host/diagnostics
 */

import { readFile } from 'node:fs/promises'
import type { Diagnostics } from '../shared/contracts.ts'
import type { Runner } from './adapters/types.ts'
import type { WorkspaceInfo } from './discovery.ts'
import type { ToolPaths } from './toolchain.ts'

/** Dependencies of the diagnostics provider. */
export interface DiagnosticsDeps {
  runner: Runner
  workspaces: () => WorkspaceInfo[]
  pluginVersion: string
  dataDir: string
  /**
   * Warnings from the mount-time client resolution.
   *
   * When absent, the provider falls back to the older generic messages so the
   * module stays usable without a toolchain.
   */
  toolWarnings?: () => string[] | Promise<string[]>
  /** Resolved client paths, used to explain a client that cannot answer. */
  toolPaths?: () => ToolPaths | Promise<ToolPaths>
}

/** How long one probe result is reused. */
const CACHE_TTL_MS = 30_000

/** Read a version string from `<tool> --version`, or null. */
async function toolVersion(runner: Runner, tool: 'git' | 'svn'): Promise<string | null> {
  const executable = await runner.resolveExecutable(tool)
  if (executable === null) return null
  const result = await runner.run([tool, '--version'], process.cwd(), { timeoutMs: 5_000, maxBytes: 64 * 1024 })
  if (result.exitCode !== 0) return null
  const first = result.stdout.split(/\r?\n/)[0]?.trim()
  return first === undefined || first === '' ? null : first
}

/** Read the installed DSH version from its package manifest, when reachable. */
async function dshVersion(): Promise<string | null> {
  const candidates = [
    process.env.DSH_VERSION,
    process.env.DSH_DESKTOP_VERSION,
  ].filter((value): value is string => typeof value === 'string' && value !== '')
  if (candidates.length > 0) return candidates[0]!
  try {
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : null
  } catch {
    return null
  }
}

/**
 * Build the cached diagnostics provider.
 *
 * The warnings name the exact situation: a missing client says what to install
 * and which config key pins an alternative, and a resolved client that does not
 * answer `--version` is reported with the path that was tried.
 * @param deps - runner, workspace source, plugin version, data directory.
 * @returns a provider returning {@link Diagnostics}.
 */
export function createDiagnosticsProvider(deps: DiagnosticsDeps): () => Promise<Diagnostics> {
  let cache: { at: number; value: Diagnostics } | undefined

  return async () => {
    const current = Date.now()
    if (cache !== undefined && current - cache.at < CACHE_TTL_MS) return cache.value
    // The client resolution is awaited here: the first diagnostics read then
    // reports the final picture instead of "no warnings yet".
    const [gitVersion, svnVersion, version, toolWarnings, toolPaths] = await Promise.all([
      toolVersion(deps.runner, 'git'),
      toolVersion(deps.runner, 'svn'),
      dshVersion(),
      Promise.resolve(deps.toolWarnings?.()),
      Promise.resolve(deps.toolPaths?.()),
    ])
    const warnings: string[] = toolWarnings === undefined
      ? [
          ...(gitVersion === null ? ['git executable not found'] : []),
          ...(svnVersion === null ? ['svn executable not found'] : []),
        ]
      : [...toolWarnings]
    if (toolPaths !== undefined) {
      if (gitVersion === null && toolPaths.git !== null) {
        warnings.push(`git at ${toolPaths.git} did not answer --version; check that the file is a working git client`)
      }
      if (svnVersion === null && toolPaths.svn !== null) {
        warnings.push(`svn at ${toolPaths.svn} did not answer --version; check that the file is a working svn client`)
      }
    }
    const value: Diagnostics = {
      pluginVersion: deps.pluginVersion,
      dshVersion: version,
      platform: `${process.platform} ${process.arch}`,
      dataDir: deps.dataDir,
      gitVersion,
      svnVersion,
      workspaceCount: deps.workspaces().length,
      warnings,
    }
    cache = { at: current, value }
    return value
  }
}
