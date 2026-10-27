import type { MonitorBase } from '../../../../monitor-base'
import type { Connection_Module } from './connection.module'

export function registerConnectionRoutes(base: MonitorBase, connections: Connection_Module): void {
  base.http.get('/apps/:id/connection', async request => Response.json(await connections.status(request.params.id)))

  base.http.post('/apps/:id/connection/check', async request => Response.json(await connections.check(request.params.id)))
}
