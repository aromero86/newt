import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { RateLimitStore } from '../../port-rate-limit'
import type { RateLimitFixture } from './rate-limit-fixture'

const MINUTE = 60_000
/** The start of a window of a minute, and a moment `ms` into it. */
const T0 = Date.parse('2026-01-01T10:00:00.000Z')
const at = (ms: number) => new Date(T0 + ms)
const rule = { limit: 3, windowMs: MINUTE }

/** Checks a rate limit store keeps what `RateLimitStore` promises. */
export function describeRateLimitContract<S extends RateLimitStore>(name: string, fixture: RateLimitFixture<S>): void {
  describe(`${name} keeps the RateLimitStore contract`, () => {
    let store: S
    // Each test's keys are its own, for a store a suite shares (Redis).
    let key: string

    beforeEach(async () => {
      store = await fixture.open()
      key = `key-${crypto.randomUUID()}`
    })

    afterEach(() => fixture.close?.(store))

    test('lets a key through up to its limit, saying what is left', async () => {
      const takes = [await store.take(key, rule, at(0)), await store.take(key, rule, at(1)), await store.take(key, rule, at(2))]

      expect(takes.map(take => [take.allowed, take.remaining, take.retryAfterMs])).toEqual([[true, 2, 0], [true, 1, 0], [true, 0, 0]])
      expect(takes.every(take => take.limit === 3)).toBe(true)
    })

    test('refuses the take past the limit, saying how long to wait', async () => {
      for (let i = 0; i < 3; i++) await store.take(key, rule, at(10_000))

      const refused = await store.take(key, rule, at(20_000))
      expect(refused).toEqual({ allowed: false, limit: 3, remaining: 0, retryAfterMs: expect.any(Number) })
      expect(refused.retryAfterMs).toBeGreaterThan(0)
      // Waiting what it says lets the next one through, and no sooner.
      expect((await store.take(key, rule, at(20_000 + refused.retryAfterMs - 1))).allowed).toBe(false)
      expect((await store.take(key, rule, at(20_000 + refused.retryAfterMs))).allowed).toBe(true)
    })

    test('a take refused is not counted', async () => {
      for (let i = 0; i < 3; i++) await store.take(key, rule, at(0))
      for (let i = 0; i < 5; i++) await store.take(key, rule, at(1000))

      // Two windows on, nothing of before counts: a refused take did not keep it full.
      expect((await store.take(key, rule, at(2 * MINUTE))).remaining).toBe(2)
    })

    test('the window before counts as much as it still overlaps', async () => {
      for (let i = 0; i < 3; i++) await store.take(key, rule, at(59_000))

      // A third into the next window, two thirds of the three before still count: 2 used.
      const take = await store.take(key, rule, at(MINUTE + 20_000))
      expect([take.allowed, take.remaining]).toEqual([true, 0])
      expect((await store.take(key, rule, at(MINUTE + 20_000))).allowed).toBe(false)
    })

    test('counts each key on its own', async () => {
      for (let i = 0; i < 3; i++) await store.take(key, rule, at(0))

      expect((await store.take(key, rule, at(1))).allowed).toBe(false)
      expect((await store.take(`${key}-other`, rule, at(1))).allowed).toBe(true)
    })

    test('forgets a key: its next take starts afresh', async () => {
      for (let i = 0; i < 3; i++) await store.take(key, rule, at(0))
      await store.forget(key)

      expect(await store.take(key, rule, at(1))).toEqual({ allowed: true, limit: 3, remaining: 2, retryAfterMs: 0 })
    })

    test('forgetting a key it never saw is nothing', async () => {
      await store.forget(key)

      expect((await store.take(key, rule, at(0))).remaining).toBe(2)
    })

    test('takes at once never let more through than the limit', async () => {
      const takes = await Promise.all(Array.from({ length: 10 }, () => store.take(key, rule, at(0))))

      expect(takes.filter(take => take.allowed)).toHaveLength(3)
    })

    test('refuses a rule that cannot count', async () => {
      await expect(store.take(key, { limit: 0, windowMs: MINUTE }, at(0))).rejects.toThrow('limit')
      await expect(store.take(key, { limit: 1.5, windowMs: MINUTE }, at(0))).rejects.toThrow('limit')
      await expect(store.take(key, { limit: 1, windowMs: 0 }, at(0))).rejects.toThrow('window')
    })
  })
}
