import { describe, expect, test } from 'bun:test'
import { eventOfQueue } from './event-of-queue'

describe('eventOfQueue', () => {
  test('is what follows `.on.` in a queue named after its module and use case', () => {
    expect(eventOfQueue('notification.orderPlaced.on.order.placed')).toBe('order.placed')
    expect(eventOfQueue('notification.orderPlaced.on.order.*')).toBe('order.*')
  })

  test('is none for a module or a use case that does not start in lower case, or a name not so made', () => {
    expect(eventOfQueue('Notification.orderPlaced.on.order.placed')).toBeUndefined()
    expect(eventOfQueue('notification.OrderPlaced.on.order.placed')).toBeUndefined()
    expect(eventOfQueue('notification.order.placed.on.order.placed')).toBeUndefined()
    expect(eventOfQueue('notification.on.order.placed')).toBeUndefined()
  })
})
