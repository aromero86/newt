import type { ProductDTO } from './product.schema'

export type Product_Options = {
  /** Every product, as cooper's code declares them: they are not data anyone edits. */
  products: ProductDTO[]
}
