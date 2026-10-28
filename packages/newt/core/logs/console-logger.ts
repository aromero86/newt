import type { LogLine } from './log-line'
import type { Logger } from './logger'

/** The log on the console: one line each, its level first, its fields after. Debug lines only when asked (`debug: true`). */
export class ConsoleLogger implements Logger {

  constructor(private readonly options: { debug?: boolean } = {}) {}

  write(line: LogLine): void {
    if (line.level === 'debug' && !this.options.debug) return
    const where = [line.context, line.traceId && `trace ${line.traceId}`].filter(Boolean).join(' ')
    const text = `${line.at} ${line.level.toUpperCase()}${where ? ` [${where}]` : ''} ${line.message}`
    const fields = Object.keys(line.fields).length ? [line.fields] : []
    if (line.level === 'error') console.error(text, ...fields)
    else if (line.level === 'warn') console.warn(text, ...fields)
    else console.log(text, ...fields)
  }
}
