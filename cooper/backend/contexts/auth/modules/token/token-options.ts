export type Token_Options = {
  /** How long an access token works: the client refreshes it after. */
  accessMinutes: number
  /** How long a refresh token lasts unused: after it, the person signs in again. */
  refreshDays: number
}
