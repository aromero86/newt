/** Where emails leave from: any SMTP server, set in the environment. */
export type Mail_Options = {
  host: string
  port: number
  /** TLS from the first byte (usually port 465). Otherwise STARTTLS is used when the server offers it. */
  secure: boolean
  /** Empty when the server needs no login. */
  user: string
  password: string
  /** The sender, as in `newt <no-reply@acme.dev>`. */
  from: string
}
