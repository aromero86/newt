/**
 * Who may call some routes from a page of another origin (CORS), and what it may send
 * and read: a router's, a group's or a route's option. Its routes answer the
 * preflight (`OPTIONS`) and say so in every answer, errors too.
 */
export type Cors = {
  /** The origins that may: `*` for any, or the ones listed. Never with cookies. */
  origin: '*' | string[]
  /** What the page may send besides the simple headers: `authorization`, `content-type`… */
  headers?: string[]
  /** What the page may read of the answer besides the simple headers. */
  expose?: string[]
  /** How long the browser keeps the preflight's answer, in seconds: a day unless told. */
  maxAge?: number
}
