import type { Mail, Mailer } from './mailer'

/** A mailer that writes each email to the console instead of sending it: cooper's, in development. */
export class ConsoleMailer implements Mailer {

  constructor(private readonly from: string) {}

  async send(mail: Mail): Promise<void> {
    console.log([`[mail] from ${this.from} to ${mail.to}: ${mail.subject}`, ...mail.text.split('\n').map(line => `  ${line}`)].join('\n'))
  }
}
