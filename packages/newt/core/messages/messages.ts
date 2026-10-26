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
  invalid_secret_token: () => string
  route_not_found: (params: { method: string, path: string }) => string
  method_not_allowed: (params: { method: string, path: string }) => string
  /** A request whose input does not pass its schema. */
  validation: () => string
  /** A request whose body cannot be read as JSON. */
  malformed_body: () => string
  /** A client's filter that nests more groups than its `defineFilter` allows. */
  filter_too_deep: (params: { max: number }) => string
  /** A client's filter with more conditions than its `defineFilter` allows. */
  filter_too_many_conditions: (params: { max: number }) => string
  /** Anything unexpected: it says nothing about the inside. */
  internal: () => string
}
