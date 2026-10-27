/**
 * Production {@link Runner} over the Host `subprocess` service.
 *
 * Every command is a managed child with bounded collected streams, a
 * wall-clock deadline, and a caller-owned AbortSignal. No command ever goes
 * through a shell: argv arrays only.
 * @module dsh-vcs-timeline/host/runner
 */

import type { RunOptions, RunResult, Runner } from './adapters/types.ts'

/** Collected-output cap for one command, per stream. */
export const DEFAULT_OUTPUT_CAP_BYTES = 1 << 20

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

/**
 * Build the production runner.
 * @param subprocess - the Host subprocess service.
 * @returns the runner used by both VCS adapters.
 */
export function createRunner(subprocess: SubprocessLike): Runner {
  return {
    async run(argv, cwd, options: RunOptions = {}): Promise<RunResult> {
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
          argv,
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
      try {
        const resolved = await subprocess.resolveExecutable(command)
        return typeof resolved === 'string' && resolved !== '' ? resolved : null
      } catch {
        return null
      }
    },
  }
}
