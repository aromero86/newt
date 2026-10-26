/** `<module>.<use case>.on.<event>`, the module and the use case in camelCase. */
const QUEUE = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*\.on\.(.+)$/

/**
 * The event a handler's queue says it reacts to (`order.placed` for
 * `notification.orderPlaced.on.order.placed`), or none if it is not named so: the
 * one rule both a subscription and the worker that registers it check.
 */
export function eventOfQueue(queue: string): string | undefined {
  return QUEUE.exec(queue)?.[1]
}
