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
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-workspace'
import { createGitAdapter } from './adapters/git/adapter.ts'
import { createSvnAdapter } from './adapters/svn/adapter.ts'
import { createAuditService } from './audit/audit-service.ts'
import { createDiagnosticsProvider } from './diagnostics.ts'
import { createRepositoryRegistry, type WorkspaceInfo } from './discovery.ts'
import { createPullRequestService } from './pr/service.ts'
import { registerVcsRoutes } from './routes.ts'
import { createRunner } from './runner.ts'
import { resolveDataDir } from './security.ts'
import { createOperationService } from './services/operation-service.ts'
import { createRepositoryResolver, createTimelineService } from './services/timeline-service.ts'
import { createJsonlStore } from './storage/jsonl.ts'

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
  const runner = createRunner(ctx.subprocess)
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
  })
  const timeline = createTimelineService({ resolver, registry, store, diagnostics })
  const operations = createOperationService({ resolver, runner, store, audit, log })
  const pullRequests = createPullRequestService({ resolver, runner, dataDir })

  ctx.effect(() => {
    const disposeRoutes = registerVcsRoutes(ctx, { timeline, operations, pullRequests, diagnostics, log })
    return () => {
      disposeRoutes()
      void store.close()
    }
  }, 'dsh-vcs-timeline: /vcs routes and services')
}
