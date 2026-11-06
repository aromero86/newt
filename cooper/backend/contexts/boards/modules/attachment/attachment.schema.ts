import { z } from 'zod'

/** What may be attached to a card: what a browser cannot run, and at most this long. */
export const ATTACHMENT_RULE = {
  types: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain'],
  maxBytes: 10 * 1024 * 1024,
} as const

/** How many files a card may have, whichever their state. */
export const MAX_ATTACHMENTS = 20

/** A file of a card. Pending until `uploadConfirm` has looked at what came. */
export const AttachmentSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.string(),
  cardId: z.string(),
  /** The name it is saved under when downloaded: never where it is kept. */
  filename: z.string().trim().min(1, 'A file has a name').max(255, 'Use at most 255 characters'),
  contentType: z.enum(ATTACHMENT_RULE.types, 'Attach an image, a PDF or a text file'),
  /** What the client said until it is verified; how long it really is from then on. */
  sizeBytes: z.number().int().min(0),
  status: z.enum(['pending', 'ready']),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** What a client says of a file it is about to upload: its word, until `uploadConfirm`. */
export const AttachmentStartSchema = z.object({
  filename: AttachmentSchema.shape.filename,
  contentType: AttachmentSchema.shape.contentType,
  sizeBytes: z.number().int().positive('The file is empty').max(ATTACHMENT_RULE.maxBytes, 'The file is too long'),
})

export type AttachmentDTO = z.infer<typeof AttachmentSchema>
export type AttachmentStartDTO = z.input<typeof AttachmentStartSchema>
/** What `uploadStart` answers: the attachment, and where to `PUT` its file. */
export type AttachmentUploadDTO = { attachment: AttachmentDTO, uploadUrl: string }
