import { z } from 'zod'

/** Which application, and which process of it, as its endpoint said the last time it answered. */
export const IdentitySchema = z.object({
  name: z.string(),
  newt: z.string(),
  instance: z.object({ id: z.string(), host: z.string(), pid: z.number() }),
  startedAt: z.string(),
})

/** Why it did not answer the last time it was asked. */
export const FailureSchema = z.object({
  reason: z.enum(['unreachable', 'key_rejected', 'bad_answer', 'key_unreadable']),
  message: z.string(),
})

/** Whether an application answers, as the monitor last found it. */
export const ConnectionSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  status: z.enum(['up', 'down']),
  identity: IdentitySchema.nullable().default(null),
  failure: FailureSchema.nullable().default(null),
  /** When it was last asked. */
  checkedAt: z.iso.datetime(),
  /** When it last answered: null if it never has. */
  lastSeenAt: z.iso.datetime().nullable().default(null),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type IdentityDTO = z.infer<typeof IdentitySchema>
export type FailureDTO = z.infer<typeof FailureSchema>
export type ConnectionDTO = z.infer<typeof ConnectionSchema>

/** What the monitor knows of whether an application answers: `unknown` until it first asks. */
export type ConnectionStatusDTO = Pick<ConnectionDTO, 'appId' | 'identity' | 'failure' | 'checkedAt' | 'lastSeenAt'> & {
  status: ConnectionDTO['status'] | 'unknown'
}

/** What `connection.lost` and `connection.restored` tell. */
export type ConnectionChangedDTO = { appId: string, failure: FailureDTO | null }
