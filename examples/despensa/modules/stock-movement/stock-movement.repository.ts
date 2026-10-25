import { TableRepository } from 'newt/store'
import type { ShopBase } from '../../shop-base'
import { NotEnoughStock } from './errors/not-enough-stock'
import { StockMovement, type StockMovementDTO } from './stock-movement'

export type StockMovementRow = StockMovementDTO & { version: number }

export class StockMovement_Repository extends TableRepository<StockMovement, StockMovementRow, ShopBase> {

  constructor(base: ShopBase) {
    super(base, base.store.table<StockMovementRow>('stock_movement'))
  }

  protected toEntity(row: StockMovementRow): StockMovement {
    return StockMovement.fromDTO(row)
  }

  /** How many of a product there are: what its movements add up to. */
  async levelOf(productId: string): Promise<number> {
    return (await this.table.find({ productId })).reduce((sum, movement) => sum + movement.quantity, 0)
  }

  /**
   * Records movements only if no product they touch is left below zero: checked after
   * writing them, in their transaction. The save guards the stock of each product it
   * touches, so no other save of those products runs in between, in any store: two
   * orders taking the last units at once cannot both have them, and orders of other
   * products never wait.
   */
  async persistKeepingStock(movements: StockMovement[]): Promise<void> {
    const products = [...new Set(movements.map(movement => movement.productId))]
    await this.save(movements, movement => this.write(movement), {
      guard: products.map(productId => `stock:${productId}`),
      after: async () => {
        for (const productId of products) {
          if (await this.levelOf(productId) < 0) throw new NotEnoughStock(productId)
        }
      },
    })
  }
}
