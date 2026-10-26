import type { Email } from 'newt/core'

/** Whatever sends an email: an SMTP server in production, a list in a test. */
export type Mailer = {
  send(mail: { to: Email, subject: string, text: string }): Promise<void>
}

export type Notification_Options = {
  mailer: Mailer
}
