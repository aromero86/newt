/**
 * What the framework tells people when something it owns goes wrong, by error code.
 * In English by default; an application in another language replaces any of them
 * once, at startup, with `setMessages`.
 */
export type Messages = {
  concurrency_conflict: () => string
  reference_not_found: (params: { resource: string, id: string }) => string
  not_signed_in: () => string
  invalid_email: (params: { email: string }) => string
  route_not_found: (params: { method: string, path: string }) => string
  method_not_allowed: (params: { method: string, path: string }) => string
  /** A request whose input does not pass its schema. */
  validation: () => string
  /** A request whose body cannot be read as JSON. */
  malformed_body: () => string
  /** Anything unexpected: it says nothing about the inside. */
  internal: () => string
}
