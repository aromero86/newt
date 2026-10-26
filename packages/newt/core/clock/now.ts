import { currentClock } from './current-clock'
import { systemClock } from './system-clock'

/** The time by the clock of the context at work (`currentClock`), or the real one outside any. */
export function now(): Date {
  return (currentClock.find() ?? systemClock).now()
}
