import { z } from 'zod'

/** What the monitor is told by its environment, each variable with what it is for. */
const EnvSchema = z.object({
  /** Where it listens. */
  NEWT_MONITOR_PORT: z.coerce.number().int().min(0).max(65_535).default(4800),
  /** Its SQLite database: a file, made with its folder if missing, or `:memory:`. */
  NEWT_MONITOR_DATA: z.string().trim().min(1).default('data/newt-monitor.db'),
})

export type MonitorConfig = {
  port: number
  database: string
}

/**
 * The monitor's settings, from its environment. Any variable that is wrong stops it
 * before it opens anything, every one of them named, so one start says all that is
 * missing.
 */
export function readConfig(env: Record<string, string | undefined>): MonitorConfig {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`it cannot start:\n  ${problems.join('\n  ')}`)
  }
  return { port: parsed.data.NEWT_MONITOR_PORT, database: parsed.data.NEWT_MONITOR_DATA }
}
