// bun run monitor: the monitor in development, its frontend served from its sources,
// which Bun builds as it serves them and reloads as they change. Its user, password and
// secret come from the environment (or .env), as in production.
import { main } from '../src/main'

try {
  await main({ ...process.env, NEWT_MONITOR_FRONTEND_SOURCES: '1' })
} catch (error) {
  console.error(`newt-monitor: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
