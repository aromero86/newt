import { z } from 'zod'

/** A commit an application deployed: when its first instance built from it started, and its message once its repository told it. */
export const DeploymentSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  commit: z.string().min(1),
  /** Its message's first line: null until its repository tells it, or if it never does. */
  title: z.string().nullable().default(null),
  /** What its message says after its first line: null when nothing, or until its title is known. */
  description: z.string().nullable().default(null),
  /** When its first instance the monitor heard of started. */
  deployedAt: z.iso.datetime(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type DeploymentDTO = z.infer<typeof DeploymentSchema>

/** What `deployment.recorded` tells: a commit an application deployed for the first time. */
export type DeploymentRecordedDTO = DeploymentDTO
