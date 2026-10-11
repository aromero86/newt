import { Base } from './base/base'
import { serveFrontend } from './base/http/serve-frontend'
import { config } from './config'
import { initializeModules } from './initialize-modules'
import { mcpEntry } from './mcp/mcp'

// Opening the base brings the database up to date before anything reads it.
const base = await Base.open(config)

const modules = await initializeModules(base)

const server = Bun.serve({
  port: config.port,
  routes: { ...base.http.routes(), '/mcp': mcpEntry(modules, config.publicUrl) },
  fetch: serveFrontend(config.frontendFolder),
})
console.log(`Server listening on port ${config.port}`)
await modules.search.startBackground()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await server.stop()
    base.close()
    process.exit(0)
  })
}
