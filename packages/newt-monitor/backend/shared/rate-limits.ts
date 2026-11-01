import type { HttpRateLimit } from '@newt-kit/newt/http'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** What one address may try to sign in with: past it, someone is guessing the password. */
export const SIGN_IN_LIMIT: HttpRateLimit = { name: 'session.signIn', limit: 10, windowMs: 15 * MINUTE, by: 'ip' }

/**
 * What everyone together may try to sign in with: many addresses guessing at once
 * still guess slowly. Past it, the person too waits, up to an hour.
 */
export const SIGN_IN_TOTAL_LIMIT: HttpRateLimit = { name: 'session.signIn.total', limit: 100, windowMs: HOUR, by: () => 'total' }

/** What one address may ask of OAuth's endpoints: a client signing the person in asks a few times. */
export const OAUTH_LIMIT: HttpRateLimit = { name: 'oauth', limit: 60, windowMs: MINUTE, by: 'ip' }

/** How many clients one address may register: an MCP client registers once. */
export const REGISTER_LIMIT: HttpRateLimit = { name: 'oauthClient.register', limit: 10, windowMs: HOUR, by: 'ip' }

/** How many requests one address may leave waiting for the person's answer. */
export const AUTHORIZE_LIMIT: HttpRateLimit = { name: 'oauthGrant.request', limit: 30, windowMs: HOUR, by: 'ip' }

/** The largest registration the monitor reads: a name and ten addresses. */
export const REGISTRATION_MAX_BYTES = 16 * 1024
