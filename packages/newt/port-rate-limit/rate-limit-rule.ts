/** How much a key may do: at most `limit` takes in any `windowMs`. */
export type RateLimitRule = {
  limit: number
  windowMs: number
}
