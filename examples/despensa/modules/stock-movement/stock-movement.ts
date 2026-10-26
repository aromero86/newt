import { Entity, type EntityInput } from 'newt/core'
import { StockMovement_Recorded } from './events/stock-movement-recorded'
import { StockMovementSchema, type StockMovementDTO } from './stock-movement.schema'

export * from './stock-movement.schema'

/** A movement of stock. Once recorded it never changes: a mistake is put right by another one. */
export class StockMovement extends Entity<typeof StockMovementSchema> {

  private constructor(input: EntityInput<StockMovementDTO>, isNew: boolean) {
    super(StockMovementSchema, input, isNew)
  }

  static fromDTO(dto: StockMovementDTO & { version: number }): StockMovement {
    return new StockMovement(dto, false)
  }

  static record(input: { productId: string, quantity: number, reference: string }): StockMovement {
    const movement = new StockMovement(input, true)
    movement.trackEvent(new StockMovement_Recorded(movement.toDTO()))
    return movement
  }

  get productId(): string {
    return this.data.productId
  }

  get quantity(): number {
    return this.data.quantity
  }
}
