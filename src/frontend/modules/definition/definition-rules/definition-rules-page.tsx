import { PageHeader } from '@newt/ui/components/page-header'
import { Stack } from '@newt/ui/components/stack'
import { DefinitionRules } from './definition-rules'

/** Every rule of the workspace, to filter by where it applies. */
export function DefinitionRulesPage() {
  return (
    <Stack gap={8}>
      <PageHeader title="Rules" description="What must always hold true, across the whole product." />
      <DefinitionRules />
    </Stack>
  )
}
