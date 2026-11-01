/** Who may sign in, and for how long, as the monitor's settings say. */
export type Session_Options = {
  user: string
  password: string
  /** Who signs in and their password, told apart without either (`credentialsOf`): sessions opened with others end. */
  credentials: string
  hours: number
  /** The cookie is sent over HTTPS only: the monitor is opened on an `https` address. */
  secureCookie: boolean
}
