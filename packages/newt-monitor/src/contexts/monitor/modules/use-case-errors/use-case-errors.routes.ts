import type { MonitorBase } from '../../../../monitor-base'
import type { UseCaseErrors_Module } from './use-case-errors.module'

export function registerUseCaseErrorsRoutes(base: MonitorBase, useCaseErrors: UseCaseErrors_Module): void {
  const query = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)

  // `?window=24h`: each use case's errors and failures, beside the window before.
  base.http.get('/apps/:id/metrics/errors', async request => Response.json(await useCaseErrors.totals(request.params.id, query(request))))

  // `?context=boards&useCase=card.create&window=24h&bucket=1h&scope=workspace:01a1…&actor=…`
  base.http.get('/apps/:id/metrics/errors/series', async request => Response.json(await useCaseErrors.series(request.params.id, query(request))))

  // `?context=boards&useCase=card.create&window=24h`: by code, beside the window before.
  base.http.get('/apps/:id/metrics/errors/codes', async request => Response.json(await useCaseErrors.codes(request.params.id, query(request))))

  // `?context=boards&useCase=card.create&window=7d&by=actor&kind=failure` (or `by=scope:workspace`, `kind=error`)
  base.http.get('/apps/:id/metrics/errors/top', async request => Response.json(await useCaseErrors.top(request.params.id, query(request))))
}
