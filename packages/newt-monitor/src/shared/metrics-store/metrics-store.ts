import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DuckDbAnalytics, type DuckDbDataset } from 'newt/adapter-duckdb'

/** Scopes as one text, the same whatever order they came in: part of a row's id. */
export function scopesText(scopes: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(scopes).sort(([a], [b]) => a.localeCompare(b))))
}

/**
 * Where the monitor keeps each application's metrics: one DuckDB per application, in a
 * folder (`<folder>/<appId>.duckdb`) or in memory. Shared by every metrics module, each
 * of which declares its own datasets (`define`) and reads and writes only them.
 */
export class MetricsStore {

  private readonly datasets: Record<string, DuckDbDataset> = {}
  private readonly opened = new Map<string, Promise<DuckDbAnalytics>>()
  private closed = false

  constructor(private readonly folder: string) {}

  /** A module's datasets: declared as it is initialized, before any application's DuckDB opens. */
  define(datasets: Record<string, DuckDbDataset>): void {
    Object.assign(this.datasets, datasets)
  }

  /** An application's DuckDB, opened the first time it is asked for. */
  of(appId: string): Promise<DuckDbAnalytics> {
    if (this.closed) return Promise.reject(new Error('The metrics store is closed'))
    let analytics = this.opened.get(appId)
    if (!analytics) {
      analytics = DuckDbAnalytics.open({ path: this.pathOf(appId), datasets: this.datasets })
      this.opened.set(appId, analytics)
    }
    return analytics
  }

  /**
   * An application's DuckDB closed and its file gone, once no dataset has a row: each
   * module forgets its own rows of a deleted application, and the last one leaves nothing.
   */
  async dropIfEmpty(appId: string): Promise<void> {
    const analytics = await this.of(appId)
    for (const dataset of Object.keys(this.datasets)) {
      const [row] = await analytics.query<{ rows: number }>(`SELECT count(*) AS rows FROM ${dataset}`)
      if ((row?.rows ?? 0) > 0) return
    }
    this.opened.delete(appId)
    await analytics.close()
    if (this.folder !== ':memory:') {
      for (const file of [this.pathOf(appId), `${this.pathOf(appId)}.wal`]) await rm(file, { force: true })
    }
  }

  async close(): Promise<void> {
    this.closed = true
    const all = [...this.opened.values()]
    this.opened.clear()
    for (const analytics of all) await (await analytics).close()
  }

  private pathOf(appId: string): string {
    return this.folder === ':memory:' ? ':memory:' : join(this.folder, `${appId}.duckdb`)
  }
}
