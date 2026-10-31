import { pageRequestFrom } from 'newt/http'
import type { MonitorBase } from '../../../../monitor-base'
import type { Catalog_Module } from './catalog.module'

export function registerCatalogRoutes(base: MonitorBase, catalog: Catalog_Module): void {
  // `?kind=useCase&context=boards&module=card&status=all`: each one optional.
  base.http.get('/apps/:id/catalog', async request => {
    const filter = Object.fromEntries(new URL(request.url).searchParams)
    return Response.json(await catalog.list(request.params.id, filter, pageRequestFrom(request)))
  })

  base.http.get('/apps/:id/catalog/:itemId', async request => Response.json(await catalog.get(request.params.id, request.params.itemId)))
}
