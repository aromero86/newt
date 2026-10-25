import type { Product_Deps } from './product.deps'
import type { Product_Module } from './product.module'

/**
 * A product points at a brand and a category by their ids, so it follows them: when
 * one is deleted, its products are left without it, a moment later.
 */
export function registerProductWorkers(products: Product_Module, deps: Product_Deps): void {
  deps.brand.events.deleted.subscribe(brand => products.forgetBrand(brand.id), {
    strategy: 'handler',
    queue: 'product.forgetBrand.on.brand.deleted',
  })
  deps.category.events.deleted.subscribe(category => products.forgetCategory(category.id), {
    strategy: 'handler',
    queue: 'product.forgetCategory.on.category.deleted',
  })
}
