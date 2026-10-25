import { join } from 'node:path'
import type { WriteRule } from 'newt/core'
import { BoundedContext } from 'newt/runtime'
import type { Store } from 'newt/store'
import { FileStore } from 'newt/adapter-files'
import { serve } from 'newt/http'
import { SqliteStore } from 'newt/adapter-sqlite'
import { Brand_Module } from './modules/brand/brand.module'
import { Category_Module } from './modules/category/category.module'
import type { Mailer } from './modules/notification/mailer'
import { Notification_Module } from './modules/notification/notification.module'
import { Order_Module } from './modules/order/order.module'
import { Product_Module } from './modules/product/product.module'
import { StockMovement_Module } from './modules/stock-movement/stock-movement.module'
import { ShopBase } from './shop-base'

export type ShopConfig = {
  /** Where it keeps its data: a folder of files, or a SQLite database. */
  store: { kind: 'files', folder: string } | { kind: 'sqlite', path: string }
  mailer: Mailer
  /** What a use case writing to another module outside a worker gets: an error in the tests. */
  writeRule?: WriteRule
}

/**
 * The shop: its only context. Who sends each request is told by a header here, to
 * keep the example short: a real one reads its session.
 */
export class Shop_Context extends BoundedContext<ShopBase> {

  private constructor(base: ShopBase, readonly modules: Awaited<ReturnType<typeof initializeModules>>) {
    super('shop', base)
  }

  static async open(config: ShopConfig): Promise<Shop_Context> {
    const base = new ShopBase({ name: 'shop', store: await openStore(config.store), writeRule: config.writeRule })
    base.http.authenticateWith(async request => {
      const userId = request.headers.get('x-user')
      return userId ? { userId } : null
    })
    return new Shop_Context(base, initializeModules(base, config.mailer))
  }

  serve(port: number) {
    return serve({ port, router: this.base.http })
  }
}

/** Each module after the ones it uses. */
function initializeModules(base: ShopBase, mailer: Mailer) {
  const brand = Brand_Module.initialize(base)
  const category = Category_Module.initialize(base)
  const product = Product_Module.initialize(base, { brand, category })
  const stockMovement = StockMovement_Module.initialize(base, { product })
  const order = Order_Module.initialize(base, { product, stockMovement })
  const notification = Notification_Module.initialize(base, { order }, { mailer })
  return { brand, category, product, stockMovement, order, notification }
}

function openStore(store: ShopConfig['store']): Promise<Store> {
  return store.kind === 'files'
    ? FileStore.open({ folder: store.folder })
    : SqliteStore.open({ path: store.path, migrations: join(import.meta.dir, 'migrations') })
}
