import { pageRequestFrom } from '@newt-kit/newt/http'
import type { MonitorBase } from '../../../../monitor-base'
import type { App_Module } from './app.module'

export function registerAppRoutes(base: MonitorBase, apps: App_Module): void {
  // `?status=archived`, or `all`: those watched unless asked.
  base.http.get('/apps', async request => Response.json(await apps.list(Object.fromEntries(new URL(request.url).searchParams), pageRequestFrom(request))))

  base.http.post('/apps', async request => Response.json(await apps.register(await request.json()), { status: 201 }))

  base.http.get('/apps/:id', async request => Response.json(await apps.get(request.params.id)))

  base.http.patch('/apps/:id', async request => Response.json(await apps.update(request.params.id, await request.json())))

  base.http.post('/apps/:id/archive', async request => Response.json(await apps.archive(request.params.id)))

  base.http.post('/apps/:id/restore', async request => Response.json(await apps.restore(request.params.id)))

  base.http.delete('/apps/:id', async request => {
    await apps.delete(request.params.id)
    return new Response(null, { status: 204 })
  })
}
