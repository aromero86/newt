import type { Product_Module } from '../product/product.module'
import type { StockMovement_Module } from '../stock-movement/stock-movement.module'

export interface Order_Deps {
  product: Product_Module
  stockMovement: StockMovement_Module
}
