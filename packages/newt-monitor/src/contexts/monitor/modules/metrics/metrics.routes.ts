import type { MonitorBase } from '../../../../monitor-base'
import type { Metrics_Module } from './metrics.module'

export function registerMetricsRoutes(base: MonitorBase, metrics: Metrics_Module): void {
  const query = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)

  // `?window=24h`: each event's total, beside the window before.
  base.http.get('/apps/:id/metrics/events', async request => Response.json(await metrics.totals(request.params.id, query(request))))

  // `?context=boards&event=card.created&window=24h&bucket=1h&compare=week&scope=workspace:01a1…&actor=…`
  base.http.get('/apps/:id/metrics/series', async request => Response.json(await metrics.series(request.params.id, query(request))))

  // `?context=boards&event=card.created&window=7d&by=actor` (or `by=scope:workspace`)
  base.http.get('/apps/:id/metrics/top', async request => Response.json(await metrics.top(request.params.id, query(request))))

  base.http.get('/apps/:id/metrics/retention', async request => Response.json(await metrics.retention(request.params.id)))

  base.http.patch('/apps/:id/metrics/retention', async request => Response.json(await metrics.changeRetention(request.params.id, await request.json())))
}
