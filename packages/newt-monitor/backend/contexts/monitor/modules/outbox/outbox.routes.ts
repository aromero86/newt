import type { MonitorBase } from '../../../../monitor-base'
import type { Outbox_Module } from './outbox.module'

export function registerOutboxRoutes(base: MonitorBase, outbox: Outbox_Module): void {
  const query = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)

  // Its queues as the last snapshot found them.
  base.http.get('/apps/:id/outbox', async request => Response.json(await outbox.now(request.params.id)))

  // `?context=boards&queue=card.indexCard.on.card.created&window=24h&bucket=15m`
  base.http.get('/apps/:id/outbox/depth', async request => Response.json(await outbox.depth(request.params.id, query(request))))

  // `?context=boards&after=<job id>&limit=50`: asked of the application, without payloads.
  base.http.get('/apps/:id/outbox/dead', async request => Response.json(await outbox.deadJobs(request.params.id, query(request))))
}
