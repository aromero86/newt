import { pageRequestFrom } from 'newt/http'
import { archivedFrom } from '../../archived-from'
import type { ShopBase } from '../../shop-base'
import type { ProductCreateDTO, ProductUpdateDTO } from './product'
import type { Product_Module } from './product.module'

export function registerProductRoutes(base: ShopBase, products: Product_Module): void {
  base.http.get('/products', async request => {
    const filters = { archived: archivedFrom(request) }
    return Response.json(await products.list(filters, pageRequestFrom(request)))
  })

  // A search sends its filter in the body: groups of conditions do not fit in a URL.
  base.http.post('/products/search', async request =>
    Response.json(await products.search(await request.json(), pageRequestFrom(request))))

  base.http.post('/products', async request => {
    const input = await request.json() as ProductCreateDTO
    return Response.json(await products.create(input), { status: 201 })
  })

  base.http.get('/products/:id', async request =>
    Response.json(await products.get(request.params.id)))

  base.http.patch('/products/:id', async request => {
    const input = await request.json() as ProductUpdateDTO
    return Response.json(await products.update(request.params.id, input))
  })
}
