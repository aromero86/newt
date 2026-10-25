import { pageRequestFrom } from 'newt/http'
import type { ShopBase } from '../../shop-base'
import type { OrderPlaceDTO } from './order'
import type { Order_Module } from './order.module'

export function registerOrderRoutes(base: ShopBase, orders: Order_Module): void {
  base.http.get('/orders', async request => Response.json(await orders.listMine(pageRequestFrom(request))))

  // 202: the order is taken, and confirmed (or not) a moment later.
  base.http.post('/orders', async request => {
    const input = await request.json() as OrderPlaceDTO
    return Response.json(await orders.place(input), { status: 202 })
  })

  base.http.get('/orders/:id', async request => Response.json(await orders.getMine(request.params.id)))

  base.http.post('/orders/:id/cancel', async request => Response.json(await orders.cancelMine(request.params.id)))
}
