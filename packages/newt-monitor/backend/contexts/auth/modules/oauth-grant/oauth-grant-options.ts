/** Where the monitor is opened, and the one server its grants are for. */
export type OauthGrant_Options = {
  /** Where people open the monitor: the consent page is its `/authorize/<id>`. */
  publicUrl: string
  /** The monitor's MCP server, the resource every grant is for (RFC 8707). */
  resource: string
}
