import { z } from 'zod'

export const MailModuleName = 'mail'

/** One email: plain text for every reader, HTML for those who show it. */
export const MailMessageSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().min(1),
})

export type MailMessageDTO = z.infer<typeof MailMessageSchema>
