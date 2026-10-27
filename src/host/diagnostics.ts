/**
 * Environment diagnostics reported in the panel footer: plugin/runtime
 * versions, VCS client availability, workspace count, and the data directory.
 * @module dsh-vcs-timeline/host/diagnostics
 */

import { readFile } from 'node:fs/promises'
import type { Diagnostics } from '../shared/contracts.ts'
import type { Runner } from './adapters/types.ts'
import type { WorkspaceInfo } from './discovery.ts'

/** Dependencies of the diagnostics provider. */
export interface DiagnosticsDeps {
  runner: Runner
  workspaces: () => WorkspaceInfo[]
  pluginVersion: string
  dataDir: string
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
 * @param deps - runner, workspace source, plugin version, data directory.
 * @returns a provider returning {@link Diagnostics}.
 */
export function createDiagnosticsProvider(deps: DiagnosticsDeps): () => Promise<Diagnostics> {
  let cache: { at: number; value: Diagnostics } | undefined

  return async () => {
    const current = Date.now()
    if (cache !== undefined && current - cache.at < CACHE_TTL_MS) return cache.value
    const [gitVersion, svnVersion, version] = await Promise.all([
      toolVersion(deps.runner, 'git'),
      toolVersion(deps.runner, 'svn'),
      dshVersion(),
    ])
    const warnings: string[] = []
    if (gitVersion === null) warnings.push('git executable not found')
    if (svnVersion === null) warnings.push('svn executable not found')
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
