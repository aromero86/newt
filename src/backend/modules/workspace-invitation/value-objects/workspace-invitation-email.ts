import type { ValueObject } from '../../../core/value-objects/value-object'
import { MailMessageSchema, type MailMessageDTO } from '../../mail/mail.schema'
import type { WorkspaceInvitationCreatedPayload } from '../workspace-invitation.schema'

/** The email that invites someone to a workspace: a message the `mail` module sends as is. */
export type WorkspaceInvitationEmail = MailMessageDTO

type WorkspaceInvitationEmailInput = {
  invitation: WorkspaceInvitationCreatedPayload
  /** Where people open newt: the sign-up link points there. */
  publicUrl: string
}

const escape = (text: string) => text.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!)

export const WorkspaceInvitationEmail = {

  schema: MailMessageSchema,

  from({ invitation, publicUrl }: WorkspaceInvitationEmailInput): WorkspaceInvitationEmail {
    const link = `${publicUrl.replace(/\/$/, '')}/sign-up?email=${encodeURIComponent(invitation.email)}`
    const until = new Date(invitation.expiresAt).toISOString().slice(0, 10)
    return {
      to: invitation.email,
      subject: `${invitation.inviterFullName} invited you to ${invitation.workspaceName} on newt`,
      text: [
        `${invitation.inviterFullName} invited you to the workspace ${invitation.workspaceName} on newt.`,
        '',
        'Create your account with this email and you will be in:',
        '',
        link,
        '',
        `The invitation waits for you until ${until}.`,
      ].join('\n'),
      html: `<p>${escape(invitation.inviterFullName)} invited you to the workspace <b>${escape(invitation.workspaceName)}</b> on newt.</p>
<p>Create your account with this email and you will be in:</p>
<p><a href="${escape(link)}">Create your account</a></p>
<p>The invitation waits for you until ${until}.</p>`,
    }
  },

} satisfies ValueObject<WorkspaceInvitationEmail, WorkspaceInvitationEmailInput>
