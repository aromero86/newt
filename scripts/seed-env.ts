// Writes `.env` with every setting the project reads. Run it once after cloning:
// it creates the file, or adds the settings it is missing, and never changes a
// value that is already there. Bun loads `.env` on its own.
import { join } from 'node:path'

type Setting = {
  key: string
  /** What it is for: written above it in `.env`. */
  note: string
  /** Its value when it is missing. Secrets generate a new one each time. */
  initial: () => string
}

const SETTINGS: Setting[] = [
  { key: 'API_PORT', note: 'Port of the backend, and of the API the frontend dev server proxies to.', initial: () => '3000' },
  { key: 'NEWT_DB_PATH', note: 'The SQLite database file, relative to the repository root.', initial: () => 'data/newt.db' },
  { key: 'NEWT_SESSION_DAYS', note: 'How long a session lasts without signing in again, in days.', initial: () => '30' },
]

const file = Bun.file(join(import.meta.dir, '../.env'))
const existing = (await file.exists()) ? await file.text() : ''
const present = new Set(
  existing.split('\n').map(line => line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1]).filter(key => key !== undefined),
)

const missing = SETTINGS.filter(setting => !present.has(setting.key))
if (missing.length === 0) {
  console.log('.env already has every setting')
  process.exit(0)
}

const added = missing.map(setting => `# ${setting.note}\n${setting.key}=${setting.initial()}`).join('\n\n')
const separator = existing === '' ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
await Bun.write(file, `${existing}${separator}${added}\n`)

console.log(`${existing === '' ? 'Created' : 'Updated'} .env with: ${missing.map(setting => setting.key).join(', ')}`)
