/** How much a line matters: what is worth reading when looking into something, what happened, what is odd, what went wrong. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** What a line says beside its message: whatever its writer gives, kept as it is. */
export type LogFields = Record<string, unknown>

/**
 * One line of the application's log: when, how much it matters, what it says, and
 * where it was written: the context of the step running, and the trace and step it
 * belongs to, when one is recorded.
 */
export type LogLine = {
  at: string
  level: LogLevel
  message: string
  fields: LogFields
  context: string | null
  traceId: string | null
  spanId: string | null
}
