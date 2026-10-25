// bun examples/notes/main.ts: the notes application on port 3000, its data in ./data/notes.
import { Notes_Context } from './notes.context'

const context = await Notes_Context.open(process.env.NOTES_FOLDER ?? 'data/notes')
const server = context.serve(Number(process.env.PORT ?? 3000))
context.start()
console.log(`notes listening on ${server.url}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await server.stop()
    await context.stop()
    process.exit(0)
  })
}
