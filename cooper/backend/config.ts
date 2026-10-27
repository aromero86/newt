import { isAbsolute, join } from 'node:path'

const root = join(import.meta.dir, '../..')

/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) || path === ':memory:' ? path : join(root, path))

/**
 * A context's database from the environment: a Postgres address
 * (`postgres://user:password@host:5432/db`) as it is, or a SQLite file, relative to
 * the repository root.
 */
const database = (value: string) => (/^postgres(ql)?:\/\//.test(value) ? value : fromRoot(value))

const env = process.env

/** `COOPER_SESSION_DAYS`: how long a browser session lasts without signing in again, in every context. */
const sessionDays = Number(env.COOPER_SESSION_DAYS ?? 30)

/**
 * `COOPER_<CONTEXT>_PUBLIC_URL`: where people open each context. In development it is
 * its frontend's Vite server, which sends the API's addresses on to the context's port;
 * in production, the context's own domain, in front of its port.
 */
const publicUrls = {
  auth: env.COOPER_AUTH_PUBLIC_URL ?? 'http://localhost:5171',
  boards: env.COOPER_BOARDS_PUBLIC_URL ?? 'http://localhost:5172',
  backoffice: env.COOPER_BACKOFFICE_PUBLIC_URL ?? 'http://localhost:5173',
}

/**
 * `COOPER_<APP>_CLIENT_SECRET`: the secret each web app proves itself with at auth's
 * token endpoint, as an OAuth confidential client. `auth` knows both; each app its own.
 * Each is kept under the id of the product it signs people in to, its client_id, as
 * auth looks it up; its variable is named after the app, as the people deploying it
 * know it: boards' is `COOPER_BOARDS_CLIENT_SECRET`, for the product `cooper`.
 */
const clientSecrets = {
  cooper: env.COOPER_BOARDS_CLIENT_SECRET ?? 'cooper-dev-boards-client-secret',
  backoffice: env.COOPER_BACKOFFICE_CLIENT_SECRET ?? 'cooper-dev-backoffice-client-secret',
}

/**
 * cooper's settings, from environment variables, with what development needs by
 * default. Each context has its own: where it listens, where its database lives,
 * where people open it and the built frontend it serves.
 */
export const config = {
  /** `COOPER_MAIL_FROM`: who the emails come from, whichever context sends them. */
  mail: {
    from: env.COOPER_MAIL_FROM ?? 'cooper <no-reply@cooper.local>',
  },
  /** Who someone is: accounts, workspaces, who may enter what, and the OAuth server every app signs in with. */
  auth: {
    /** `COOPER_AUTH_PORT`: where it listens. */
    port: Number(env.COOPER_AUTH_PORT ?? 3001),
    /** `COOPER_AUTH_DATABASE`: its database, a SQLite file or a Postgres address. */
    database: database(env.COOPER_AUTH_DATABASE ?? 'data/cooper-auth.db'),
    publicUrl: publicUrls.auth,
    /** Where the other contexts are opened: the apps that sign people in through it. */
    boardsPublicUrl: publicUrls.boards,
    backofficePublicUrl: publicUrls.backoffice,
    /** The secret of each app's OAuth client, by the product it signs people in to. */
    clientSecrets,
    sessionDays,
    /** `COOPER_INVITATION_DAYS`: how long an invitation to a workspace waits to be accepted. */
    invitationDays: Number(env.COOPER_INVITATION_DAYS ?? 7),
    oauth: {
      /** `COOPER_OAUTH_ACCESS_MINUTES`: how long an access token lasts; the client refreshes it after. */
      accessMinutes: Number(env.COOPER_OAUTH_ACCESS_MINUTES ?? 60),
      /** `COOPER_OAUTH_REFRESH_DAYS`: how long a refresh token lasts unused. */
      refreshDays: Number(env.COOPER_OAUTH_REFRESH_DAYS ?? 30),
    },
    /** `COOPER_AUTH_FRONTEND`: its built frontend (`bun run cooper:build`). */
    frontendFolder: fromRoot(env.COOPER_AUTH_FRONTEND ?? 'dist/cooper/auth'),
  },
  /** The SaaS: workspaces' boards, columns and cards, on the web and through MCP. */
  boards: {
    /** `COOPER_BOARDS_PORT`: where it listens. */
    port: Number(env.COOPER_BOARDS_PORT ?? 3002),
    /** `COOPER_BOARDS_DATABASE`: its database, a SQLite file or a Postgres address. */
    database: database(env.COOPER_BOARDS_DATABASE ?? 'data/cooper-boards.db'),
    publicUrl: publicUrls.boards,
    /** Where its people sign in. */
    authPublicUrl: publicUrls.auth,
    /** Its OAuth client's secret: boards is the product `cooper` in auth. */
    clientSecret: clientSecrets.cooper,
    sessionDays,
    /** `COOPER_BOARDS_FRONTEND`: its built frontend. */
    frontendFolder: fromRoot(env.COOPER_BOARDS_FRONTEND ?? 'dist/cooper/boards'),
  },
  /** The staff's console. */
  backoffice: {
    /** `COOPER_BACKOFFICE_PORT`: where it listens. */
    port: Number(env.COOPER_BACKOFFICE_PORT ?? 3003),
    /** `COOPER_BACKOFFICE_DATABASE`: its database, a SQLite file or a Postgres address. */
    database: database(env.COOPER_BACKOFFICE_DATABASE ?? 'data/cooper-backoffice.db'),
    publicUrl: publicUrls.backoffice,
    /** Where the staff sign in. */
    authPublicUrl: publicUrls.auth,
    /** Its OAuth client's secret: the product `backoffice` in auth. */
    clientSecret: clientSecrets.backoffice,
    sessionDays,
    /** `COOPER_BACKOFFICE_FRONTEND`: its built frontend. */
    frontendFolder: fromRoot(env.COOPER_BACKOFFICE_FRONTEND ?? 'dist/cooper/backoffice'),
  },
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
  drainMs: Number(env.COOPER_DRAIN_MS ?? 2000),
  /**
   * `COOPER_OTLP_URL`: an OpenTelemetry collector (OTLP over HTTP,
   * `http://localhost:4318`) the traces go to instead, as service `cooper`.
   */
  otlpUrl: env.COOPER_OTLP_URL,
  /**
   * What cooper tells whoever monitors it (newt/monitor), on a port of its own with no
   * public address: only when `COOPER_MONITOR_KEY` gives the key the monitor signs its
   * requests with (32 characters or more), never sent.
   */
  monitor: {
    key: env.COOPER_MONITOR_KEY,
    /** `COOPER_MONITOR_PORT`: 3010. */
    port: Number(env.COOPER_MONITOR_PORT ?? 3010),
    /** `COOPER_MONITOR_HOSTNAME`: this machine only, unless told; the image says `0.0.0.0`, for the monitor's container. */
    hostname: env.COOPER_MONITOR_HOSTNAME ?? '127.0.0.1',
  },
}

export type Config = typeof config
