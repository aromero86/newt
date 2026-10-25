import { Entity, type EntityInput } from 'newt/core'
import { Brand_Created } from './events/brand-created'
import { Brand_Deleted } from './events/brand-deleted'
import { BrandSchema, type BrandDTO } from './brand.schema'

export * from './brand.schema'

export class Brand extends Entity<typeof BrandSchema> {

  private constructor(input: EntityInput<BrandDTO>, isNew: boolean) {
    super(BrandSchema, input, isNew)
  }

  static fromDTO(dto: BrandDTO): Brand {
    return new Brand(dto, false)
  }

  static create(name: string): Brand {
    const brand = new Brand({ name }, true)
    brand.trackEvent(new Brand_Created(brand.toDTO()))
    return brand
  }

  delete(): void {
    this.markAsDeleted()
    this.trackEvent(new Brand_Deleted(this.toDTO()))
  }
}
