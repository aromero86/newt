import { Stack } from '@newt/ui/components/stack'
import { Subhead } from '@newt/ui/components/subhead'
import { DefinitionRules } from './definition-rules'

/** Every rule of the workspace, to filter by where it applies. */
export function DefinitionRulesPage() {
  return (
    <Stack gap={4}>
      <Subhead title="Rules" description="What must always hold true, across the whole product." />
      <DefinitionRules />
    </Stack>
  )
}
