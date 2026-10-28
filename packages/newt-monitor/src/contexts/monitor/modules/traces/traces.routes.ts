import type { MonitorBase } from '../../../../monitor-base'
import type { Traces_Module } from './traces.module'

export function registerTracesRoutes(base: MonitorBase, traces: Traces_Module): void {
  const query = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)

  // `?context=boards&useCase=card.create&show=failures&window=7d`, `?queue=…`, `?job=<id>`, `?nearMs=120`
  base.http.get('/apps/:id/traces', async request => Response.json(await traces.list(request.params.id, query(request))))

  // `{ hours: 1 }`: a POST, since each answer is a new one.
  base.http.post('/apps/:id/traces/header', async request => Response.json(await traces.header(request.params.id, await request.json().catch(() => ({})))))

  base.http.get('/apps/:id/traces/:traceId', async request => Response.json(await traces.get(request.params.id, request.params.traceId)))
}
