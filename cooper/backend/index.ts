// bun cooper/backend/index.ts: cooper's backend. Every context in one process, each one
// served on its own port, with the worker of its jobs running, until SIGINT or SIGTERM.
import { runContexts } from 'newt/application'
import { RedisNonces, serveMonitor } from 'newt/monitor'
import { RedisEventMetrics, setEventMetrics } from 'newt/runtime'
import { config } from './config'
import { frontendSources } from './frontend-sources'
import { cooperTracer, openContexts } from './open-contexts'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()
// Several instances count their events in one Redis; one alone, in its memory.
if (config.monitor.redisUrl) setEventMetrics(new RedisEventMetrics({ url: config.monitor.redisUrl, prefix: 'cooper:metrics' }))
const contexts = await openContexts(config)

// In development each context serves its frontend from its sources, as Bun builds them.
const sources = config.frontendSources ? await frontendSources() : null

// One tracer for every context: a request, and the use cases it calls in any context, is one trace.
// Stopping, each server's health answers 503 for a moment before it closes.
const app = runContexts(contexts.all.map(context => ({
  context,
  serve: { ...context.serving(), drainMs: config.drainMs, ...(sources?.[context.name] ? { ...sources[context.name], development: true } : {}) },
})), { tracer: cooperTracer(config) })
for (const [name, server] of Object.entries(app.servers)) console.log(`${name} listening on ${server.url}`)

// What cooper is made of, for whoever monitors it: only with a key, on a port no domain points at.
if (config.monitor.key) {
  const nonces = config.monitor.redisUrl ? new RedisNonces({ url: config.monitor.redisUrl, prefix: 'cooper:monitor:nonce' }) : undefined
  const monitor = serveMonitor(contexts.all, { name: 'cooper', port: config.monitor.port, hostname: config.monitor.hostname, key: config.monitor.key, nonces })
  console.log(`monitor listening on ${monitor.url}`)
}
