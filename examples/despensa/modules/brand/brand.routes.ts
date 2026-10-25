import type { ShopBase } from '../../shop-base'
import type { BrandCreateDTO } from './brand'
import type { Brand_Module } from './brand.module'

export function registerBrandRoutes(base: ShopBase, brands: Brand_Module): void {
  base.http.post('/brands', async request => {
    const input = await request.json() as BrandCreateDTO
    return Response.json(await brands.create(input), { status: 201 })
  })

  base.http.delete('/brands/:id', async request => {
    await brands.delete(request.params.id)
    return new Response(null, { status: 204 })
  })
}
