import { z } from 'zod'

/** What the monitor is told by its environment, each variable with what it is for. */
const EnvSchema = z.object({
  /** Where it listens. */
  NEWT_MONITOR_PORT: z.coerce.number().int().min(0).max(65_535).default(4800),
  /** Its SQLite database: a file, made with its folder if missing, or `:memory:`. */
  NEWT_MONITOR_DATA: z.string().trim().min(1).default('data/newt-monitor.db'),
  /** Where people open it: its session cookie is `Secure` when this is `https`. */
  NEWT_MONITOR_PUBLIC_URL: z.url().default('http://localhost:4800'),
  /** Who signs in to it: no default, so a monitor nobody configured does not start. */
  NEWT_MONITOR_USER: z.string().trim().min(1),
  /** Their password: 12 characters or more. */
  NEWT_MONITOR_PASSWORD: z.string().min(12),
  /** How long a session lasts. */
  NEWT_MONITOR_SESSION_HOURS: z.coerce.number().int().min(1).default(12),
})

export type MonitorConfig = {
  port: number
  database: string
  publicUrl: string
  /** The one person who signs in. */
  admin: { user: string, password: string }
  sessionHours: number
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
  const { data } = parsed
  return {
    port: data.NEWT_MONITOR_PORT,
    database: data.NEWT_MONITOR_DATA,
    publicUrl: data.NEWT_MONITOR_PUBLIC_URL,
    admin: { user: data.NEWT_MONITOR_USER, password: data.NEWT_MONITOR_PASSWORD },
    sessionHours: data.NEWT_MONITOR_SESSION_HOURS,
  }
}
