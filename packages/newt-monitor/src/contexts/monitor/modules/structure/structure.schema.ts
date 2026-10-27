import type { ApplicationDescription } from 'newt/contract'
import { z } from 'zod'

/** What an application was made of at some time, as its endpoint described it (`describeApplication`). */
export const StructureVersionSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  /** SHA-256 of the description: the same one twice is the same structure. */
  hash: z.string().length(64),
  description: z.custom<ApplicationDescription>(value => typeof value === 'object' && value !== null),
  takenAt: z.iso.datetime(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export type StructureVersionDTO = z.infer<typeof StructureVersionSchema>

/** A version in a list: everything but the description. */
export type StructureVersionSummaryDTO = Omit<StructureVersionDTO, 'description' | 'createdAt' | 'updatedAt'>

/** What `structure.changed` tells: the application, its new version, and the one before, if any. */
export type StructureChangedDTO = { appId: string, versionId: string, previousVersionId: string | null }

/**
 * What a refresh came to: a new version (`changed`), the same as the last
 * (`unchanged`), or nothing read: the application not answering (`unreachable`), or
 * archived, so not watched (`archived`), its last version as it was.
 */
export type RefreshDTO =
  | { appId: string, outcome: 'changed' | 'unchanged', version: StructureVersionSummaryDTO }
  | { appId: string, outcome: 'unreachable', version: StructureVersionSummaryDTO | null, failure: { reason: string, message: string } }
  | { appId: string, outcome: 'archived', version: StructureVersionSummaryDTO | null }

/** What the hourly refresh came to, application by application. */
export type RefreshAllDTO = { refreshed: RefreshDTO[] }
