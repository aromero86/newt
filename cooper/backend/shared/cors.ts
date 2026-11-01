import type { Cors } from '@newt-kit/newt/http'

/**
 * What a page of another origin may send and read: the MCP inspector, for one, runs
 * in a browser, and finds out how to sign in, registers, trades its code and calls
 * the MCP server from there. Never with cookies: who it is goes in its bearer token,
 * so any origin may ask.
 */
export const OPEN_TO_BROWSERS: Cors = {
  origin: '*',
  headers: ['authorization', 'content-type', 'mcp-protocol-version', 'mcp-session-id', 'last-event-id'],
  expose: ['mcp-session-id', 'www-authenticate'],
}
