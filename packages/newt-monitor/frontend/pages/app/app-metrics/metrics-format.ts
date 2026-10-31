import type { MetricsBucket, MetricsWindow } from '../../../api/event-metrics'

export const WINDOW_LABELS: Record<MetricsWindow, string> = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days', '30d': '30 days', '90d': '90 days', '365d': '1 year' }
export const BUCKET_LABELS: Record<MetricsBucket, string> = { '1m': '1 minute', '5m': '5 minutes', '15m': '15 minutes', '1h': '1 hour', '1d': '1 day' }

/** How a bucket's time reads: its hour within a day or two, its day beyond. */
export function timeFormat(window: MetricsWindow, bucket: MetricsBucket): (at: string) => string {
  if (bucket === '1d') return at => new Date(at).toLocaleDateString('en', { month: 'short', day: 'numeric' })
  if (window === '1h' || window === '24h') return at => new Date(at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
  return at => new Date(at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** A moment, whole: its day and its time. */
export const when = (at: string) => new Date(at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** A time as it reads best: `0.4 ms`, `120 ms`, `1.8 s`, `12.5 min`, `3 h`, `2.1 d`. */
export function formatMs(ms: number | null): string {
  if (ms === null) return '–'
  if (ms < 1) return `${ms.toLocaleString('en', { maximumFractionDigits: 2 })} ms`
  if (ms < 1000) return `${Math.round(ms).toLocaleString('en')} ms`
  const [unit, size] = ms < 60_000 ? ['s', 1000] : ms < 3_600_000 ? ['min', 60_000] : ms < 86_400_000 ? ['h', 3_600_000] : ['d', 86_400_000]
  return `${(ms / size).toLocaleString('en', { maximumFractionDigits: 1 })} ${unit}`
}

/** How a number changed, as `+12%`; null when there was nothing before. */
export function changeOf(now: number | null, before: number | null): string | null {
  if (now === null || before === null || before === 0) return null
  const change = Math.round(((now - before) / before) * 100)
  return `${change > 0 ? '+' : ''}${change}%`
}

/** The use case a queue's jobs run: `card.indexCard` of `card.indexCard.on.card.created`. */
export function handlerOf(queue: string): string {
  return queue.split('.on.')[0] ?? queue
}

/** A size as it reads best, in powers of 1000: `512 B`, `1.2 kB`, `340 MB`, `7.5 GB`. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '–'
  const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB']
  let unit = 0
  let size = bytes
  while (Math.abs(size) >= 1000 && unit < units.length - 1) {
    size /= 1000
    unit++
  }
  return `${size.toLocaleString('en', { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`
}

/** A share, 0 to 100, as `42%`. */
export const formatPercent = (value: number | null) => (value === null ? '–' : `${Math.round(value)}%`)
