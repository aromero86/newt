import type { Notification_Deps } from './notification.deps'
import type { Notification_Module } from './notification.module'

/**
 * What is told to customers, and when: after what it is about was saved, by a job,
 * so an email never leaves for something that rolled back.
 */
export function registerNotificationWorkers(notification: Notification_Module, deps: Notification_Deps): void {
  deps.order.events.confirmed.subscribe(order => notification.orderConfirmed(order), {
    strategy: 'handler',
    queue: 'notification.orderConfirmed.on.order.confirmed',
  })
  deps.order.events.rejected.subscribe(order => notification.orderRejected(order), {
    strategy: 'handler',
    queue: 'notification.orderRejected.on.order.rejected',
  })
}
