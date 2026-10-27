import type { MonitorBase } from '../../../../monitor-base'
import type { UseCaseMetrics_Module } from './use-case-metrics.module'

export function registerUseCaseMetricsRoutes(base: MonitorBase, useCaseMetrics: UseCaseMetrics_Module): void {
  const query = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)

  // `?window=24h`: each use case's calls, mean and percentiles, beside the window before.
  base.http.get('/apps/:id/metrics/use-cases', async request => Response.json(await useCaseMetrics.totals(request.params.id, query(request))))

  // `?context=boards&useCase=card.create&window=24h&bucket=1h&compare=week&scope=workspace:01a1…&actor=…`
  base.http.get('/apps/:id/metrics/use-cases/series', async request => Response.json(await useCaseMetrics.series(request.params.id, query(request))))

  // `?context=boards&useCase=card.create&window=7d`: the names of the scopes it was called in.
  base.http.get('/apps/:id/metrics/use-cases/scopes', async request => Response.json(await useCaseMetrics.scopes(request.params.id, query(request))))

  // `?context=boards&useCase=card.create&window=7d&by=actor` (or `by=scope:workspace`), `&order=retries` for where it is fought over
  base.http.get('/apps/:id/metrics/use-cases/top', async request => Response.json(await useCaseMetrics.top(request.params.id, query(request))))
}
