import { Base } from 'newt/runtime'
import type { Store } from 'newt/port-store'
import { HttpRouter } from 'newt/http'

/**
 * What every module of the shop receives: the framework's base, with a router for
 * its routes. Its store may be any: the modules only use what every store has.
 */
export class ShopBase extends Base<Store> {
  readonly http = new HttpRouter()
}
