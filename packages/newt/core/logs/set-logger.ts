import { applicationLogger } from './application-logger'
import type { Logger } from './logger'

/** Where the application's log lines go, instead of the console. Set once, where it starts. */
export function setLogger(logger: Logger): void {
  applicationLogger.value = logger
}
