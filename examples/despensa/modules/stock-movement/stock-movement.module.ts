import { eventsOf, Module, UseCase } from 'newt/core'
import type { ShopBase } from '../../shop-base'
import { StockMovement_Recorded } from './events/stock-movement-recorded'
import { StockMovement, StockMovementReceiveSchema, type StockMovementLineDTO, type StockMovementReceiveDTO } from './stock-movement'
import type { StockMovement_Deps } from './stock-movement.deps'
import { StockMovement_Repository } from './stock-movement.repository'
import { registerStockMovementRoutes } from './stock-movement.routes'

/** The stock of each product, as the movements that make it. */
export class StockMovement_Module extends Module {

  static initialize(base: ShopBase, deps: StockMovement_Deps): StockMovement_Module {
    const module = new StockMovement_Module(base, new StockMovement_Repository(base), deps)
    registerStockMovementRoutes(base, module)
    return module
  }

  readonly events

  private constructor(base: ShopBase, private readonly repo: StockMovement_Repository, private readonly deps: StockMovement_Deps) {
    super('stockMovement', base.invocations)
    this.events = eventsOf(base.bus, { recorded: StockMovement_Recorded })
  }

  @UseCase()
  async levelOf(productId: string): Promise<number> {
    await this.deps.product.assertExists(productId)
    return this.repo.levelOf(productId)
  }

  /** Units of a product came in. */
  @UseCase()
  async receive(productId: string, input: StockMovementReceiveDTO): Promise<void> {
    const { quantity } = StockMovementReceiveSchema.parse(input)
    await this.deps.product.assertExists(productId)
    await this.repo.persist(StockMovement.record({ productId, quantity, reference: 'received' }))
  }

  /**
   * Takes the units of every line out of stock, all of them or none (`NotEnoughStock`).
   * Safe to run again for the same reference: once it took them, it does nothing.
   */
  @UseCase()
  async reserve(lines: StockMovementLineDTO[], reference: string): Promise<void> {
    if (await this.repo.count({ reference }) > 0) return
    await this.repo.persistKeepingStock(lines.map(line => StockMovement.record({ productId: line.productId, quantity: -line.quantity, reference })))
  }

  /**
   * Gives back what was reserved for a reference: a compensation, for a flow that
   * reserved and then could not go on (an order cancelled). New movements undo the
   * old ones, which stay as history. Safe to run again, and before any reservation:
   * then there is nothing to give back.
   */
  @UseCase()
  async release(reference: string): Promise<void> {
    const released = `release:${reference}`
    if (await this.repo.count({ reference: released }) > 0) return
    const reserved = await this.repo.find({ reference })
    if (reserved.length === 0) return
    await this.repo.persist(...reserved.map(movement => StockMovement.record({ productId: movement.productId, quantity: -movement.quantity, reference: released })))
  }
}
