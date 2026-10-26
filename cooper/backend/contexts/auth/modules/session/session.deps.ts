import type { Product_Module } from '../product/product.module'
import type { User_Module } from '../user/user.module'

export interface Session_Deps {
  user: User_Module
  product: Product_Module
}
