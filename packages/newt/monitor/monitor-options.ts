import type { Clock } from '../core'

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
}
