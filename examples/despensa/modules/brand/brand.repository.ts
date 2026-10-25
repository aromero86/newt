import { TableRepository } from 'newt/repository'
import type { ShopBase } from '../../shop-base'
import { Brand, type BrandDTO } from './brand'

export type BrandRow = BrandDTO & { version: number }

export class Brand_Repository extends TableRepository<Brand, BrandRow, ShopBase> {

  constructor(base: ShopBase) {
    super(base, base.store.table<BrandRow>('brand', { unique: [['name']] }))
  }

  protected toEntity(row: BrandRow): Brand {
    return Brand.fromDTO(row)
  }
}
