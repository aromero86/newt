import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { mapPage, type Page, type PageRequest } from 'newt/core'
import { z } from 'zod'
import type { Monitor_Modules } from '../initialize-modules'
import { BUCKETS, WINDOWS, type MetricsBucket, type MetricsWindow } from '../modules/event-metrics/event-metrics.schema'

/** Every tool only reads: the monitor's own data, never an application's. */
const READ_ONLY = { readOnlyHint: true, openWorldHint: false }

const appId = z.string().describe('The application\'s id, from list_apps')
const window = z.enum(Object.keys(WINDOWS) as [MetricsWindow, ...MetricsWindow[]]).default('24h').describe('How far back: 1h, 24h, 7d, 30d, 90d or 365d')
const bucket = z.enum(Object.keys(BUCKETS) as [MetricsBucket, ...MetricsBucket[]]).optional().describe('How long each point is: 1m, 5m, 15m, 1h or 1d, one the window allows; its default otherwise')
const pageArgs = {
  cursor: z.string().optional().describe('The nextCursor of the page before, to read the next one'),
  size: z.number().int().min(1).max(100).optional().describe('How many items, 20 by default'),
}

const pageOf = (args: { cursor?: string | undefined, size?: number | undefined }): PageRequest => ({ size: args.size ?? 20, cursor: args.cursor })

/** A page as a tool answers it: with the cursor of the next one, if there is one. */
function paged<T, R>(page: Page<T>, map: (item: T) => R) {
  const { items, total, nextCursor } = mapPage(page, map)
  return { items, total, nextCursor: nextCursor ?? null }
}

/** What a tool returns: its answer as JSON, for the assistant to read. */
const answer = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] })

/**
 * The monitor's tools, for the person whose token the assistant brings. Like the
 * routes, they only call use cases, and only those that read what the monitor has
 * collected: none changes an application, nor asks one anything.
 */
export function registerMcpTools(server: McpServer, modules: Monitor_Modules): void {
  const { app, connection, structure, useCaseMetrics, useCaseErrors, eventMetrics, queueMetrics, outbox, traces, instances } = modules

  server.registerTool('list_apps', {
    title: 'List applications',
    description: 'The newt applications the monitor watches, archived ones too, with whether each answers now. Every other tool takes the id of one.',
    inputSchema: { ...pageArgs },
    annotations: READ_ONLY,
  }, async args => {
    const page = await app.list({}, pageOf(args))
    const statuses = await Promise.all(page.items.map(each => connection.status(each.id)))
    return answer(paged({ ...page, items: page.items.map((each, index) => ({ each, status: statuses[index]! })) }, ({ each, status }) => ({
      id: each.id, name: each.name, url: each.url, archived: each.archivedAt !== null, connection: status.status, checkedAt: status.checkedAt,
    })))
  })

  server.registerTool('get_structure', {
    title: 'Get an application\'s structure',
    description: 'What an application is made of, as its last read version says: its contexts, the contexts each uses, their modules, use cases, events, queues and schedules.',
    inputSchema: { appId },
    annotations: READ_ONLY,
  }, async args => answer(await structure.latest(args.appId)))

  server.registerTool('list_versions', {
    title: 'List an application\'s versions',
    description: 'The versions of an application\'s structure, newest first: each one is a deployment that changed what it is made of.',
    inputSchema: { appId, ...pageArgs },
    annotations: READ_ONLY,
  }, async args => answer(paged(await structure.history(args.appId, pageOf(args)), each => each)))

  server.registerTool('use_case_totals', {
    title: 'Use cases over a window',
    description: 'Each use case of an application over a window: how often it ran, how long it took (p50, p90, p99), how many ended in an error (expected) or a failure (unexpected), and how many ran again after a conflict.',
    inputSchema: { appId, window },
    annotations: READ_ONLY,
  }, async args => answer(await useCaseMetrics.totals(args.appId, { window: args.window })))

  server.registerTool('use_case_series', {
    title: 'A use case over time',
    description: 'How a use case (or all of them, without context and useCase) went in each bucket of a window, compared with the window before: calls, latencies, errors and failures.',
    inputSchema: {
      appId,
      context: z.string().optional().describe('The use case\'s context; with useCase'),
      useCase: z.string().optional().describe('The use case, as `<module>.<useCase>`; with context'),
      window,
      bucket,
    },
    annotations: READ_ONLY,
  }, async ({ appId: id, ...query }) => answer(await useCaseMetrics.series(id, query)))

  server.registerTool('errors_totals', {
    title: 'Errors over a window',
    description: 'Each use case of an application that ended in an error (expected, a domain error) or a failure (unexpected) over a window, and how many.',
    inputSchema: { appId, window },
    annotations: READ_ONLY,
  }, async args => answer(await useCaseErrors.totals(args.appId, { window: args.window })))

  server.registerTool('error_codes', {
    title: 'A use case\'s errors by code',
    description: 'The errors and failures of one use case over a window, by code, with how many and when the last one was.',
    inputSchema: { appId, context: z.string().describe('The use case\'s context'), useCase: z.string().describe('The use case, as `<module>.<useCase>`'), window },
    annotations: READ_ONLY,
  }, async ({ appId: id, ...query }) => answer(await useCaseErrors.codes(id, query)))

  server.registerTool('event_totals', {
    title: 'Events over a window',
    description: 'Each domain event of an application over a window: how many times it was told.',
    inputSchema: { appId, window },
    annotations: READ_ONLY,
  }, async args => answer(await eventMetrics.totals(args.appId, { window: args.window })))

  server.registerTool('queues', {
    title: 'Queues now and over a window',
    description: 'Each queue of an application: how many jobs are ready, running, to run again and dead now, how old the oldest waiting one is, and how many went in and out over a window.',
    inputSchema: { appId, window },
    annotations: READ_ONLY,
  }, async args => answer({ now: await outbox.now(args.appId), totals: await queueMetrics.totals(args.appId, { window: args.window }) }))

  server.registerTool('dead_jobs', {
    title: 'Dead jobs of a context',
    description: 'The jobs of a context that ran out of attempts, as the application lists them now: their queue, event, attempts and last error. Never their payloads.',
    inputSchema: {
      appId,
      context: z.string().describe('The context whose jobs to list'),
      after: z.string().optional().describe('The id of the last job of the page before'),
      limit: z.number().int().min(1).max(100).optional().describe('How many, 50 by default'),
    },
    annotations: READ_ONLY,
  }, async ({ appId: id, ...query }) => answer(await outbox.deadJobs(id, query)))

  server.registerTool('list_traces', {
    title: 'List traces',
    description: 'The traces kept of an application over a window, newest first: each run of a use case, a job or a request, how long it took and how it ended. Filtered by context, use case, queue or job, and by what to show.',
    inputSchema: {
      appId,
      window,
      context: z.string().optional(),
      useCase: z.string().optional().describe('As `<module>.<useCase>`; with context'),
      queue: z.string().optional(),
      show: z.enum(['all', 'failures', 'errors', 'retried', 'forced', 'logged', 'slow']).optional().describe('Which ones: all by default'),
      before: z.string().optional().describe('The cursor of the page before'),
      limit: z.number().int().min(1).max(100).optional().describe('How many, 50 by default'),
    },
    annotations: READ_ONLY,
  }, async ({ appId: id, ...query }) => answer(await traces.list(id, query)))

  server.registerTool('get_trace', {
    title: 'Get a trace',
    description: 'One trace in full: every use case, job and query it went through, how long each took, what each called, and the error it ended in, if any.',
    inputSchema: { appId, traceId: z.string().describe('The trace\'s id, from list_traces') },
    annotations: READ_ONLY,
  }, async args => answer(await traces.get(args.appId, args.traceId)))

  server.registerTool('system_and_instances', {
    title: 'The system and its instances now',
    description: 'How an application\'s system is now, whatever machines it runs on: its instances alive, the memory and processor its processes take added up, its worst event loop, the fullest memory and busiest processors of its machines, and each disk with in how many days it fills. Then its instances: alive, or gone in the last day.',
    inputSchema: { appId },
    annotations: READ_ONLY,
  }, async args => answer(await instances.list(args.appId)))

  server.registerTool('system_series', {
    title: 'The system over time',
    description: 'An application\'s system in each bucket of a window, the same line across deployments: the memory and processor its processes took, its worst event loop, and its machines\' memory, processors\' usage and load, and each disk\'s free space.',
    inputSchema: { appId, window, bucket },
    annotations: READ_ONLY,
  }, async ({ appId: id, ...query }) => answer(await instances.system(id, query)))
}
