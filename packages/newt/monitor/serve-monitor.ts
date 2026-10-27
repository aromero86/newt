import type { Server } from 'bun'
import { hostname } from 'node:os'
import { systemClock } from '../core'
import { describeApplication, type Base, type BoundedContext } from '../runtime'
import manifest from '../package.json'
import { MIN_KEY_LENGTH } from './monitor-signature'
import type { MonitorIdentity } from './monitor-identity'
import type { MonitorOptions } from './monitor-options'
import { MonitorVerifier } from './monitor-verifier'

const json = (body: unknown) => Response.json(body, { headers: { 'cache-control': 'no-store' } })

/**
 * What an application tells whoever monitors it, on a port of its own: which it is
 * (`GET /v1/identity`) and what it is made of (`GET /v1/structure`, as
 * `describeApplication` says it while it runs). Read only, and never its data.
 *
 * Only to a request signed with the key it shares with the monitor
 * (`signMonitorRequest`): any other gets a 401, the same whatever was wrong, and
 * learns nothing, not even which paths there are. It does not start without a key.
 *
 * ```ts
 * serveMonitor(contexts.all, { name: 'cooper', port: 3010, hostname: '0.0.0.0', key: env.COOPER_MONITOR_KEY })
 * ```
 */
export function serveMonitor(contexts: readonly (Base | BoundedContext)[], options: MonitorOptions): Server<undefined> {
  if (typeof options.key !== 'string' || options.key.length < MIN_KEY_LENGTH) {
    throw new Error(`The monitor's key has at least ${MIN_KEY_LENGTH} characters: it does not start without one`)
  }
  const clock = options.clock ?? systemClock
  const verifier = new MonitorVerifier(options.key, clock)
  const identity: MonitorIdentity = {
    name: options.name,
    newt: manifest.version,
    instance: { id: crypto.randomUUID(), host: hostname(), pid: process.pid },
    startedAt: clock.now().toISOString(),
  }

  return Bun.serve({
    port: options.port,
    hostname: options.hostname ?? '127.0.0.1',
    fetch(request) {
      if (!verifier.verify(request)) return new Response(null, { status: 401 })
      const { pathname } = new URL(request.url)
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } })
      if (pathname === '/v1/identity') return json(identity)
      if (pathname === '/v1/structure') return json(describeApplication(contexts))
      return new Response(null, { status: 404 })
    },
  })
}
