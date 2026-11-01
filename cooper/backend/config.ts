import { isAbsolute, join } from 'node:path'
import { z } from 'zod'

const root = join(import.meta.dir, '../..')

/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) || path === ':memory:' ? path : join(root, path))

/**
 * A context's database from the environment: a Postgres address
 * (`postgres://user:password@host:5432/db`) as it is, or a SQLite file, relative to
 * the repository root.
 */
const database = (value: string) => (/^postgres(ql)?:\/\//.test(value) ? value : fromRoot(value))

/** An empty variable counts as unset: `COOPER_AUTH_PORT=` is the default port, not port 0. */
const unset = (value: unknown) => (value === '' ? undefined : value)
const variable = <T extends z.ZodType>(schema: T) => z.preprocess(unset, schema)
const port = (fallback: number) => variable(z.coerce.number().int().min(1).max(65_535).default(fallback))
const positive = (fallback: number) => variable(z.coerce.number().int().positive().default(fallback))

/** The length an OAuth client's secret has at least in production, as the monitor's own secret. */
const MIN_SECRET_LENGTH = 32

/** The client secrets development has by default: they are in the repository, so production refuses them. */
const devClientSecrets = {
  COOPER_BOARDS_CLIENT_SECRET: 'cooper-dev-boards-client-secret',
  COOPER_BACKOFFICE_CLIENT_SECRET: 'cooper-dev-backoffice-client-secret',
}

/** What cooper is told by its environment: each variable is described where its setting is. */
const EnvSchema = z.object({
  NODE_ENV: variable(z.string().optional()),
  COOPER_MAIL_FROM: variable(z.string().default('cooper <no-reply@cooper.local>')),
  COOPER_SESSION_DAYS: positive(30),
  COOPER_AUTH_PORT: port(3001),
  COOPER_BOARDS_PORT: port(3002),
  COOPER_BACKOFFICE_PORT: port(3003),
  COOPER_AUTH_PUBLIC_URL: variable(z.url().optional()),
  COOPER_BOARDS_PUBLIC_URL: variable(z.url().optional()),
  COOPER_BACKOFFICE_PUBLIC_URL: variable(z.url().optional()),
  COOPER_BOARDS_CLIENT_SECRET: variable(z.string().optional()),
  COOPER_BACKOFFICE_CLIENT_SECRET: variable(z.string().optional()),
  COOPER_AUTH_DATABASE: variable(z.string().default('data/cooper-auth.db')),
  COOPER_BOARDS_DATABASE: variable(z.string().default('data/cooper-boards.db')),
  COOPER_BACKOFFICE_DATABASE: variable(z.string().default('data/cooper-backoffice.db')),
  COOPER_INVITATION_DAYS: positive(7),
  COOPER_OAUTH_ACCESS_MINUTES: positive(60),
  COOPER_OAUTH_REFRESH_DAYS: positive(30),
  COOPER_AUTH_FRONTEND: variable(z.string().default('dist/cooper/auth')),
  COOPER_BOARDS_FRONTEND: variable(z.string().default('dist/cooper/boards')),
  COOPER_BACKOFFICE_FRONTEND: variable(z.string().default('dist/cooper/backoffice')),
  COOPER_FRONTEND_SOURCES: z.string().optional(),
  COOPER_TRACE: z.string().optional(),
  COOPER_DRAIN_MS: positive(2000),
  COOPER_TRUST_PROXY: variable(z.coerce.number().int().min(0).default(0)),
  COOPER_OTLP_URL: variable(z.string().optional()),
  COOPER_MONITOR_KEY: variable(z.string().optional()),
  COOPER_REDIS_URL: variable(z.string().optional()),
  COOPER_MONITOR_PORT: port(3010),
  COOPER_MONITOR_HOSTNAME: variable(z.string().default('127.0.0.1')),
  COOPER_DISKS: variable(z.string().optional()),
}).superRefine((env, context) => {
  if (env.NODE_ENV !== 'production') return
  for (const name of ['COOPER_BOARDS_CLIENT_SECRET', 'COOPER_BACKOFFICE_CLIENT_SECRET'] as const) {
    const secret = env[name]
    const problem = secret === undefined
      ? 'required in production'
      : secret === devClientSecrets[name]
        ? 'development\'s, which everyone knows: production refuses it'
        : secret.length < MIN_SECRET_LENGTH ? `${MIN_SECRET_LENGTH} characters or more in production` : undefined
    if (problem) context.addIssue({ code: 'custom', path: [name], message: problem })
  }
})

/**
 * cooper's settings, from environment variables, with what development needs by
 * default. Each context has its own: where it listens, where its database lives,
 * where people open it and the built frontend it serves. Any variable that is wrong
 * stops it before it opens anything, every one of them named.
 */
export function readConfig(variables: Record<string, string | undefined>) {
  const parsed = EnvSchema.safeParse(variables)
  if (!parsed.success) {
    const problems = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`cooper cannot start:\n  ${problems.join('\n  ')}`)
  }
  const env = parsed.data

  /** `COOPER_SESSION_DAYS`: how long a browser session lasts without signing in again, in every context. */
  const sessionDays = env.COOPER_SESSION_DAYS

  /** `COOPER_<CONTEXT>_PORT`: where each context listens, its API and its pages. */
  const ports = {
    auth: env.COOPER_AUTH_PORT,
    boards: env.COOPER_BOARDS_PORT,
    backoffice: env.COOPER_BACKOFFICE_PORT,
  }

  /**
   * `COOPER_<CONTEXT>_PUBLIC_URL`: where people open each context. Each context serves
   * its pages and its API on its own port, so in development it is that port; in
   * production, the context's own domain, in front of it.
   */
  const publicUrls = {
    auth: env.COOPER_AUTH_PUBLIC_URL ?? `http://localhost:${ports.auth}`,
    boards: env.COOPER_BOARDS_PUBLIC_URL ?? `http://localhost:${ports.boards}`,
    backoffice: env.COOPER_BACKOFFICE_PUBLIC_URL ?? `http://localhost:${ports.backoffice}`,
  }

  /**
   * `COOPER_<APP>_CLIENT_SECRET`: the secret each web app proves itself with at auth's
   * token endpoint, as an OAuth confidential client. `auth` knows both; each app its own.
   * Each is kept under the id of the product it signs people in to, its client_id, as
   * auth looks it up; its variable is named after the app, as the people deploying it
   * know it: boards' is `COOPER_BOARDS_CLIENT_SECRET`, for the product `cooper`.
   * Development's by default; with `NODE_ENV=production`, both must be told.
   */
  const clientSecrets = {
    cooper: env.COOPER_BOARDS_CLIENT_SECRET ?? devClientSecrets.COOPER_BOARDS_CLIENT_SECRET,
    backoffice: env.COOPER_BACKOFFICE_CLIENT_SECRET ?? devClientSecrets.COOPER_BACKOFFICE_CLIENT_SECRET,
  }

  return {
    /** `COOPER_MAIL_FROM`: who the emails come from, whichever context sends them. */
    mail: {
      from: env.COOPER_MAIL_FROM,
    },
    /** Who someone is: accounts, workspaces, who may enter what, and the OAuth server every app signs in with. */
    auth: {
      /** Where it listens (`COOPER_AUTH_PORT`). */
      port: ports.auth,
      /** `COOPER_AUTH_DATABASE`: its database, a SQLite file or a Postgres address. */
      database: database(env.COOPER_AUTH_DATABASE),
      publicUrl: publicUrls.auth,
      /** Where the other contexts are opened: the apps that sign people in through it. */
      boardsPublicUrl: publicUrls.boards,
      backofficePublicUrl: publicUrls.backoffice,
      /** The secret of each app's OAuth client, by the product it signs people in to. */
      clientSecrets,
      sessionDays,
      /** `COOPER_INVITATION_DAYS`: how long an invitation to a workspace waits to be accepted. */
      invitationDays: env.COOPER_INVITATION_DAYS,
      oauth: {
        /** `COOPER_OAUTH_ACCESS_MINUTES`: how long an access token lasts; the client refreshes it after. */
        accessMinutes: env.COOPER_OAUTH_ACCESS_MINUTES,
        /** `COOPER_OAUTH_REFRESH_DAYS`: how long a refresh token lasts unused. */
        refreshDays: env.COOPER_OAUTH_REFRESH_DAYS,
      },
      /** `COOPER_AUTH_FRONTEND`: its built frontend (`bun run cooper:build`). */
      frontendFolder: fromRoot(env.COOPER_AUTH_FRONTEND),
    },
    /** The SaaS: workspaces' boards, columns and cards, on the web and through MCP. */
    boards: {
      /** Where it listens (`COOPER_BOARDS_PORT`). */
      port: ports.boards,
      /** `COOPER_BOARDS_DATABASE`: its database, a SQLite file or a Postgres address. */
      database: database(env.COOPER_BOARDS_DATABASE),
      publicUrl: publicUrls.boards,
      /** Where its people sign in. */
      authPublicUrl: publicUrls.auth,
      /** Its OAuth client's secret: boards is the product `cooper` in auth. */
      clientSecret: clientSecrets.cooper,
      sessionDays,
      /** `COOPER_BOARDS_FRONTEND`: its built frontend. */
      frontendFolder: fromRoot(env.COOPER_BOARDS_FRONTEND),
    },
    /** The staff's console. */
    backoffice: {
      /** Where it listens (`COOPER_BACKOFFICE_PORT`). */
      port: ports.backoffice,
      /** `COOPER_BACKOFFICE_DATABASE`: its database, a SQLite file or a Postgres address. */
      database: database(env.COOPER_BACKOFFICE_DATABASE),
      publicUrl: publicUrls.backoffice,
      /** Where the staff sign in. */
      authPublicUrl: publicUrls.auth,
      /** Its OAuth client's secret: the product `backoffice` in auth. */
      clientSecret: clientSecrets.backoffice,
      sessionDays,
      /** `COOPER_BACKOFFICE_FRONTEND`: its built frontend. */
      frontendFolder: fromRoot(env.COOPER_BACKOFFICE_FRONTEND),
    },
    /**
     * `COOPER_FRONTEND_SOURCES=1` (`bun run cooper` sets it): each context serves its
     * frontend from its sources, which Bun builds as it serves them and reloads as they
     * change, instead of its built folder.
     */
    frontendSources: env.COOPER_FRONTEND_SOURCES === '1',
    /**
     * `COOPER_TRACE=1`: each use case any context runs written to the console, with
     * those it calls, in its context or another, and how long each took.
     */
    trace: env.COOPER_TRACE === '1',
    /**
     * `COOPER_DRAIN_MS`: how long each server goes on answering once told to stop, its
     * health a 503 meanwhile, so whoever balances the load sends it nothing new: 2
     * seconds. Only the backend's process drains: a test stops its servers at once.
     */
    drainMs: env.COOPER_DRAIN_MS,
    /**
     * `COOPER_TRUST_PROXY`: how many proxies in front of it add to `X-Forwarded-For`, so
     * the rate limits by address count the person's, not the proxy's: 1 behind
     * Coolify's. None unless told.
     */
    trustProxy: env.COOPER_TRUST_PROXY,
    /**
     * `COOPER_OTLP_URL`: an OpenTelemetry collector (OTLP over HTTP,
     * `http://localhost:4318`) the traces go to instead, as service `cooper`.
     */
    otlpUrl: env.COOPER_OTLP_URL,
    /**
     * What cooper tells whoever monitors it (newt-kit/monitor), on a port of its own with no
     * public address: only when `COOPER_MONITOR_KEY` gives the key the monitor signs its
     * requests with (32 characters or more), never sent.
     */
    monitor: {
      key: env.COOPER_MONITOR_KEY,
      /**
       * `COOPER_REDIS_URL`: the Redis every instance of cooper shares, for its metrics
       * and the monitor's nonces. None for one instance: each counts in its memory.
       */
      redisUrl: env.COOPER_REDIS_URL,
      /** `COOPER_MONITOR_PORT`: 3010. */
      port: env.COOPER_MONITOR_PORT,
      /** `COOPER_MONITOR_HOSTNAME`: this machine only, unless told; the image says `0.0.0.0`, for the monitor's container. */
      hostname: env.COOPER_MONITOR_HOSTNAME,
      /** `COOPER_DISKS`: the disks the monitor is told of, by path, comma separated: `/` unless told. */
      disks: env.COOPER_DISKS?.split(',').map(path => path.trim()).filter(Boolean),
    },
  }
}

/** cooper's settings, from its process's environment. */
export const config = readConfig(process.env)

export type Config = ReturnType<typeof readConfig>
