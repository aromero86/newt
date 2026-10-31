import type { Server } from 'bun'
import { setTracer } from '../core'
import { applicationTraces } from '../core/internal'
import { serve } from '../http'
import type { Traces } from '../runtime'
import { applicationMetrics, applicationSampler } from '../runtime/internal'
import type { ContextToRun } from './context-to-run'
import type { RunContextsOptions } from './run-contexts-options'
import type { RunningContexts } from './running-contexts'

const SIGNALS = ['SIGINT', 'SIGTERM'] as const

/**
 * Runs an application's contexts, opened, in the order they were (each one after
 * those it uses): serves each one that is served, then starts the worker of each.
 * Stopping is the other way round: every server stops taking requests and finishes
 * those in progress, the instance tells whoever monitors it that it stopped, every
 * context's worker stops (a context's handlers of another's events run on that one's
 * worker), then each context closes its store, the last one first, so none closes
 * before one that uses it; then the application's metrics and traces add what they
 * still keep, and the tracer sends what it does. On SIGINT or SIGTERM it stops them
 * and ends the process.
 *
 * ```ts
 * const app = runContexts([
 *   { context: auth, serve: { port: 3001, router: auth.base.http, health: true } },
 *   { context: shop, serve: { port: 3002, router: shop.base.http, frontend: 'dist/shop' } },
 * ], { tracer })
 * ```
 */
export function runContexts(contexts: ContextToRun[], options: RunContextsOptions = {}): RunningContexts {
  if (options.tracer) setTracer(options.tracer)

  const servers: Record<string, Server<undefined>> = {}
  try {
    for (const { context, serve: served } of contexts) if (served) servers[context.name] = serve(served)
  } catch (error) {
    for (const server of Object.values(servers)) void server.stop(true)
    throw error
  }
  for (const { context } of contexts) context.start()

  let stopped: Promise<void> | null = null
  const onSignal = async () => {
    await running.stop()
    process.exit(0)
  }
  const running: RunningContexts = {
    servers,
    stop: () => stopped ??= (async () => {
      if (options.signals !== false) for (const signal of SIGNALS) process.off(signal, onSignal)
      await Promise.all(Object.values(servers).map(server => server.stop()))
      // The instance says it stopped while its metrics are still open: it is not taken for lost.
      await applicationSampler.value?.stop()
      // No store closes while a worker may still run a handler that writes it.
      await Promise.all(contexts.map(({ context }) => context.stopWorker()))
      for (const { context } of contexts.toReversed()) await context.close()
      // Shared by every context, closed once none of them counts or traces any more.
      await applicationMetrics.value?.close()
      await (applicationTraces.sink as Partial<Traces> | null)?.close?.()
      await options.tracer?.flush?.()
    })(),
  }
  if (options.signals !== false) for (const signal of SIGNALS) process.on(signal, onSignal)
  return running
}
