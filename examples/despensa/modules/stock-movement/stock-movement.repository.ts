import { TableRepository } from 'newt/repository'
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
   * Records the movements of one operation (their `reference`) once, and only if no
   * product they touch is left below zero: both checked after writing them, in their
   * transaction. The save guards the operation and the stock of each product it
   * touches, so no other save of those runs in between, in any store: two orders
   * taking the last units at once cannot both have them, and the same operation run
   * twice at once records once. Whether it recorded them: false for a repeat.
   */
  async persistKeepingStock(movements: StockMovement[]): Promise<boolean> {
    if (movements.length === 0) return false
    const products = [...new Set(movements.map(movement => movement.productId))]
    const reference = movements[0]!.reference
    try {
      await this.save(movements, movement => this.write(movement), {
        guard: [`movements:${reference}`, ...products.map(productId => `stock:${productId}`)],
        after: async () => {
          if (await this.count({ reference }) > movements.length) throw new AlreadyRecorded()
          for (const productId of products) {
            if (await this.levelOf(productId) < 0) throw new NotEnoughStock(productId)
          }
        },
      })
      return true
    } catch (error) {
      if (error instanceof AlreadyRecorded) return false
      throw error
    }
  }
}

/** The operation was recorded by another run: this one is a repeat, rolled back. */
class AlreadyRecorded extends Error {}
