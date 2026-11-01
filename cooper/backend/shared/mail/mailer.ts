import type { Email } from '@newt-kit/newt/core'

/** One email: plain text, which every reader shows. */
export type Mail = {
  to: Email
  subject: string
  text: string
  /**
   * The same email sent again has the same key, and is sent once: what a worker gives
   * when its job may run twice (the id of the event it tells of). A mailer of a real
   * provider must honour it, passing it as the provider's idempotency key (most take
   * one, as a header). None: each send is a new email.
   */
  key?: string
}

/**
 * Whatever sends an email: the console in development, a list in a test, an SMTP
 * server or an email API in production. A module sends one only from a worker, once
 * what it tells is saved: an email cannot be taken back. An email with a `key`
 * already sent is not sent again.
 */
export type Mailer = {
  send(mail: Mail): Promise<void>
}
