import type { MonitorBase } from '../../../../monitor-base'
import type { EventMetrics_Module } from './event-metrics.module'

export function registerEventMetricsRoutes(base: MonitorBase, eventMetrics: EventMetrics_Module): void {
  const query = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)

  // `?window=24h`: each event's total, beside the window before.
  base.http.get('/apps/:id/metrics/events', async request => Response.json(await eventMetrics.totals(request.params.id, query(request))))

  // `?context=boards&event=card.created&window=24h&bucket=1h&compare=week&scope=workspace:01a1…&actor=…`
  base.http.get('/apps/:id/metrics/events/series', async request => Response.json(await eventMetrics.series(request.params.id, query(request))))

  // `?context=boards&event=card.created&window=7d&by=actor` (or `by=scope:workspace`)
  base.http.get('/apps/:id/metrics/events/top', async request => Response.json(await eventMetrics.top(request.params.id, query(request))))

  // `?context=boards&event=card.created&window=7d`: the names of the scopes it was told in.
  base.http.get('/apps/:id/metrics/events/scopes', async request => Response.json(await eventMetrics.scopes(request.params.id, query(request))))

  // Server-sent events, while the browser listens: the application's own, passed on.
  base.http.get('/apps/:id/metrics/live', async request => new Response(await eventMetrics.live(request.params.id, request.signal), {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
  }))
}
