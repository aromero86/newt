import { runContexts, type RunningContexts } from 'newt-kit/application'
import { readConfig } from './config'
import { Auth_Context } from './contexts/auth/auth.context'
import { Monitor_Context } from './contexts/monitor/monitor.context'

/**
 * `newt-monitor`: reads its settings from the environment, opens its contexts, `auth`
 * first, and serves both on one port until SIGINT or SIGTERM.
 */
export async function main(env: Record<string, string | undefined>): Promise<RunningContexts> {
  const config = readConfig(env)
  const auth = await Auth_Context.open(config)
  const monitor = await Monitor_Context.open(config, { auth: auth.modules })
  // In development its frontend comes from its sources, as Bun builds them; imported
  // only then, so production never builds it as it starts.
  const sources = config.frontendSources ? { frontend: (await import('../frontend/index.html')).default, development: true } : {}
  const app = runContexts([{ context: auth }, { context: monitor, serve: { ...monitor.serving(auth.routes()), ...sources } }])
  console.log(`newt-monitor listening on ${app.servers.monitor!.url}`)
  return app
}
