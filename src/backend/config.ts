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
  /** `NEWT_PUBLIC_URL`: where people open newt; links in emails point there. */
  publicUrl: process.env.NEWT_PUBLIC_URL ?? 'http://localhost:5173',
  /** `NEWT_PASSWORD_RESET_MINUTES`: how long a password reset link works. */
  passwordResetMinutes: Number(process.env.NEWT_PASSWORD_RESET_MINUTES ?? 60),
  /** `NEWT_SMTP_*` and `NEWT_MAIL_FROM`: the SMTP server emails leave from. */
  mail: {
    host: process.env.NEWT_SMTP_HOST ?? 'localhost',
    port: Number(process.env.NEWT_SMTP_PORT ?? 1025),
    secure: process.env.NEWT_SMTP_SECURE === 'true',
    user: process.env.NEWT_SMTP_USER ?? '',
    password: process.env.NEWT_SMTP_PASSWORD ?? '',
    from: process.env.NEWT_MAIL_FROM ?? 'newt <no-reply@newt.local>',
  },
  /** The built frontend the server hands out. */
  frontendFolder: join(root, 'dist/frontend'),
}
