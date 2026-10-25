import { Module, UseCase } from 'newt/core'
import type { ShopBase } from '../../shop-base'
import type { OrderDTO } from '../order/order'
import type { Notification_Deps } from './notification.deps'
import type { Notification_Options } from './notification-options'
import { registerNotificationWorkers } from './notification.workers'

/** The emails customers get about their orders. It keeps nothing: it only tells. */
export class Notification_Module extends Module {

  static initialize(base: ShopBase, deps: Notification_Deps, options: Notification_Options): Notification_Module {
    const module = new Notification_Module(base, options)
    registerNotificationWorkers(module, deps)
    return module
  }

  private constructor(base: ShopBase, private readonly options: Notification_Options) {
    super('notification', base.invocations)
  }

  @UseCase()
  async orderConfirmed(order: OrderDTO): Promise<void> {
    await this.options.mailer.send({
      to: order.customerEmail,
      subject: 'Your order is confirmed',
      text: `Order ${order.id}: ${(order.totalCents / 100).toFixed(2)} €.`,
    })
  }

  @UseCase()
  async orderRejected(order: OrderDTO): Promise<void> {
    await this.options.mailer.send({ to: order.customerEmail, subject: 'We could not take your order', text: `Order ${order.id}: ${order.rejection}` })
  }
}
