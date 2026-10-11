import type { DimensionDTO } from '@newt/api/dimension'
import type { RuleScopeDTO } from '@newt/api/rule'
import { Inline } from '@newt/ui/components/inline'
import { Text } from '@newt/ui/components/text'
import { DimensionChip } from '@newt/ui/domain/dimension-chip'

type RuleScopeProps = {
  scope: RuleScopeDTO
  /** The workspace's dimensions, retired values included, to name what the scope points at. */
  dimensions: DimensionDTO[]
  /** `xs` inside a line of small print, such as a row's details. */
  size?: 'xs' | 'sm'
}

/** Where a rule applies, one chip per value; with no scope, everywhere. */
export function RuleScope({ scope, dimensions, size = 'sm' }: RuleScopeProps) {
  if (scope.length === 0) return <Text size={size} tone="muted" as="span">Applies everywhere</Text>

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
