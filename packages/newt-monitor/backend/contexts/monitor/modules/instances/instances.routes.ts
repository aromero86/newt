import type { MonitorBase } from '../../../../monitor-base'
import type { Instances_Module } from './instances.module'

export function registerInstancesRoutes(base: MonitorBase, instances: Instances_Module): void {
  const query = (request: Request) => Object.fromEntries(new URL(request.url).searchParams)

  // Its system and instances now.
  base.http.get('/apps/:id/instances', async request => Response.json(await instances.list(request.params.id)))

  // `?window=24h&bucket=15m`: how many were alive, by bucket.
  base.http.get('/apps/:id/instances/count', async request => Response.json(await instances.count(request.params.id, query(request))))

  // `?window=24h&bucket=15m`: the system's memory, processors, event loop and disks, by bucket.
  base.http.get('/apps/:id/system/series', async request => Response.json(await instances.system(request.params.id, query(request))))
}
