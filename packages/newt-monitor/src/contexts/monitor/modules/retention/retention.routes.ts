import type { MonitorBase } from '../../../../monitor-base'
import type { Retention_Module } from './retention.module'

export function registerRetentionRoutes(base: MonitorBase, retention: Retention_Module): void {
  base.http.get('/apps/:id/retention', async request => Response.json(await retention.get(request.params.id)))

  base.http.patch('/apps/:id/retention', async request => Response.json(await retention.change(request.params.id, await request.json())))
}
