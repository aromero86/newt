// bun cooper/backend/index.ts: cooper's backend. Every context in one process, each one
// served on its own port, with the worker of its jobs running, until SIGINT or SIGTERM.
import { runContexts } from 'newt/application'
import { config } from './config'
import { openContexts } from './open-contexts'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()
const contexts = await openContexts(config)

const app = runContexts(contexts.all.map(context => ({ context, serve: context.serving() })))
for (const [name, server] of Object.entries(app.servers)) console.log(`${name} listening on ${server.url}`)
