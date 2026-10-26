import { isAbsolute, join } from 'node:path'

const root = join(import.meta.dir, '../..')

/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) || path === ':memory:' ? path : join(root, path))

const env = process.env

/**
 * `COOPER_<CONTEXT>_PUBLIC_URL`: where people open each context. In development it is
 * its frontend's Vite server, which sends the API's addresses on to the context's port;
 * in production, the context's own domain, in front of its port.
 */
const publicUrls = {
  boards: env.COOPER_BOARDS_PUBLIC_URL ?? 'http://localhost:5172',
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
