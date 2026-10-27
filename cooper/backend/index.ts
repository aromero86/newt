// bun cooper/backend/index.ts: cooper's backend. Every context in one process, each one
// served on its own port, with the worker of its jobs running, until SIGINT or SIGTERM.
import { runContexts } from 'newt/application'
import { serveMonitor } from 'newt/monitor'
import { config } from './config'
import { cooperTracer, openContexts } from './open-contexts'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()
const contexts = await openContexts(config)

// One tracer for every context: a request, and the use cases it calls in any context, is one trace.
// Stopping, each server's health answers 503 for a moment before it closes.
const app = runContexts(contexts.all.map(context => ({ context, serve: { ...context.serving(), drainMs: config.drainMs } })), { tracer: cooperTracer(config) })
for (const [name, server] of Object.entries(app.servers)) console.log(`${name} listening on ${server.url}`)

// What cooper is made of, for whoever monitors it: only with a key, on a port no domain points at.
if (config.monitor.key) {
  const monitor = serveMonitor(contexts.all, { name: 'cooper', port: config.monitor.port, hostname: config.monitor.hostname, key: config.monitor.key })
  console.log(`monitor listening on ${monitor.url}`)
}
