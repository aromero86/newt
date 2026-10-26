// bun run cooper:migrations <status|up|down> [--context auth|boards|backoffice]: each
// context's database migrated by hand. The server migrates on its own as it
// opens each context; this is for looking at what is pending, applying it before a
// deploy, or reverting the last one. `status` and `up` go through every context unless
// one is named; `down` reverts one context's last migration, so it needs its name.
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { SqliteStore } from 'newt/adapter-sqlite'
import { config } from '../backend/config'

const CONTEXTS = ['auth', 'boards', 'backoffice'] as const
type ContextName = (typeof CONTEXTS)[number]
const COMMANDS = ['status', 'up', 'down'] as const

const { positionals, values } = parseArgs({ allowPositionals: true, options: { context: { type: 'string' } } })
const [command] = positionals
const named = values.context

if (!COMMANDS.includes(command as (typeof COMMANDS)[number]) || (named !== undefined && !CONTEXTS.includes(named as ContextName))) {
  console.error('Usage: bun run cooper:migrations <status|up|down> [--context auth|boards|backoffice]')
  process.exit(1)
}
if (command === 'down' && named === undefined) {
  console.error('down reverts one context\'s last migration: say which, with --context')
  process.exit(1)
}

const contexts = named === undefined ? CONTEXTS : [named as ContextName]

for (const context of contexts) {
  // `connect` opens the database as it is: `open` would migrate it first.
  const store = await SqliteStore.connect({
    path: config[context].dbPath,
    migrations: join(import.meta.dir, `../backend/contexts/${context}/migrations`),
  })
  try {
    if (command === 'status') {
      const { applied, pending } = await store.migrations.status()
      console.log(`${context}: ${applied.length} applied${applied.length ? ` (last ${applied.at(-1)})` : ''}, ${pending.length} pending${pending.length ? `: ${pending.join(', ')}` : ''}`)
    } else if (command === 'up') {
      const applied = await store.migrations.up()
      console.log(`${context}: ${applied.length ? `applied ${applied.join(', ')}` : 'up to date'}`)
    } else {
      const reverted = await store.migrations.down()
      console.log(`${context}: ${reverted ? `reverted ${reverted}` : 'nothing to revert'}`)
    }
  } finally {
    await store.close()
  }
}
