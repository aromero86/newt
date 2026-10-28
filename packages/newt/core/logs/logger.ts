import type { LogLine } from './log-line'

/**
 * Where the application's log lines go: the console (`ConsoleLogger`, unless set), a
 * file, a collector. Each line comes whole, with the trace it belongs to; the trace
 * keeps its own copy whatever this does with it.
 */
export interface Logger {
  write(line: LogLine): void
}
