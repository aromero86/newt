import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DuckDbAnalytics, type DuckDbDataset } from 'newt/adapter-duckdb'

/** Scopes as one text, the same whatever order they came in: part of a row's id. */
export function scopesText(scopes: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(scopes).sort(([a], [b]) => a.localeCompare(b))))
}

/** An application whose DuckDB was dropped, asked for again: it is not opened again, so nothing of it is kept. */
export class AppGone extends Error {
  constructor(readonly appId: string) {
    super(`The application ${appId} is gone: its metrics are not kept`)
  }
}

/**
 * Where the monitor keeps each application's metrics: one DuckDB per application, in a
 * folder (`<folder>/<appId>.duckdb`) or in memory. Shared by every metrics module, each
 * of which declares its own datasets (`define`) and reads and writes only them.
 */
export class MetricsStore {

  private readonly datasets: Record<string, DuckDbDataset> = {}
  private readonly opened = new Map<string, Promise<DuckDbAnalytics>>()
  // Applications deleted, their DuckDB dropped: a collection that overlapped the deletion finds them gone.
  private readonly dropped = new Set<string>()
  private closed = false

  constructor(private readonly folder: string) {}

  /** A module's datasets: declared as it is initialized, before any application's DuckDB opens. */
  define(datasets: Record<string, DuckDbDataset>): void {
    Object.assign(this.datasets, datasets)
  }

  /**
   * An application's DuckDB, opened the first time it is asked for. One that could not
   * be opened is tried again the next time: while a deployment replaces the monitor, the
   * one going away still holds its file's lock. One dropped is not opened again (AppGone).
   */
  of(appId: string): Promise<DuckDbAnalytics> {
    if (this.closed) return Promise.reject(new Error('The metrics store is closed'))
    if (this.dropped.has(appId)) return Promise.reject(new AppGone(appId))
    let analytics = this.opened.get(appId)
    if (!analytics) {
      analytics = DuckDbAnalytics.open({ path: this.pathOf(appId), datasets: this.datasets })
      this.opened.set(appId, analytics)
      const opening = analytics
      opening.catch(() => {
        if (this.opened.get(appId) === opening) this.opened.delete(appId)
      })
    }
    return analytics
  }

  /** An application's DuckDB, or null once it was dropped: what a module forgetting it after another one finds. */
  async ofUnlessDropped(appId: string): Promise<DuckDbAnalytics | null> {
    return this.dropped.has(appId) ? null : this.of(appId)
  }

  /**
   * An application's DuckDB closed and its file gone, once no dataset has a row: each
   * module forgets its own rows of a deleted application, and the last one leaves nothing.
   */
  async dropIfEmpty(appId: string): Promise<void> {
    const analytics = await this.ofUnlessDropped(appId)
    if (!analytics) return
    for (const dataset of Object.keys(this.datasets)) {
      const [row] = await analytics.query<{ rows: number }>(`SELECT count(*) AS rows FROM ${dataset}`)
      if ((row?.rows ?? 0) > 0) return
    }
    if (this.dropped.has(appId)) return
    this.dropped.add(appId)
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
    // One that never opened has nothing to close.
    for (const analytics of all) await (await analytics.catch(() => null))?.close()
  }

  private pathOf(appId: string): string {
    return this.folder === ':memory:' ? ':memory:' : join(this.folder, `${appId}.duckdb`)
  }
}
