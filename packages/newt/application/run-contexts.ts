import type { Server } from 'bun'
import { setTracer } from '../core'
import { serve } from '../http'
import { applicationSampler } from '../runtime/internal'
import type { ContextToRun } from './context-to-run'
import type { RunContextsOptions } from './run-contexts-options'
import type { RunningContexts } from './running-contexts'

const SIGNALS = ['SIGINT', 'SIGTERM'] as const

/**
 * Runs an application's contexts, opened, in the order they were (each one after
 * those it uses): serves each one that is served, then starts the worker of each.
 * Stopping is the other way round: every server stops taking requests and finishes
 * those in progress, the instance tells whoever monitors it that it stopped, then each
 * context stops, the last one first, so none stops before one that uses it, and the
 * tracer sends what it still keeps. On SIGINT or
 * SIGTERM it stops them and ends the process.
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
      for (const { context } of contexts.toReversed()) await context.stop()
      await options.tracer?.flush?.()
    })(),
  }
  if (options.signals !== false) for (const signal of SIGNALS) process.on(signal, onSignal)
  return running
}
