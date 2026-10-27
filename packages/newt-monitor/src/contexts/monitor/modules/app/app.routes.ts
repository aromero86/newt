import { pageRequestFrom } from 'newt/http'
import type { MonitorBase } from '../../../../monitor-base'
import type { App_Module } from './app.module'

export function registerAppRoutes(base: MonitorBase, apps: App_Module): void {
  base.http.get('/apps', async request => Response.json(await apps.list(pageRequestFrom(request))))

  base.http.post('/apps', async request => Response.json(await apps.register(await request.json()), { status: 201 }))

  base.http.get('/apps/:id', async request => Response.json(await apps.get(request.params.id)))

  base.http.patch('/apps/:id', async request => Response.json(await apps.update(request.params.id, await request.json())))
}
