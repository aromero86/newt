import type { Clock } from '../core'
import type { Traces } from '../runtime/traces/traces'
import type { NonceStore } from './nonce-store'

export type MonitorOptions = {
  /** The application's name, as the monitor shows it: `cooper`. */
  name: string
  /** Its own port, apart from every context's: one with no public address in front of it. */
  port: number
  /** Where it listens: `127.0.0.1` unless told (`0.0.0.0` in a container another reaches over its network). */
  hostname?: string
  /**
   * The key the monitor signs each request with, shared and never sent: at least 32
   * characters. With none it does not start.
   */
  key: string
  /** What tells it the time, to check a request was made now: the real one unless a test gives another. */
  clock?: Clock
  /**
   * Where it keeps the nonces it has seen: its memory unless told. With several
   * instances, `RedisNonces`, so a request is refused by all once any saw it.
   */
  nonces?: NonceStore
  /**
   * The traces it serves: the application's (`setTraces`, or its memory), which serving
   * turns on, unless a test gives others of its own, which it serves as they are.
   */
  traces?: Traces
}
