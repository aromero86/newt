import { isAbsolute, join } from 'node:path'

const root = join(import.meta.dir, '../..')

/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) ? path : join(root, path))

const env = process.env

/**
 * cooper's settings, from environment variables, with what development needs by
 * default. Each context has its own: where it listens and where its data lives.
 */
export const config = {
  /** The SaaS: workspaces' boards, columns and cards. */
  boards: {
    /** `COOPER_BOARDS_PORT`: where it listens. */
    port: Number(env.COOPER_BOARDS_PORT ?? 3002),
    /** `COOPER_BOARDS_FOLDER`: the folder of its files, for now (chapter 5 moves it to SQLite). */
    folder: fromRoot(env.COOPER_BOARDS_FOLDER ?? 'data/boards'),
  },
}

export type Config = typeof config
