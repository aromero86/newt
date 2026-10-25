import type { DomainEvent } from 'newt/core'
import type { StockMovementDTO } from '../stock-movement.schema'

export class StockMovement_Recorded implements DomainEvent<StockMovementDTO> {
  static readonly eventName = 'stockMovement.recorded'
  readonly name = StockMovement_Recorded.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: StockMovementDTO) {}
}
