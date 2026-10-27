import { z } from 'zod'

/** An application the monitor watches, as it keeps it: its key sealed (`KeyCipher`), never the key. */
export const AppSchema = z.object({
  id: z.uuidv7(),
  name: z.string().trim().min(1).max(100),
  /** Where its monitor endpoint is (`serveMonitor`): `http://cooper:3010`. */
  url: z.url({ protocol: /^https?$/ }),
  sealedKey: z.string().min(1),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** What anyone sees of it: everything but its key. */
export const AppPublicSchema = AppSchema.omit({ sealedKey: true })

/** An endpoint's address, as it is kept: its origin and path, no query, no `/` at the end. */
const EndpointUrlSchema = AppSchema.shape.url
  .refine(url => !url.includes('?') && !url.includes('#'), 'An endpoint\'s address has no query and no fragment')
  .transform(url => url.replace(/\/+$/, ''))

/** The key it shares with the application: as `serveMonitor` asks it, 32 characters or more. */
export const AppKeySchema = z.string().min(32).max(512)

/** What a client sends to register one. */
export const AppRegisterSchema = z.object({
  name: AppSchema.shape.name,
  url: EndpointUrlSchema,
  key: AppKeySchema,
})

/** What a client sends to change one: any of them, at least one. */
export const AppUpdateSchema = AppRegisterSchema.partial()
  .refine(change => Object.values(change).some(value => value !== undefined), 'Say what changes: name, url or key')

export type AppDTO = z.infer<typeof AppPublicSchema>
export type AppRegisterDTO = z.input<typeof AppRegisterSchema>
export type AppUpdateDTO = z.input<typeof AppUpdateSchema>

/** What `app.updated` tells: the application now, and which of its fields changed (`key` among them, never its value). */
export type AppUpdatedDTO = { dto: AppDTO, changed: ('name' | 'url' | 'key')[] }
