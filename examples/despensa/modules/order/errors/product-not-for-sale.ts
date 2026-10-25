import { ValidationError } from 'newt/core'

export class ProductNotForSale extends ValidationError {
  readonly code = 'order.product_not_for_sale'
  constructor(productId: string) {
    super(`The product ${productId} is no longer sold`)
  }
}
