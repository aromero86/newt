import type { Mailer } from '../../../../shared/mail/mailer'

export type Invitation_Options = {
  /** The product whose workspaces it invites to, whose access accepting gives: `cooper`. */
  productId: string
  /** How long an invitation waits to be accepted. */
  days: number
  /** Where its email leaves from. */
  mailer: Mailer
  /** The page of the invitation's link, where it is accepted: boards', which shows the workspace. */
  acceptUrl: (token: string) => string
}
