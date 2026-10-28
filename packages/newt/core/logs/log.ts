import { traceLog } from '../traces/trace-recorder'
import { applicationLogger } from './application-logger'
import type { LogFields, LogLevel } from './log-line'

function write(level: LogLevel, message: string, fields: LogFields = {}): void {
  const where = traceLog(level, message, fields)
  try {
    applicationLogger.value.write({ at: new Date().toISOString(), level, message, fields, context: where?.context ?? null, traceId: where?.traceId ?? null, spanId: where?.spanId ?? null })
  } catch (error) {
    console.error('[log] a line could not be written:', error)
  }
}

/**
 * The application's log: a message and whatever fields help, at a level. Written where
 * `setLogger` says (the console unless set), and into the trace being recorded, at the
 * step running, where the monitor shows it. An error keeps its trace, whatever its share.
 *
 * ```ts
 * log.info('card moved', { cardId, from, to })
 * log.error('the payment provider did not answer', { orderId, ms })
 * ```
 */
export const log = {
  debug: (message: string, fields?: LogFields) => write('debug', message, fields),
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
}
