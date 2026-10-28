import { createHmac, timingSafeEqual } from 'node:crypto'

/** The longest a signed `x-newt-trace` header is good for: one meant to last longer is not taken. */
export const TRACE_HEADER_MAX_MS = 24 * 60 * 60 * 1000

const signatureOf = (key: string, expires: number) => createHmac('sha256', key).update(`newt-trace-v1\n${expires}`).digest('hex')

/**
 * The value of an `x-newt-trace` header that keeps the trace of every request carrying
 * it, until `expiresAt`: when it ends, and HMAC-SHA256 of it with the key the
 * application shares with its monitor. What the monitor gives, to look at a request
 * whole in production; whoever does not have the key cannot make one.
 */
export function signTraceHeader(key: string, expiresAt: Date): string {
  const expires = expiresAt.getTime()
  return `${expires}.${signatureOf(key, expires)}`
}

/** Whether a header's value was signed with the key, and still is good: not past its end, nor meant to last longer than a day. */
export function verifyTraceHeader(key: string, value: string, now: Date): boolean {
  const [expires, signature, ...rest] = value.trim().split('.')
  const ends = Number(expires)
  if (rest.length || !signature || !Number.isSafeInteger(ends)) return false
  if (ends <= now.getTime() || ends > now.getTime() + TRACE_HEADER_MAX_MS) return false
  const expected = Buffer.from(signatureOf(key, ends), 'hex')
  const given = Buffer.from(signature, 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}
