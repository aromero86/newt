import type { DeltaDTO } from '@newt/api/proposal'
import { Badge } from '@newt/ui/components/badge'
import { Inline } from '@newt/ui/components/inline'
import { Text } from '@newt/ui/components/text'
import { ArtifactTag } from '@newt/ui/domain/artifact-tag'

/** How each kind of artifact is called. */
export const KIND_LABEL = { 'dimension': 'dimension', 'feature-area': 'area', 'feature': 'feature', 'rule': 'rule' } as const

/** How each operation is said. */
export const OPERATION_LABEL = { create: 'Create', change: 'Change', retire: 'Retire', restore: 'Restore' } as const

/** A delta's title: what it does, to which artifact. */
export function DeltaTitle({ delta }: { delta: Pick<DeltaDTO, 'kind' | 'operation' | 'targetLabel'> }) {
  return (
    <Inline gap={2} wrap>
      <Text size="sm" weight="semibold" as="span">{OPERATION_LABEL[delta.operation]}</Text>
      {delta.kind === 'rule'
        ? <ArtifactTag kind="rule" id={delta.targetLabel} />
        : <><Badge tone="outline">{KIND_LABEL[delta.kind]}</Badge><Text size="sm" as="span">{delta.targetLabel}</Text></>}
    </Inline>
  )
}
