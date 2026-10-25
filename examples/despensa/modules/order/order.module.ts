import { currentActor, eventsOf, Module, ReferenceNotFound, UseCase, type Page, type PageRequest } from 'newt/core'
import type { ShopBase } from '../../shop-base'
import { NotEnoughStock } from '../stock-movement/errors/not-enough-stock'
import { OrderNotFound } from './errors/order-not-found'
import { ProductNotForSale } from './errors/product-not-for-sale'
import { Order_Cancelled } from './events/order-cancelled'
import { Order_Confirmed } from './events/order-confirmed'
import { Order_Placed } from './events/order-placed'
import { Order_Rejected } from './events/order-rejected'
import { Order, OrderPlaceSchema, type OrderDTO, type OrderPlaceDTO } from './order'
import type { Order_Deps } from './order.deps'
import { Order_Repository } from './order.repository'
import { registerOrderRoutes } from './order.routes'
import { registerOrderWorkers } from './order.workers'

/** The orders customers place, from placed to confirmed, rejected or cancelled. */
export class Order_Module extends Module {

  static initialize(base: ShopBase, deps: Order_Deps): Order_Module {
    const module = new Order_Module(base, new Order_Repository(base), deps)
    registerOrderRoutes(base, module)
    registerOrderWorkers(module)
    return module
  }

  readonly events

  private constructor(base: ShopBase, private readonly repo: Order_Repository, private readonly deps: Order_Deps) {
    super('order', base.invocations)
    this.events = eventsOf(base.bus, {
      placed: Order_Placed,
      confirmed: Order_Confirmed,
      rejected: Order_Rejected,
      cancelled: Order_Cancelled,
    })
  }

  /** Takes an order, priced as the products are now. It is `pending`: the stock is reserved in the background. */
  @UseCase()
  async place(input: OrderPlaceDTO): Promise<OrderDTO> {
    const { customerEmail, lines } = OrderPlaceSchema.parse(input)
    const ids = lines.map(line => line.productId)
    const found = await this.deps.product.findByIds(ids)
    const products = new Map(found.map(product => [product.id, product]))
    const priced = lines.map(line => {
      const product = products.get(line.productId)
      if (!product) throw new ReferenceNotFound('product', line.productId)
      if (product.archived) throw new ProductNotForSale(product.id)
      return { ...line, priceCents: product.priceCents }
    })
    const order = Order.place({ customerId: currentActor().userId, customerEmail, lines: priced })
    await this.repo.persist(order)
    return order.toDTO()
  }

  @UseCase()
  async getMine(id: string): Promise<OrderDTO> {
    return (await this.loadMine(id)).toDTO()
  }

  @UseCase()
  async listMine(page: PageRequest): Promise<Page<OrderDTO>> {
    const found = await this.repo.page({ customerId: currentActor().userId }, page)
    return {
      items: found.items.map(order => order.toDTO()),
      hasMore: found.hasMore,
      total: found.total,
    }
  }

  /** Its customer cancels it: its stock goes back in the background. */
  @UseCase()
  async cancelMine(id: string): Promise<OrderDTO> {
    const order = await this.loadMine(id)
    order.cancel()
    await this.repo.persist(order)
    return order.toDTO()
  }

  /**
   * Reserves the stock of a pending order, and confirms it; without enough stock,
   * rejects it. What its worker calls. Safe to run again: the reservation is not
   * taken twice, and an order no longer pending is left as it is. If it was cancelled
   * while this ran, what this reserved goes back.
   */
  @UseCase()
  async fulfil(id: string): Promise<void> {
    const order = await this.resolve(() => this.repo.find({ id }), () => new OrderNotFound(id))
    if (order.isCancelled) return this.deps.stockMovement.release(order.id)
    if (!order.isPending) return
    try {
      await this.deps.stockMovement.reserve(order.lines, order.id)
      order.confirm()
    } catch (error) {
      if (!(error instanceof NotEnoughStock)) throw error
      order.reject(error.message)
    }
    await this.repo.persist(order)
  }

  /** An order was cancelled: what was reserved for it goes back. What its worker calls; safe to run again. */
  @UseCase()
  async releaseStock(id: string): Promise<void> {
    await this.deps.stockMovement.release(id)
  }

  private loadMine(id: string): Promise<Order> {
    return this.resolve(() => this.repo.find({ id, customerId: currentActor().userId }), () => new OrderNotFound(id))
  }
}
