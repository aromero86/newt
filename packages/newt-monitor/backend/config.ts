import { dirname, extname, join } from 'node:path'
import { z } from 'zod'
import { MIN_SECRET_LENGTH } from './shared/key-cipher'

/** An empty variable counts as unset: `NEWT_MONITOR_PORT=` is the default port, not port 0. */
const unset = (value: unknown) => (value === '' ? undefined : value)

/** What the monitor is told by its environment, each variable with what it is for. */
const EnvSchema = z.object({
  /** Where it listens. */
  NEWT_MONITOR_PORT: z.preprocess(unset, z.coerce.number().int().min(0).max(65_535).default(4800)),
  /** Its SQLite database: a file, made with its folder if missing, or `:memory:`. */
  NEWT_MONITOR_DATA: z.string().trim().min(1).default('data/newt-monitor.db'),
  /** Where people open it: its session cookie is `Secure` when this is `https`. Without a trailing slash, as its addresses are built on it. */
  NEWT_MONITOR_PUBLIC_URL: z.url().transform(url => url.replace(/\/+$/, '')).default('http://localhost:4800'),
  /** Who signs in to it: no default, so a monitor nobody configured does not start. */
  NEWT_MONITOR_USER: z.string().trim().min(1),
  /** Their password: 12 characters or more. */
  NEWT_MONITOR_PASSWORD: z.string().min(12),
  /** How long a session lasts. */
  NEWT_MONITOR_SESSION_HOURS: z.coerce.number().int().min(1).default(12),
  /** What it encrypts the applications' keys with: no default, 32 characters or more. */
  NEWT_MONITOR_SECRET: z.string().min(MIN_SECRET_LENGTH),
  /** Its built frontend (`bun run monitor:build`). */
  NEWT_MONITOR_FRONTEND: z.string().trim().min(1).default(join(import.meta.dir, '../dist/frontend')),
  /** `1` (`bun run monitor` sets it): the frontend from its sources, which Bun builds as it serves them. */
  NEWT_MONITOR_FRONTEND_SOURCES: z.enum(['0', '1']).default('0'),
  /** A GitHub token that reads the applications' repositories (Contents: read): each commit deployed gets its title. None reads only public ones. */
  NEWT_MONITOR_GITHUB_TOKEN: z.string().trim().optional(),
})

export type MonitorConfig = {
  port: number
  database: string
  /** auth's database: beside the monitor's, `<name>-auth.db`, or in memory with it. */
  authDatabase: string
  publicUrl: string
  /** The one person who signs in. */
  admin: { user: string, password: string }
  sessionHours: number
  /** What the applications' keys are encrypted with (`KeyCipher`). */
  secret: string
  /** The built frontend it hands out for every address its API does not take. */
  frontend: string
  /** Its frontend from its sources instead, rebuilt as they change: development only. */
  frontendSources: boolean
  /** Where each application's metrics are kept, a DuckDB each: beside its database, or in memory with it. */
  metricsFolder: string
  /** What reads the commits' titles from GitHub: null reads only public repositories. */
  githubToken: string | null
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
    authDatabase: authDatabaseOf(data.NEWT_MONITOR_DATA),
    publicUrl: data.NEWT_MONITOR_PUBLIC_URL,
    admin: { user: data.NEWT_MONITOR_USER, password: data.NEWT_MONITOR_PASSWORD },
    sessionHours: data.NEWT_MONITOR_SESSION_HOURS,
    secret: data.NEWT_MONITOR_SECRET,
    frontend: data.NEWT_MONITOR_FRONTEND,
    frontendSources: data.NEWT_MONITOR_FRONTEND_SOURCES === '1',
    metricsFolder: data.NEWT_MONITOR_DATA === ':memory:' ? ':memory:' : join(dirname(data.NEWT_MONITOR_DATA), 'metrics'),
    githubToken: data.NEWT_MONITOR_GITHUB_TOKEN || null,
  }
}

/** auth's database beside the monitor's: `data/newt-monitor.db` has `data/newt-monitor-auth.db`. */
function authDatabaseOf(database: string): string {
  if (database === ':memory:') return database
  const extension = extname(database)
  return `${database.slice(0, database.length - extension.length)}-auth${extension}`
}
