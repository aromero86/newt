import { isAbsolute, join } from 'node:path'

const root = join(import.meta.dir, '../..')

/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) || path === ':memory:' ? path : join(root, path))

/** The backend's settings, from environment variables (`bun run seed:env` writes them to `.env`). */
export const config = {
  /** `API_PORT`: where the backend listens. */
  port: Number(process.env.API_PORT ?? 3000),
  /** `NEWT_DB_PATH`: the database file. */
  dbPath: fromRoot(process.env.NEWT_DB_PATH ?? 'data/newt.db'),
  migrationsFolder: join(import.meta.dir, 'migrations'),
  /** `NEWT_SESSION_DAYS`: how long a session lasts without signing in again. */
  sessionDays: Number(process.env.NEWT_SESSION_DAYS ?? 30),
  /** The built frontend the server hands out. */
  frontendFolder: join(root, 'dist/frontend'),
}
