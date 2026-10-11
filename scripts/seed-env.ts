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
  { key: 'NEWT_PUBLIC_URL', note: 'Where people open newt: links in emails point there.', initial: () => 'http://localhost:5173' },
  { key: 'NEWT_PASSWORD_RESET_MINUTES', note: 'How long a password reset link works, in minutes.', initial: () => '60' },
  { key: 'NEWT_INVITATION_DAYS', note: 'How long a workspace invitation waits for the person to sign up, in days.', initial: () => '7' },
  { key: 'NEWT_EMBEDDINGS_MODEL', note: 'The model that finds things by their meaning, from Hugging Face; downloaded the first time (about 560 MB).', initial: () => 'Snowflake/snowflake-arctic-embed-l-v2.0' },
  { key: 'NEWT_MODELS_PATH', note: 'Where downloaded models are kept, relative to the repository unless absolute.', initial: () => 'data/models' },
  { key: 'NEWT_LLM_PROVIDER', note: 'The language model that reads proposals: claude-cli runs `claude -p` with this machine\'s Claude Code session; anthropic-api needs NEWT_ANTHROPIC_API_KEY.', initial: () => 'claude-cli' },
  { key: 'NEWT_LLM_MODEL', note: 'The model, as the provider names it (sonnet, claude-sonnet-5-5…); empty for its default.', initial: () => '' },
  { key: 'NEWT_ANTHROPIC_API_KEY', note: 'For NEWT_LLM_PROVIDER=anthropic-api.', initial: () => '' },
  { key: 'NEWT_SMTP_HOST', note: 'SMTP server emails leave from: a local one in development, e.g. smtp.sendgrid.net in production.', initial: () => 'localhost' },
  { key: 'NEWT_SMTP_PORT', note: 'SMTP port: usually 587 (STARTTLS) or 465 (TLS); local servers often use 1025.', initial: () => '1025' },
  { key: 'NEWT_SMTP_SECURE', note: 'true for TLS from the first byte (port 465); false uses STARTTLS when offered.', initial: () => 'false' },
  { key: 'NEWT_SMTP_USER', note: 'SMTP user; empty when the server needs no login (with SendGrid it is the literal "apikey").', initial: () => '' },
  { key: 'NEWT_SMTP_PASSWORD', note: 'SMTP password; empty when the server needs no login (with SendGrid, the API key).', initial: () => '' },
  { key: 'NEWT_MAIL_FROM', note: 'The sender of every email.', initial: () => '"newt <no-reply@newt.local>"' },
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
