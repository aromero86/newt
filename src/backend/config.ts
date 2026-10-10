import { join } from 'node:path'

const root = join(import.meta.dir, '../..')

/** Where the backend keeps its data. `NEWT_DB_PATH` moves the database file. */
export const config = {
  dbPath: process.env.NEWT_DB_PATH ?? join(root, 'data/newt.db'),
  migrationsFolder: join(import.meta.dir, 'migrations'),
  /** The built frontend the server hands out. */
  frontendFolder: join(root, 'dist/frontend'),
}
