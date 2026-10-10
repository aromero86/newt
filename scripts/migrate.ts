// Applies, reverts or lists the database migrations by hand. The server applies
// pending ones on its own when it starts.
import { Database } from '../src/backend/base/database/database'
import { MigrationRunner } from '../src/backend/base/database/migration-runner'
import { config } from '../src/backend/config'

const command = Bun.argv[2]
if (command !== 'up' && command !== 'down' && command !== 'status') {
  console.error('Usage: bun run migrate:<up|down|status>')
  process.exit(1)
}

const db = await Database.open(config.dbPath)
const runner = new MigrationRunner(db.sqlite, config.migrationsFolder)

try {
  if (command === 'up') {
    const { applied } = await runner.up()
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'No pending migrations')
  } else if (command === 'down') {
    const { reverted } = await runner.down()
    console.log(reverted ? `Reverted: ${reverted}` : 'No migrations to revert')
  } else {
    const { applied, pending } = await runner.status()
    for (const record of applied) console.log(`applied  ${record.version}_${record.name}  ${record.created_at}`)
    for (const file of pending) console.log(`pending  ${file.version}_${file.name}`)
    if (!applied.length && !pending.length) console.log('No migrations')
  }
} finally {
  db.close()
}
