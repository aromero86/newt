import { isAbsolute, join } from 'node:path'

const root = join(import.meta.dir, '../..')

/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) || path === ':memory:' ? path : join(root, path))

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
 * default. Each context has its own: where it listens, where its database lives and
 * where people open it.
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
    /** `COOPER_AUTH_DATABASE`: its database, a SQLite file. */
    database: fromRoot(env.COOPER_AUTH_DATABASE ?? 'data/cooper-auth.db'),
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
  },
  /** The SaaS: workspaces' boards, columns and cards. */
  boards: {
    /** `COOPER_BOARDS_PORT`: where it listens. */
    port: Number(env.COOPER_BOARDS_PORT ?? 3002),
    /** `COOPER_BOARDS_DATABASE`: its database, a SQLite file. */
    database: fromRoot(env.COOPER_BOARDS_DATABASE ?? 'data/cooper-boards.db'),
    publicUrl: publicUrls.boards,
  },
}

export type Config = typeof config
