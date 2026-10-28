/**
 * dsh-vcs-timeline — Host half.
 *
 * Mounts the whole server side in one effect: the JSONL audit store, the two
 * VCS adapters over the managed subprocess service, the gated repository
 * registry, the read/write services, and the `/vcs` route family. The browser
 * half is this package's `./client` export; it reaches the Host only through
 * these routes.
 * @module dsh-vcs-timeline
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-workspace'
import { createGitAdapter } from './adapters/git/adapter.ts'
import { createSvnAdapter } from './adapters/svn/adapter.ts'
import { createAuditService } from './audit/audit-service.ts'
import { createBranchService } from './branch/service.ts'
import { createChecksService } from './checks/service.ts'
import { createDiagnosticsProvider } from './diagnostics.ts'
import { createRepositoryRegistry, type WorkspaceInfo } from './discovery.ts'
import { createPullRequestService } from './pr/service.ts'
import { registerVcsRoutes } from './routes.ts'
import { createRunner } from './runner.ts'
import { resolveDataDir } from './security.ts'
import { createSessionChangesService } from './session/changes.ts'
import { createOperationService } from './services/operation-service.ts'
import { createRepositoryResolver, createTimelineService } from './services/timeline-service.ts'
import { createStatsService } from './stats/service.ts'
import { createJsonlStore } from './storage/jsonl.ts'
import { createToolchain, type VcsTool } from './toolchain.ts'

/** Required Host services: route registry, managed subprocesses, workspace registry. */
export const inject = ['webServer', 'subprocess', 'workspaceRegistry']

/** Plugin version, embedded by the build. */
declare const __PLUGIN_VERSION__: string

/** Optional row config (a profile patch may set `dataDir`). */
export interface PluginConfig {
  /** Override the JSONL data directory (defaults under the DSH home). */
  dataDir?: string
}

/**
 * Mount the plugin.
 * @param ctx - Host context carrying the injected services.
 * @param config - optional row config from the profile patch.
 */
export function apply(ctx: Context, config?: PluginConfig): void {
  const dataDir = resolveDataDir(typeof config?.dataDir === 'string' ? config.dataDir : undefined)
  const store = createJsonlStore({ dir: dataDir })
  // Resolve the VCS clients once, at mount: `vcs-config.json` first, then PATH,
  // then the well-known Windows install locations. The runner applies the result
  // to every bare `git`/`svn` argv, so the adapters stay unchanged.
  const toolchain = createToolchain({
    dataDir,
    resolveOnPath: async (tool: VcsTool) => {
      try {
        const resolved = await ctx.subprocess.resolveExecutable(tool)
        return typeof resolved === 'string' && resolved !== '' ? resolved : null
      } catch {
        return null
      }
    },
  })
  const runner = createRunner(ctx.subprocess, () => toolchain.paths())
  const adapters = {
    git: createGitAdapter(runner),
    svn: createSvnAdapter(runner),
  }
  const workspaces = (): WorkspaceInfo[] => ctx.workspaceRegistry.list().map(workspace => ({
    id: String(workspace.id),
    path: workspace.path,
  }))
  const log = (message: string): void => ctx.logger.warn(message)

  const registry = createRepositoryRegistry({ workspaces, adapters, store, log })
  const resolver = createRepositoryResolver(registry, adapters)
  const audit = createAuditService(store)
  const diagnostics = createDiagnosticsProvider({
    runner,
    workspaces,
    pluginVersion: __PLUGIN_VERSION__,
    dataDir,
    toolWarnings: async () => (await toolchain.resolve()).warnings,
    toolPaths: async () => (await toolchain.resolve()).paths,
  })
  const timeline = createTimelineService({ resolver, registry, store, diagnostics })
  const operations = createOperationService({ resolver, runner, store, audit, log })
  const pullRequests = createPullRequestService({ resolver, runner, dataDir })
  const branch = createBranchService({ resolver, runner })
  const checks = createChecksService({ resolver })
  const stats = createStatsService({ resolver, runner })
  const sessionChanges = createSessionChangesService({
    resolver,
    // The session store is a Host service, not plugin state. Read it through
    // the Cordis lookup first: without an `inject` declaration the service is
    // still registered, but a plain property read can be undefined in some
    // host compositions. Both shapes are tried, and a missing store degrades
    // to "attribution unavailable" instead of failing the route.
    sessions: () => {
      try {
        const lookup = (ctx as unknown as {
          get?: (name: string, strict?: boolean) => unknown
        }).get
        const fromLookup = typeof lookup === 'function' ? lookup.call(ctx, 'sessions', false) : undefined
        const candidate = fromLookup ?? (ctx as unknown as { sessions?: unknown }).sessions
        return candidate as import('./session/changes.ts').LiveSessionStoreLike | undefined
      } catch {
        return undefined
      }
    },
  })

  ctx.effect(() => {
    const disposeRoutes = registerVcsRoutes(ctx, {
      timeline,
      operations,
      pullRequests,
      branch,
      checks,
      stats,
      sessionChanges,
      diagnostics,
      log,
    })
    return () => {
      disposeRoutes()
      void store.close()
    }
  }, 'dsh-vcs-timeline: /vcs routes and services')
}
