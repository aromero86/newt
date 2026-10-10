import { GitPullRequestIcon } from 'lucide-react'
import { EmptyState } from '@newt/ui/components/empty-state'
import { PageHeader } from '@newt/ui/components/page-header'
import { Stack } from '@newt/ui/components/stack'

export function Proposals() {
  return (
    <Stack gap={8}>
      <PageHeader title="Proposals" description="Changes to the definition, discussed and approved delta by delta." />
      <EmptyState icon={GitPullRequestIcon} title="Nothing here yet" description="This zone arrives in a later phase." />
    </Stack>
  )
}
