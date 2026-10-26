// bun cooper/backend/index.ts: cooper's backend. Every context in one process, each one
// served on its own port, with the worker of its jobs running.
import { config } from './config'
import { setTracer } from 'newt/core'
import { cooperTracer, openContexts, stopContexts } from './open-contexts'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()
// One tracer for every context: a request, and the use cases it calls in any context, is one trace.
const tracer = cooperTracer(config)
if (tracer) setTracer(tracer)
const contexts = await openContexts(config)

const servers = contexts.all.map(context => {
  const server = context.serve()
  console.log(`${context.name} listening on ${server.url}`)
  return server
})
for (const context of contexts.all) context.start()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await Promise.all(servers.map(server => server.stop()))
    await stopContexts(contexts)
    process.exit(0)
  })
}
