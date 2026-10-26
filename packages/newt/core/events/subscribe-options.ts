/**
 * How a handler hears an event.
 *
 * - `fireAndForget` (the default) runs it in memory after the commit: if it fails,
 *   or the server stops first, it is lost.
 * - `handler` writes a job with the change, in its transaction, so both are stored
 *   or neither is; a worker runs it until it succeeds or runs out of `attempts`.
 *   Its `name` is its queue's, which finds the handler again after a restart:
 *   `<handler's module>.<use case it calls>.on.<event>`.
 *   The payload is stored: an event that carries a secret cannot use it. The handler
 *   may run more than once, so it must be idempotent.
 */
export type SubscribeOptions =
  | { mode: 'fireAndForget' }
  | { mode: 'handler', name: string, attempts?: number }
