/** Who may sign in, and for how long, as the monitor's settings say. */
export type Session_Options = {
  user: string
  password: string
  hours: number
  /** The cookie is sent over HTTPS only: the monitor is opened on an `https` address. */
  secureCookie: boolean
}
