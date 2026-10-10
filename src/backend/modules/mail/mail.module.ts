import type { Base } from '../../base/base'
import { currentUnitOfWork } from '../../core/unit-of-work/current-unit-of-work'
import { Module } from '../../core/module/module'
import { smtpTransport } from './infrastructure/smtp-transport'
import type { Mail_Options } from './mail-options'
import { MailMessageSchema, type MailMessageDTO } from './mail.schema'

/**
 * Sends emails. Other modules call it from their workers, after their transaction
 * committed: an email cannot be taken back, so it never leaves for something that
 * may still roll back.
 */
export class Mail_Module extends Module {

  static async initialize(base: Base, options: Mail_Options) {
    return new Mail_Module(base, options)
  }

  private readonly transport

  private constructor(base: Base, private readonly options: Mail_Options) {
    super('mail', base.transactions)
    this.transport = smtpTransport(options)
  }

  // Not a use case on purpose: it must never run inside a transaction, and a use
  // case would open one. Calling it from a use case is a bug, so it fails loudly.
  async send(message: MailMessageDTO): Promise<void> {
    if (currentUnitOfWork()) throw new Error('mail.send runs from a worker, outside any transaction')
    const { to, subject, text, html } = MailMessageSchema.parse(message)
    await this.transport.sendMail({ from: this.options.from, to, subject, text, html })
  }
}
