import { pageRequestFrom } from 'newt/http'
import type { MonitorBase } from '../../../../monitor-base'
import type { Structure_Module } from './structure.module'

export function registerStructureRoutes(base: MonitorBase, structures: Structure_Module): void {
  base.http.get('/apps/:id/structure', async request => Response.json(await structures.latest(request.params.id)))

  // The button: read it now.
  base.http.post('/apps/:id/structure/refresh', async request => Response.json(await structures.refresh(request.params.id)))

  base.http.get('/apps/:id/structure/versions', async request => Response.json(await structures.history(request.params.id, pageRequestFrom(request))))

  base.http.get('/apps/:id/structure/versions/:versionId', async request => Response.json(await structures.get(request.params.id, request.params.versionId)))
}
