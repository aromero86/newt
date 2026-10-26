import { pageRequestFrom } from 'newt/http'
import type { ShopBase } from '../../shop-base'
import type { CategoryCreateDTO } from './category'
import type { Category_Module } from './category.module'

export function registerCategoryRoutes(base: ShopBase, categories: Category_Module): void {
  base.http.get('/categories', async request =>
    Response.json(await categories.list(pageRequestFrom(request))))

  base.http.get('/categories/:id', async request =>
    Response.json(await categories.get(request.params.id)))

  base.http.post('/categories', async request => {
    const input = await request.json() as CategoryCreateDTO
    return Response.json(await categories.create(input), { status: 201 })
  })

  base.http.delete('/categories/:id', async request => {
    await categories.delete(request.params.id)
    return new Response(null, { status: 204 })
  })
}
