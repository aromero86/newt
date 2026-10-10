import type { DimensionDTO } from '@newt/api/dimension'
import type { RuleScopeDTO } from '@newt/api/rule'
import { Inline } from '@newt/ui/components/inline'
import { Text } from '@newt/ui/components/text'
import { DimensionChip } from '@newt/ui/domain/dimension-chip'

type DefinitionRuleScopeProps = {
  scope: RuleScopeDTO
  /** The workspace's dimensions, retired values included, to name what the scope points at. */
  dimensions: DimensionDTO[]
}

/** Where a rule applies, one chip per value; with no scope, everywhere. */
export function DefinitionRuleScope({ scope, dimensions }: DefinitionRuleScopeProps) {
  if (scope.length === 0) return <Text size="sm" tone="muted">Applies everywhere</Text>

  return (
    <Inline gap={1} wrap>
      {scope.flatMap(({ dimensionId, valueIds }) => {
        const dimension = dimensions.find(candidate => candidate.id === dimensionId)
        return valueIds.map(valueId => (
          <DimensionChip
            key={valueId}
            name={dimension?.name ?? 'Dimension'}
            value={dimension?.values.find(value => value.id === valueId)?.name ?? 'Unknown'}
          />
        ))
      })}
    </Inline>
  )
}
