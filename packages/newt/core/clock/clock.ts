/**
 * What tells the time to a context: when entities are created and changed, when its
 * jobs are due, when its schedules fire. The real time unless its `Base` is given
 * another (`new Base({ …, clock })`): a test moves it instead of waiting.
 *
 * ```ts
 * let time = Date.parse('2026-01-01T00:00:00Z')
 * const clock: Clock = { now: () => new Date(time) }
 * time += 60_000 // a minute later
 * ```
 */
export type Clock = { now(): Date }
