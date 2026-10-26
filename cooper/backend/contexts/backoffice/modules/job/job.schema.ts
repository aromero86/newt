import { z } from 'zod'
import type { DeadJobDTO } from '../../../../shared/outbox/outbox.schema'

/** The contexts whose jobs the staff look after: each one runs its own. */
export const JOB_CONTEXTS = ['auth', 'boards', 'backoffice'] as const

export const JobContextSchema = z.enum(JOB_CONTEXTS)

export type JobContext = z.infer<typeof JobContextSchema>

/** A dead job of a context, as the staff's page lists it. */
export type ContextJobDTO = DeadJobDTO & { context: JobContext }
