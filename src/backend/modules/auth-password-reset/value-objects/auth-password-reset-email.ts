import type { ValueObject } from '../../../core/value-objects/value-object'
import { MailMessageSchema, type MailMessageDTO } from '../../mail/mail.schema'
import type { AuthPasswordResetRequestedPayload } from '../auth-password-reset.schema'

/** The email with the reset link: a message the `mail` module sends as is. */
export type AuthPasswordResetEmail = MailMessageDTO

type AuthPasswordResetEmailInput = {
  request: AuthPasswordResetRequestedPayload
  /** Where people open newt: the link points there. */
  publicUrl: string
  /** How long the link works. */
  minutes: number
}

const escape = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!)

export const AuthPasswordResetEmail = {

  schema: MailMessageSchema,

  from({ request, publicUrl, minutes }: AuthPasswordResetEmailInput): AuthPasswordResetEmail {
    const link = `${publicUrl.replace(/\/$/, '')}/reset-password?token=${request.token}`
    const name = request.fullName.split(' ')[0] ?? request.fullName
    return {
      to: request.email,
      subject: 'Reset your newt password',
      text: [
        `Hi ${name},`,
        '',
        'Someone asked to reset the password of your newt account. If it was you, open this link to choose a new one:',
        '',
        link,
        '',
        `It works once, for ${minutes} minutes. Until you use it, your current password keeps working.`,
        '',
        'If it was not you, ignore this email: nothing changes.',
      ].join('\n'),
      html: `<p>Hi ${escape(name)},</p>
<p>Someone asked to reset the password of your newt account. If it was you, choose a new one:</p>
<p><a href="${escape(link)}">Reset your password</a></p>
<p>It works once, for ${minutes} minutes. Until you use it, your current password keeps working.</p>
<p>If it was not you, ignore this email: nothing changes.</p>`,
    }
  },

} satisfies ValueObject<AuthPasswordResetEmail, AuthPasswordResetEmailInput>
