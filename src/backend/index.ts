import { Base } from './base/base'
import { config } from './config'
import { Note_Module } from './modules/note/note.module'

// Opening the base brings the database up to date before anything reads it.
const base = await Base.open(config)

// Modules in dependency order: each one after every module it depends on.
await Note_Module.initialize(base)

const port = Number(process.env.API_PORT ?? 3000)
const server = Bun.serve({ port, fetch: () => new Response('Hello world') })
console.log(`Server listening on port ${port}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await server.stop()
    base.close()
    process.exit(0)
  })
}
