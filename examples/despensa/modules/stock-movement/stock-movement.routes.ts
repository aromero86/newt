import type { ShopBase } from '../../shop-base'
import type { StockMovementReceiveDTO } from './stock-movement'
import type { StockMovement_Module } from './stock-movement.module'

export function registerStockMovementRoutes(base: ShopBase, stock: StockMovement_Module): void {
  base.http.get('/stock/:productId', async request => Response.json({ level: await stock.levelOf(request.params.productId) }))

  base.http.post('/stock/:productId/received', async request => {
    await stock.receive(request.params.productId, await request.json() as StockMovementReceiveDTO)
    return new Response(null, { status: 204 })
  })
}
