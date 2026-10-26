import { ConcurrencyConflict, findCurrentActor, now } from '../core'
import type { Table } from '../port-store'
import { IdempotencyKeyInUse } from './errors/idempotency-key-in-use'
import { IdempotencyKeyReused } from './errors/idempotency-key-reused'
import type { HttpRoute } from './http-route'
import type { Idempotency } from './idempotency'
import type { KeptAnswer } from './kept-answer'

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

/** When each table last removed its forgotten keys, in milliseconds. */
const purgedAt = new WeakMap<Table<KeptAnswer>, number>()

const sha256 = (data: string | ArrayBuffer) => new Bun.CryptoHasher('sha256').update(data).digest('hex')

/**
 * A route that answers a request with an `Idempotency-Key` it saw before, from the same
 * actor at the same address, with the answer it gave the first time, kept in
 * `idempotency.table`. The first one takes the key before it runs: another with the
 * same key meanwhile is a 409 (`idempotency_key_in_use`), for a minute at most (or
 * `ttlMs`, if shorter), so a process that dies midway does not hold it for a day. The
 * same key with another body is a 422 (`idempotency_key_reused`). What fails (an error,
 * a 5xx) is not kept, so the same key may try again. A request without the header runs
 * as usual. Forgotten keys are removed as new ones come, at most once a minute.
 */
export function idempotent(route: HttpRoute, { table, ttlMs = DAY, clock = { now } }: Idempotency): HttpRoute {
  const time = () => clock.now().getTime()
  const at = (ms: number) => new Date(ms).toISOString()

  return async request => {
    const key = request.headers.get('idempotency-key')
    if (!key) return route(request)
    const id = sha256(JSON.stringify([findCurrentActor()?.userId ?? null, new URL(request.url).pathname, key]))
    const bodyHash = sha256(await request.clone().arrayBuffer())

    const started = time()
    if (started - (purgedAt.get(table) ?? 0) >= MINUTE) {
      purgedAt.set(table, started)
      await table.deleteMany({ expiresAt: { lte: at(started) } })
    }

    const [kept] = await table.find({ id })
    if (kept && Date.parse(kept.expiresAt) > started) {
      if (kept.bodyHash !== bodyHash) throw new IdempotencyKeyReused()
      if (kept.status === 0) throw new IdempotencyKeyInUse()
      return new Response(kept.body, { status: kept.status, headers: [...JSON.parse(kept.headers) as [string, string][], ['idempotent-replayed', 'true']] })
    }
    // Taken: a new key is inserted, a forgotten one changed from the version read, so two never take it at once.
    const taken = { bodyHash, status: 0, headers: '[]', body: '', expiresAt: at(started + Math.min(MINUTE, ttlMs)) }
    try {
      if (kept) await table.update(id, kept.version, taken)
      else await table.insert({ id, ...taken })
    } catch (error) {
      throw error instanceof ConcurrencyConflict ? new IdempotencyKeyInUse() : error
    }
    const version = kept ? kept.version + 1 : 1

    let response: Response
    try {
      response = await route(request)
    } catch (error) {
      await stillOurs(() => table.delete(id, version))
      throw error
    }
    if (response.status >= 500) {
      await stillOurs(() => table.delete(id, version))
      return response
    }
    const body = await response.text()
    await stillOurs(() => table.update(id, version, { status: response.status, headers: JSON.stringify([...response.headers]), body, expiresAt: at(time() + ttlMs) }))
    return new Response(body, { status: response.status, headers: response.headers })
  }
}

/** Writes to the key taken, unless another request took it once it was too long in progress: then it is that one's. */
async function stillOurs(write: () => Promise<void>): Promise<void> {
  try {
    await write()
  } catch (error) {
    if (!(error instanceof ConcurrencyConflict)) throw error
  }
}
