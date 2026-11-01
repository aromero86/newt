import { describe, expect, test } from 'bun:test'
import { SqliteStore } from '../../adapter-sqlite'
import { Module, TooManyRequests, UseCase, type Clock } from '../../core'
import { MemoryRateLimitStore } from '../../port-rate-limit'
import { Base } from '../base'

const MINUTE = 60_000

/** A context whose clock a test moves, with the rate limit store given. */
async function base(rateLimits = new MemoryRateLimitStore(), name = 'auth') {
  let time = Date.parse('2026-01-01T10:00:00.000Z')
  const clock: Clock = { now: () => new Date(time) }
  const store = await SqliteStore.open({ path: ':memory:' })
  return { base: new Base({ name, store, clock, rateLimits }), later: (ms: number) => { time += ms } }
}

class Session_Module extends Module {
  readonly signIns

  constructor(base: Base) {
    super('session', base.invocations, {})
    this.signIns = base.rateLimits.define('session.signIn', { limit: 2, windowMs: MINUTE })
  }

  @UseCase()
  async signIn(email: string, right: boolean): Promise<string> {
    await this.signIns.take(email)
    if (!right) return 'wrong'
    await this.signIns.forget(email)
    return 'in'
  }
}

describe('rate limits', () => {
  test('a use case past its limit is TooManyRequests, naming the limit and how long to wait', async () => {
    const { base: auth } = await base()
    const sessions = new Session_Module(auth)
    await sessions.signIn('ana@example.com', false)
    await sessions.signIn('ana@example.com', false)

    const refused = await sessions.signIn('ana@example.com', false).catch(error => error)
    expect(refused).toBeInstanceOf(TooManyRequests)
    expect(refused).toMatchObject({ status: 429, code: 'too_many_requests', limit: 'session.signIn' })
    expect(refused.retryAfterMs).toBeGreaterThan(0)
    // Someone else has their own count.
    expect(await sessions.signIn('bea@example.com', true)).toBe('in')
    await auth.close()
  })

  test('counts by the context\'s clock: once it waits long enough, it may again', async () => {
    const { base: auth, later } = await base()
    const sessions = new Session_Module(auth)
    await sessions.signIn('ana@example.com', false)
    await sessions.signIn('ana@example.com', false)
    const refused = await sessions.signIn('ana@example.com', false).catch((error: unknown) => error) as TooManyRequests

    later(refused.retryAfterMs)
    expect(await sessions.signIn('ana@example.com', true)).toBe('in')
    await auth.close()
  })

  test('forgetting a key starts it afresh', async () => {
    const { base: auth } = await base()
    const sessions = new Session_Module(auth)
    await sessions.signIn('ana@example.com', false)
    await sessions.signIn('ana@example.com', true)

    // The right one forgot the wrong one: two more may come.
    await sessions.signIn('ana@example.com', false)
    expect(await sessions.signIn('ana@example.com', false)).toBe('wrong')
    await auth.close()
  })

  test('two contexts sharing a store keep their counts apart', async () => {
    const shared = new MemoryRateLimitStore()
    const one = await base(shared, 'auth')
    const two = await base(shared, 'boards')
    const limit = { limit: 1, windowMs: MINUTE }
    await one.base.rateLimits.define('session.signIn', limit).take('ana')

    expect((await two.base.rateLimits.define('session.signIn', limit).take('ana')).allowed).toBe(true)
    await one.base.close()
    await two.base.close()
  })

  test('a limit is named <module>.<name>, once, with a rule that can count', async () => {
    const { base: auth } = await base()

    expect(() => auth.rateLimits.define('signIn', { limit: 1, windowMs: MINUTE })).toThrow('<module>.<name>')
    auth.rateLimits.define('session.signIn', { limit: 1, windowMs: MINUTE })
    expect(() => auth.rateLimits.define('session.signIn', { limit: 1, windowMs: MINUTE })).toThrow('twice')
    expect(() => auth.rateLimits.define('session.other', { limit: 0, windowMs: MINUTE })).toThrow('limit')
    await auth.close()
  })
})
