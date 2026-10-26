import type { HttpRouter } from './http-router'

export type ServeOptions = {
  port: number
  router: HttpRouter
  /** More routes beside the router's, as `Bun.serve` takes them: an MCP entry, a webhook. */
  routes?: Bun.Serve.Routes<undefined, string>
  /** A built frontend, handed out for every address no route takes. */
  frontend?: string
  /** Bun's development mode, whose error page shows the source: off unless asked for. */
  development?: boolean
}
