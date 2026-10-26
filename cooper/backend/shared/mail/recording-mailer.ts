import type { Mail, Mailer } from './mailer'

/**
 * A mailer that keeps each email in a list instead of sending it: a test's. An email
 * with a key already kept is not kept again, as a provider sends it once.
 */
export class RecordingMailer implements Mailer {

  readonly mails: Mail[] = []

  async send(mail: Mail): Promise<void> {
    if (mail.key !== undefined && this.mails.some(each => each.key === mail.key)) return
    this.mails.push(mail)
  }
}
