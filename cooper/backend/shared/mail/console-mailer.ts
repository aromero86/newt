import type { Mail, Mailer } from './mailer'

/**
 * A mailer that writes each email to the console instead of sending it: cooper's, in
 * development. It remembers the keys it wrote while the process runs: an email with
 * one of them is not written again.
 */
export class ConsoleMailer implements Mailer {

  private readonly sent = new Set<string>()

  constructor(private readonly from: string) {}

  async send(mail: Mail): Promise<void> {
    if (mail.key !== undefined) {
      if (this.sent.has(mail.key)) return
      this.sent.add(mail.key)
    }
    console.log([`[mail] from ${this.from} to ${mail.to}: ${mail.subject}`, ...mail.text.split('\n').map(line => `  ${line}`)].join('\n'))
  }
}
