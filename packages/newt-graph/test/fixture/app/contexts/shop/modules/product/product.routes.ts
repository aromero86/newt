import type { ShopBase } from '../../shop-base'
import type { Product_Module } from './product.module'

export function registerProductRoutes(base: ShopBase, products: Product_Module): void {
  base.http.get('/products/:id', async request => Response.json(await products.get(request.params.id)))
}
