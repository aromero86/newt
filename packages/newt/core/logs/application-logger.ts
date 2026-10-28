import { ConsoleLogger } from './console-logger'
import type { Logger } from './logger'

/** Where the whole application's log lines go: the console until `setLogger`. */
export const applicationLogger: { value: Logger } = { value: new ConsoleLogger() }
