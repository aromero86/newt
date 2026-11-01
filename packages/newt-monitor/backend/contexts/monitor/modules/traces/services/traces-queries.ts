import type { Trace } from 'newt-kit/contract'
import type { DuckDbAnalytics, DuckDbParam } from 'newt-kit/adapter-duckdb'
import { WINDOWS } from '../../event-metrics/event-metrics.schema'
import type { TraceDTO, TraceListDTO, TraceListQuerySchema, TraceSummaryDTO } from '../traces.schema'
import type { z } from 'zod'

/** A row of `traces` as DuckDB gives it. */
type TraceRow = {
  id: string, started_at: string, kind: 'http' | 'job', name: string, ms: number, outcome_kind: 'error' | 'failure' | null, outcome_code: string | null,
  retried: boolean, forced: string | null, actor: string | null, use_cases: string | string[], job_event?: string | null, job_queue: string | null, job_run: number | null, event_id: string | null, call_ms?: number | null, body?: string | Trace,
}

const COLUMNS = 't.id, t.started_at, t.kind, t.name, t.ms, t.outcome_kind, t.outcome_code, t.retried, t.body->>\'$.forced\' AS forced, t.actor, t.use_cases, t.job_queue, t.job_run, t.event_id, t.body->>\'$.job.event\' AS job_event'

const parsed = <T>(value: string | T): T => (typeof value === 'string' ? JSON.parse(value) as T : value)

function summaryOf(row: TraceRow): TraceSummaryDTO {
  return {
    id: row.id, kind: row.kind, name: row.name, startedAt: row.started_at, ms: row.ms,
    outcome: row.outcome_kind ? { kind: row.outcome_kind, code: row.outcome_code! } : null,
    retried: row.retried, forced: row.forced ?? null, actor: row.actor, useCases: parsed<string[]>(row.use_cases),
    job: row.job_queue ? { queue: row.job_queue, run: row.job_run!, event: row.job_event ?? '', eventId: row.event_id! } : null,
    callMs: row.call_ms ?? null,
  }
}

/** A page's cursor: the last trace's start and id, as one string. */
const cursorOf = (row: TraceRow) => `${row.started_at}|${row.id}`

/**
 * What a page reads of an application's traces, in DuckDB's SQL: a list by what they
 * did and how they went, and one whole with what it is linked to.
 */
export class TracesQueries {

  constructor(private readonly analytics: DuckDbAnalytics) {}

  async list(query: z.output<typeof TraceListQuerySchema>, now: Date): Promise<TraceListDTO> {
    const params: DuckDbParam[] = [new Date(now.getTime() - WINDOWS[query.window].ms).toISOString()]
    const param = (value: DuckDbParam) => `$${params.push(value)}`
    const where = ['t.started_at >= CAST($1 AS TIMESTAMP)']
    // A use case's: its longest call in each trace, which is what its time is sorted by.
    const from = query.useCase
      ? `traces t JOIN (SELECT trace_id, max(ms) AS call_ms FROM trace_call WHERE context = ${param(query.context!)} AND use_case = ${param(query.useCase)} GROUP BY trace_id) c ON c.trace_id = t.id`
      : 'traces t'
    if (query.queue) where.push(`t.job_queue = ${param(query.queue)}`)
    if (query.job) where.push(`t.job_id = ${param(query.job)}`)
    if (query.told) where.push(`t.id IN (SELECT trace_id FROM trace_event WHERE context = ${param(query.context!)} AND event = ${param(query.told)})`)
    if (query.show === 'failures') where.push('t.outcome_kind = \'failure\'')
    if (query.show === 'errors') where.push('t.outcome_kind = \'error\'')
    if (query.show === 'retried') where.push('t.retried')
    if (query.show === 'logged') where.push('t.id IN (SELECT trace_id FROM trace_log WHERE level IN (\'warn\', \'error\'))')
    if (query.show === 'forced') where.push('(t.body->>\'$.forced\') IS NOT NULL')
    const time = query.useCase ? 'c.call_ms' : 't.ms'
    const byTime = query.nearMs !== undefined || query.show === 'slow'
    if (!byTime && query.before) {
      const [startedAt, id] = query.before.split('|')
      where.push(`(t.started_at < CAST(${param(startedAt!)} AS TIMESTAMP) OR (t.started_at = CAST($${params.length} AS TIMESTAMP) AND t.id < ${param(id!)}))`)
    }
    const order = query.nearMs !== undefined ? `abs(${time} - ${param(query.nearMs)})` : query.show === 'slow' ? `${time} DESC` : 't.started_at DESC, t.id DESC'
    const rows = await this.analytics.query<TraceRow>(
      `SELECT ${COLUMNS}${query.useCase ? ', c.call_ms' : ''} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${param(query.limit + 1)}`, params)
    const page = rows.slice(0, query.limit)
    return { traces: page.map(summaryOf), next: !byTime && rows.length > query.limit ? cursorOf(page.at(-1)!) : null }
  }

  async get(traceId: string): Promise<TraceDTO | null> {
    const [row] = await this.analytics.query<TraceRow & { body: string | Trace, job_id: string | null }>(`SELECT ${COLUMNS}, t.body, t.job_id FROM traces t WHERE t.id = $1`, [traceId])
    if (!row) return null
    const trace = parsed<Trace>(row.body)
    const [causedBy] = row.event_id
      ? await this.analytics.query<TraceRow>(`SELECT ${COLUMNS} FROM trace_event r JOIN traces t ON t.id = r.trace_id WHERE r.event_id = $1 LIMIT 1`, [row.event_id])
      : []
    const caused = trace.told.length
      ? await this.analytics.query<TraceRow>(`SELECT ${COLUMNS} FROM traces t WHERE t.event_id IN (SELECT event_id FROM trace_event WHERE trace_id = $1) ORDER BY t.started_at LIMIT 50`, [traceId])
      : []
    const runs = row.job_id
      ? await this.analytics.query<TraceRow>(`SELECT ${COLUMNS} FROM traces t WHERE t.job_id = $1 ORDER BY t.job_run`, [row.job_id])
      : []
    return { ...trace, causedBy: causedBy ? summaryOf(causedBy) : null, caused: caused.map(summaryOf), runs: runs.map(summaryOf) }
  }
}
