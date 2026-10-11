import { z } from 'zod'
import type { ValueObject } from '../../../core/value-objects/value-object'
import { ReleaseChangeSchema, type ReleaseArtifactDTO, type ReleaseChangeDTO } from '../release.schema'

/** What differs between two pictures of a definition, artifact by artifact; proposals still to link. */
export type ReleaseDiff = ReleaseChangeDTO[]

type ReleaseDiffInput = {
  /** The earlier picture; empty before the first release, so everything is new. */
  before: ReleaseArtifactDTO[]
  after: ReleaseArtifactDTO[]
}

const ORDER = { 'dimension': 0, 'feature-area': 1, 'feature': 2, 'rule': 3 }

/**
 * What defines an artifact: everything but whether it is retired, and the names of
 * where it lives, which only label it: renaming a feature does not change its rules.
 */
function definition(artifact: ReleaseArtifactDTO): string {
  const { retired: _, ...rest } = artifact
  if ('featureName' in rest) delete (rest as { featureName?: string }).featureName
  if ('areaName' in rest) delete (rest as { areaName?: string }).areaName
  return JSON.stringify(rest)
}

function label(artifact: ReleaseArtifactDTO): string {
  return artifact.kind === 'rule' ? artifact.key : artifact.name
}

export const ReleaseDiff = {

  schema: z.array(ReleaseChangeSchema),

  /**
   * Compares the pictures, so changes in between count once, from how it was to
   * how it is, and a change undone does not show. Dimensions first, then areas,
   * features and rules.
   */
  from({ before, after }: ReleaseDiffInput): ReleaseDiff {
    const earlier = new Map(before.map(artifact => [artifact.id, artifact]))
    const changes: ReleaseDiff = []
    for (const now of after) {
      const was = earlier.get(now.id)
      const change = !was ? (now.retired ? null : 'added')
        : was.retired && !now.retired ? 'restored'
          : !was.retired && now.retired ? 'retired'
            : !now.retired && definition(was) !== definition(now) ? 'changed'
              : null
      if (change) changes.push({ id: now.id, kind: now.kind, change, label: label(now), before: was ?? null, after: now, proposals: [] })
    }
    return changes.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.label.localeCompare(b.label, 'en', { numeric: true }))
  },

} satisfies ValueObject<ReleaseDiff, ReleaseDiffInput>
