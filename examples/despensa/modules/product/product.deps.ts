import type { Brand_Module } from '../brand/brand.module'
import type { Category_Module } from '../category/category.module'

export interface Product_Deps {
  brand: Brand_Module
  category: Category_Module
}
