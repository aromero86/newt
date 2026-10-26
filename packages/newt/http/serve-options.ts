import type { HttpRouter } from './http-router'

export type ServeOptions = {
  port: number
  router: HttpRouter
  /** More routes beside the router's, as `Bun.serve` takes them: an MCP entry, a webhook. */
  routes?: Bun.Serve.Routes<undefined, string>
  /** A built frontend, handed out for every address no route takes. */
  frontend?: string
  /**
   * Bun's development mode: its error page, which shows the source, for what throws
   * outside a route, and hot reloading of HTML imports. Off unless asked for, and off
   * means without both.
   */
  development?: boolean
}
