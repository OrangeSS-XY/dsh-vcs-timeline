/**
 * Production {@link Runner} over the Host `subprocess` service.
 *
 * Every command is a managed child with bounded collected streams, a
 * wall-clock deadline, and a caller-owned AbortSignal. No command ever goes
 * through a shell: argv arrays only.
 *
 * The runner is also the one place that applies the mount-time client
 * resolution: an argv whose first element is exactly `git` or `svn` is
 * rewritten to the absolute executable found by
 * {@link module:dsh-vcs-timeline/host/toolchain}. Adapters keep building plain
 * `['git', …]` argv; only the spawn sees the resolved path.
 * @module dsh-vcs-timeline/host/runner
 */

import type { RunOptions, RunResult, Runner } from './adapters/types.ts'
import type { ToolPaths } from './toolchain.ts'

/** Collected-output cap for one command, per stream. */
export const DEFAULT_OUTPUT_CAP_BYTES = 1 << 20

/** Command names whose argv[0] is replaced with the resolved executable. */
const RESOLVED_COMMANDS: ReadonlySet<string> = new Set(['git', 'svn'])

/**
 * Where the runner reads the resolved client paths from.
 *
 * A plain object is used as-is; a getter is awaited once and memoized, so the
 * runner never re-reads the user configuration between commands.
 */
export type ToolPathSource = ToolPaths | (() => ToolPaths | Promise<ToolPaths>)

/** Default wall-clock deadline for one command. */
export const DEFAULT_TIMEOUT_MS = 20_000

/** The structural subprocess service surface this module consumes. */
export interface SubprocessLike {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: {
      stdin: 'ignore'
      stdout: { maxBytes: number }
      stderr: { maxBytes: number }
    }
    graceMs: number
    signal?: AbortSignal
  }): {
    done: Promise<{ exitCode: number | null }>
    collected: {
      stdout?: { readFrom(offset: number): { text: string } }
      stderr?: { readFrom(offset: number): { text: string } }
    }
  }
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>
}

/** A sanitized one-line description of a spawn/run failure. */
function failureText(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/\s+/g, ' ').slice(0, 300)
  return String(error).replace(/\s+/g, ' ').slice(0, 300)
}

/** Normalize an unknown tool-path source into {@link ToolPaths}. */
function normalizeToolPaths(value: unknown): ToolPaths {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  return {
    git: typeof record.git === 'string' && record.git.trim() !== '' ? record.git : null,
    svn: typeof record.svn === 'string' && record.svn.trim() !== '' ? record.svn : null,
  }
}

/**
 * Build the production runner.
 * @param subprocess - the Host subprocess service.
 * @param toolPaths - optional resolved client paths (a value or a getter). When
 *   absent, bare `git`/`svn` argv is passed through unchanged.
 * @returns the runner used by both VCS adapters.
 */
export function createRunner(subprocess: SubprocessLike, toolPaths?: ToolPathSource): Runner {
  let cached: ToolPaths | undefined

  /** Read the resolved client paths once; a failing getter means "none". */
  const paths = async (): Promise<ToolPaths> => {
    if (cached !== undefined) return cached
    if (toolPaths === undefined) {
      cached = { git: null, svn: null }
      return cached
    }
    try {
      cached = normalizeToolPaths(typeof toolPaths === 'function' ? await toolPaths() : toolPaths)
    } catch {
      cached = { git: null, svn: null }
    }
    return cached
  }

  /** Replace a bare `git`/`svn` argv[0] with the resolved absolute executable. */
  const rewrite = async (argv: readonly string[]): Promise<readonly string[]> => {
    const command = argv[0]
    if (command === undefined || !RESOLVED_COMMANDS.has(command)) return argv
    const resolved = command === 'git' ? (await paths()).git : (await paths()).svn
    if (resolved === null || resolved === command) return argv
    return [resolved, ...argv.slice(1)]
  }

  return {
    async run(argv, cwd, options: RunOptions = {}): Promise<RunResult> {
      options.signal?.throwIfAborted()
      const effectiveArgv = await rewrite(argv)
      options.signal?.throwIfAborted()
      const maxBytes = options.maxBytes ?? DEFAULT_OUTPUT_CAP_BYTES
      const deadlineMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      const controller = new AbortController()
      const forwardAbort = (): void => controller.abort(options.signal?.reason)
      if (options.signal !== undefined) {
        if (options.signal.aborted) controller.abort(options.signal.reason)
        else options.signal.addEventListener('abort', forwardAbort, { once: true })
      }
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort(new Error('command deadline exceeded'))
      }, deadlineMs)

      let handle: ReturnType<SubprocessLike['spawn']>
      try {
        handle = subprocess.spawn({
          argv: effectiveArgv,
          cwd,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes },
            stderr: { maxBytes },
          },
          graceMs: 5_000,
          signal: controller.signal,
        })
      } catch (error: unknown) {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', forwardAbort)
        return {
          exitCode: null,
          stdout: '',
          stderr: '',
          spawnFailed: true,
          failureMessage: failureText(error),
        }
      }

      try {
        const outcome = await handle.done
        const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
        const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
        return {
          exitCode: outcome.exitCode,
          stdout,
          stderr,
          ...(timedOut ? { timedOut: true } : {}),
        }
      } catch (error: unknown) {
        const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
        const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
        return {
          exitCode: null,
          stdout,
          stderr,
          ...(timedOut ? { timedOut: true } : {}),
          spawnFailed: false,
          failureMessage: failureText(error),
        }
      } finally {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', forwardAbort)
      }
    },

    async resolveExecutable(command: string): Promise<string | null> {
      // The mount-time resolution is authoritative for the two clients we run;
      // fall back to the subprocess service for every other name (and for a
      // client the resolution missed, e.g. PATH changed after mount).
      if (RESOLVED_COMMANDS.has(command)) {
        const resolved = command === 'git' ? (await paths()).git : (await paths()).svn
        if (resolved !== null) return resolved
      }
      try {
        const resolved = await subprocess.resolveExecutable(command)
        return typeof resolved === 'string' && resolved !== '' ? resolved : null
      } catch {
        return null
      }
    },
  }
}
