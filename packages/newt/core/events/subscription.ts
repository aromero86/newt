/**
 * How a module reacts to an event (`emitter.subscribe`): its strategy, and what that
 * strategy takes.
 */
export type Subscription =
  | {
      /**
       * In memory, after each commit that tells it: lost if it fails or the process
       * stops. Only for what may be lost: a cache, a metric.
       */
      strategy: 'fire-and-forget'
    }
  | {
      /**
       * Durably: a job written with the change that told it, run after the commit,
       * again if it fails, after a restart too. It may run more than once: what it
       * calls must be safe to run again.
       */
      strategy: 'handler'
      /**
       * Its queue, by who reacts with what to which event:
       * `<module>.<use case>.on.<event>` (`notification.orderConfirmed.on.order.confirmed`).
       * Renaming it leaves the jobs pending under the old name waiting.
       */
      queue: `${string}.${string}.on.${string}.${string}`
      /** How many times it runs before its job is dead: 5 by default. */
      attempts?: number
    }
