// The backend alone. With --watch, it restarts on every change.
const watch = Bun.argv.includes('--watch')
const backend = Bun.spawn(['bun', ...(watch ? ['--watch'] : []), 'src/backend/index.ts'], { stdio: ['inherit', 'inherit', 'inherit'] })
process.exit(await backend.exited)
