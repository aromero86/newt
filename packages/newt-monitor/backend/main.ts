import { runContexts, type RunningContexts } from 'newt/application'
import { readConfig } from './config'
import { Monitor_Context } from './contexts/monitor/monitor.context'

/**
 * `newt-monitor`: reads its settings from the environment, opens its context and
 * serves it until SIGINT or SIGTERM.
 */
export async function main(env: Record<string, string | undefined>): Promise<RunningContexts> {
  const config = readConfig(env)
  const monitor = await Monitor_Context.open(config)
  // In development its frontend comes from its sources, as Bun builds them; imported
  // only then, so production never builds it as it starts.
  const sources = config.frontendSources ? { frontend: (await import('../frontend/index.html')).default, development: true } : {}
  const app = runContexts([{ context: monitor, serve: { ...monitor.serving(), ...sources } }])
  console.log(`newt-monitor listening on ${app.servers.monitor!.url}`)
  return app
}
