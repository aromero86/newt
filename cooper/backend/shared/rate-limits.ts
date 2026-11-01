import type { HttpRateLimit } from 'newt/http'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** What one person may ask of a context's API: plenty for anyone using it, not for a script gone wrong. */
export const API_LIMIT: HttpRateLimit = { name: 'api', limit: 600, windowMs: MINUTE }

/** What one address may try to sign in with, whatever the emails: past it, someone is guessing. */
export const SIGN_IN_LIMIT: HttpRateLimit = { name: 'session.signIn', limit: 30, windowMs: 15 * MINUTE, by: 'ip' }

/** How many accounts one address may open. */
export const SIGN_UP_LIMIT: HttpRateLimit = { name: 'session.signUp', limit: 10, windowMs: HOUR, by: 'ip' }

/** What one address may ask of OAuth's endpoints: a client signing someone in asks a few times. */
export const OAUTH_LIMIT: HttpRateLimit = { name: 'oauth', limit: 60, windowMs: MINUTE, by: 'ip' }

/** What one person's AI assistant may ask of the MCP server: a conversation calls tools in bursts. */
export const MCP_LIMIT: HttpRateLimit = { name: 'mcp', limit: 120, windowMs: MINUTE }
