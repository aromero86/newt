import { Base } from './base/base'
import { serveFrontend } from './base/http/serve-frontend'
import { config } from './config'
import { Credential_Module } from './modules/credential/credential.module'
import { Health_Module } from './modules/health/health.module'
import { Session_Module } from './modules/session/session.module'
import { User_Module } from './modules/user/user.module'

// Opening the base brings the database up to date before anything reads it.
const base = await Base.open(config)

// Modules in dependency order: each one after every module it depends on.
await Health_Module.initialize(base)
const user = await User_Module.initialize(base)
const credential = await Credential_Module.initialize(base)
await Session_Module.initialize(base, { user, credential }, { days: config.sessionDays })

const server = Bun.serve({ port: config.port, routes: base.http.routes(), fetch: serveFrontend(config.frontendFolder) })
console.log(`Server listening on port ${config.port}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await server.stop()
    base.close()
    process.exit(0)
  })
}
