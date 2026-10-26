import { HttpRouter } from 'newt/http'
import { Base } from 'newt/runtime'

export class ShopBase extends Base {
  readonly http = new HttpRouter()
}
