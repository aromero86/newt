import { z } from 'zod'

/** What a picture of someone may be: an image a browser cannot run, and at most this long. */
export const AVATAR_RULE = {
  types: ['image/png', 'image/jpeg', 'image/webp'],
  maxBytes: 2 * 1024 * 1024,
} as const

/** A picture of someone. Pending until `uploadConfirm` has looked at what came. */
export const AvatarSchema = z.object({
  id: z.uuidv7(),
  userId: z.string(),
  contentType: z.enum(AVATAR_RULE.types, 'Choose a PNG, a JPEG or a WebP image'),
  status: z.enum(['pending', 'ready']),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** What a client says of a picture it is about to upload: its word, until `uploadConfirm`. */
export const AvatarStartSchema = z.object({
  contentType: AvatarSchema.shape.contentType,
  sizeBytes: z.number().int().positive('The image is empty').max(AVATAR_RULE.maxBytes, 'The image is too long'),
})

export type AvatarDTO = z.infer<typeof AvatarSchema>
export type AvatarStartDTO = z.input<typeof AvatarStartSchema>
/** What `uploadStart` answers: the picture, and where to `PUT` its file. */
export type AvatarUploadDTO = { avatar: AvatarDTO, uploadUrl: string }
/** What `uploadConfirm` answers: where it is read from, by anyone. */
export type AvatarConfirmedDTO = { avatar: AvatarDTO, url: string }
