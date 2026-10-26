import { ConcurrencyConflict, findCurrentActor } from '../core'
import { IdempotencyKeyInUse } from './errors/idempotency-key-in-use'
import type { HttpRoute } from './http-route'
import type { Idempotency } from './idempotency'

const DAY = 24 * 60 * 60 * 1000

/**
 * A route that answers a request with an `Idempotency-Key` it saw before, from the same
 * actor at the same address, with the answer it gave the first time, kept in
 * `idempotency.table`. The first one takes the key before it runs: another with the
 * same key meanwhile is a 409 (`idempotency_key_in_use`). What fails (an error, a 5xx)
 * is not kept, so the same key may try again. A request without the header runs as usual.
 */
export function idempotent(route: HttpRoute, { table, ttlMs = DAY }: Idempotency): HttpRoute {
  return async request => {
    const key = request.headers.get('idempotency-key')
    if (!key) return route(request)
    const id = new Bun.CryptoHasher('sha256')
      .update(JSON.stringify([findCurrentActor()?.userId ?? null, new URL(request.url).pathname, key]))
      .digest('hex')

    const [kept] = await table.find({ id })
    if (kept && Date.parse(kept.expiresAt) > Date.now()) {
      if (kept.status === 0) throw new IdempotencyKeyInUse()
      return new Response(kept.body, { status: kept.status, headers: [...JSON.parse(kept.headers) as [string, string][], ['idempotent-replayed', 'true']] })
    }
    if (kept) await table.delete(id, kept.version)
    try {
      await table.insert({ id, status: 0, headers: '[]', body: '', expiresAt: new Date(Date.now() + ttlMs).toISOString() })
    } catch (error) {
      throw error instanceof ConcurrencyConflict ? new IdempotencyKeyInUse() : error
    }

    let response: Response
    try {
      response = await route(request)
    } catch (error) {
      await table.delete(id, 1)
      throw error
    }
    if (response.status >= 500) {
      await table.delete(id, 1)
      return response
    }
    const body = await response.text()
    await table.update(id, 1, { status: response.status, headers: JSON.stringify([...response.headers]), body })
    return new Response(body, { status: response.status, headers: response.headers })
  }
}
