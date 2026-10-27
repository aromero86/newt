import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DuckDbAnalytics } from 'newt/adapter-duckdb'
import type { EventCount } from 'newt/contract'

/** Each minute's counts, with their actor: the detail. */
const EVENT_MINUTE = { columns: { minute: 'TIMESTAMP', context: 'VARCHAR', event: 'VARCHAR', scopes: 'JSON', actor: 'VARCHAR', count: 'INTEGER' } } as const
/** Each day's counts, without actor: what stays once the detail is gone. */
const EVENT_DAY = { columns: { day: 'DATE', context: 'VARCHAR', event: 'VARCHAR', scopes: 'JSON', count: 'BIGINT' } } as const

/** Scopes as one text, the same whatever order they came in: part of a row's id. */
export function scopesText(scopes: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(scopes).sort(([a], [b]) => a.localeCompare(b))))
}

/**
 * Where the monitor keeps each application's metrics: a DuckDB of its own, in a folder
 * (`<folder>/<appId>.duckdb`), or in memory. A count collected twice is kept once: its
 * id is its minute, context, event, scopes and actor.
 */
export class MetricsStore {

  private readonly opened = new Map<string, Promise<DuckDbAnalytics>>()

  constructor(private readonly folder: string) {}

  /** An application's DuckDB, opened the first time it is asked for. */
  of(appId: string): Promise<DuckDbAnalytics> {
    let analytics = this.opened.get(appId)
    if (!analytics) {
      analytics = DuckDbAnalytics.open({ path: this.pathOf(appId), datasets: { event_minute: EVENT_MINUTE, event_day: EVENT_DAY } })
      this.opened.set(appId, analytics)
    }
    return analytics
  }

  async append(appId: string, counts: EventCount[]): Promise<void> {
    const rows = counts.map(count => {
      const scopes = scopesText(count.scopes)
      // The column is JSON: the object goes in as it is, its keys in order, so a day's sum groups it as one.
      return { id: `${count.minute}|${count.context}|${count.event}|${scopes}|${count.actor ?? ''}`, ...count, scopes: JSON.parse(scopes) as Record<string, string> }
    })
    await (await this.of(appId)).append('event_minute', rows)
  }

  /** Sums every whole day before `day` into the daily summary: a day summed already is left as it is. */
  async summarize(appId: string, day: string): Promise<void> {
    await (await this.of(appId)).run(`
      INSERT INTO event_day (id, day, context, event, scopes, count)
      SELECT strftime(CAST(minute AS DATE), '%Y-%m-%d') || '|' || context || '|' || event || '|' || CAST(scopes AS VARCHAR),
             CAST(minute AS DATE), context, event, scopes, sum(count)
      FROM event_minute WHERE minute < CAST($1 AS DATE)
      GROUP BY CAST(minute AS DATE), context, event, scopes
      ON CONFLICT DO NOTHING`, [day])
  }

  /** Forgets the minutes before one time, and the days before another (none, if null). */
  async forget(appId: string, minutesBefore: string, daysBefore: string | null): Promise<void> {
    const analytics = await this.of(appId)
    await analytics.run('DELETE FROM event_minute WHERE minute < CAST($1 AS TIMESTAMP)', [minutesBefore])
    if (daysBefore !== null) await analytics.run('DELETE FROM event_day WHERE day < CAST($1 AS DATE)', [daysBefore])
  }

  /** Everything of an application, for good: its DuckDB closed and its file gone. */
  async drop(appId: string): Promise<void> {
    const analytics = this.opened.get(appId)
    this.opened.delete(appId)
    if (analytics) await (await analytics).close()
    if (this.folder !== ':memory:') {
      for (const file of [this.pathOf(appId), `${this.pathOf(appId)}.wal`]) await rm(file, { force: true })
    }
  }

  async close(): Promise<void> {
    const all = [...this.opened.values()]
    this.opened.clear()
    for (const analytics of all) await (await analytics).close()
  }

  private pathOf(appId: string): string {
    return this.folder === ':memory:' ? ':memory:' : join(this.folder, `${appId}.duckdb`)
  }
}
