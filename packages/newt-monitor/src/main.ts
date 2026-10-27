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
  const app = runContexts([{ context: monitor, serve: monitor.serving() }])
  console.log(`newt-monitor listening on ${app.servers.monitor!.url}`)
  return app
}
