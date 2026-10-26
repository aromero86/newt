import type { Clock } from './clock'

/** The real time. */
export const systemClock: Clock = { now: () => new Date() }
