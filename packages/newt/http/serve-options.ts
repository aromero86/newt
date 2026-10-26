import type { HttpRouter } from './http-router'

export type ServeOptions = {
  port: number
  router: HttpRouter
  /** More routes beside the router's, as `Bun.serve` takes them: another router's, a webhook. */
  routes?: Bun.Serve.Routes<undefined, string>
  /** A built frontend, handed out for every address no route takes. */
  frontend?: string
  /**
   * Bun's development mode: its error page, which shows the source, for what throws
   * outside a route, and hot reloading of HTML imports. Off unless asked for, and off
   * means without both.
   */
  development?: boolean
  /**
   * `GET /api/health` (or the path given), without a session, for whoever watches it
   * is up: a 200 while it serves, a 503 once it is stopping.
   */
  health?: boolean | string
  /**
   * How long it goes on answering once it is told to stop, its health a 503 meanwhile,
   * so whoever balances the load sends it nothing new before it closes: none unless told.
   */
  drainMs?: number
}
