import type { HTMLBundle } from 'bun'
import type { HttpRouter } from './http-router'

export type ServeOptions = {
  port: number
  router: HttpRouter
  /** More routes beside the router's, as `Bun.serve` takes them: another router's, a webhook. */
  routes?: Bun.Serve.Routes<undefined, string>
  /**
   * The frontend, handed out for every address no route takes: its built folder, or,
   * in development, its `index.html` imported (`import app from './app/index.html'`),
   * which Bun builds as it serves it and reloads as its sources change.
   */
  frontend?: string | HTMLBundle
  /**
   * With a frontend's `index.html`: the folder of the files it names by their address
   * (`/favicon.svg`), served as they are. A built frontend has them in its folder.
   */
  publicFolder?: string
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
