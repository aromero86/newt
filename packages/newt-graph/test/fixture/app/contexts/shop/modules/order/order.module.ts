import { eventsOf, Module, UseCase, type DomainEvent } from 'newt/core'
import type { ShopBase } from '../../shop-base'
import { Order_Cancelled } from './events/order-cancelled'
import { Order_Placed } from './events/order-placed'
import type { Order_Deps } from './order.deps'
import { registerOrderWorkers } from './order.workers'

export class Order_Module extends Module {

  static initialize(base: ShopBase, deps: Order_Deps): Order_Module {
    const module = new Order_Module(base, deps)
    registerOrderWorkers(module)
    return module
  }

  readonly events

  private constructor(private readonly base: ShopBase, private readonly deps: Order_Deps) {
    super('order', base.invocations)
    this.events = eventsOf(base.bus, { placed: Order_Placed, cancelled: Order_Cancelled })
  }

  @UseCase()
  async place(productId: string): Promise<string> {
    await this.deps.product.get(productId)
    const id = crypto.randomUUID()
    await this.tell(this.placed(id, productId))
    return id
  }

  /** Writes to product outside a worker, said where it is seen. */
  @UseCase({ writesTo: ['product'], retryOnConflict: false })
  async cancel(id: string, productId: string): Promise<void> {
    await this.deps.product.reserve(productId)
    await this.tell(new Order_Cancelled({ id }))
  }

  @UseCase()
  async total(id: string): Promise<number> {
    return id.length
  }

  @UseCase()
  async confirm(id: string): Promise<void> {
    void id
  }

  private placed(id: string, productId: string): Order_Placed {
    return new Order_Placed({ id, productId })
  }

  private async tell(event: DomainEvent<{ id: string }>): Promise<void> {
    await this.base.bus.publish(event)
  }
}
