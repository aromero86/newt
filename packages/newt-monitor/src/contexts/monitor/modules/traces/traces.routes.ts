import type { MonitorBase } from '../../../../monitor-base'
import type { Traces_Module } from './traces.module'

export function registerTracesRoutes(base: MonitorBase, traces: Traces_Module): void {
  const query = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)

  // `?context=boards&useCase=card.create&show=failures&window=7d`, `?queue=…`, `?job=<id>`, `?nearMs=120`
  base.http.get('/apps/:id/traces', async request => Response.json(await traces.list(request.params.id, query(request))))

  base.http.get('/apps/:id/traces/:traceId', async request => Response.json(await traces.get(request.params.id, request.params.traceId)))
}
