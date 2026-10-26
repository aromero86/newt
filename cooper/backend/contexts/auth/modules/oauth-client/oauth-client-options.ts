export type OauthClient_Options = {
  /** The secret of each product's own client, by product id: from the configuration, never from the store. */
  secrets: Record<string, string>
}
