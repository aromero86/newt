import { TagIcon } from 'lucide-react'
import { EmptyState } from '@newt/ui/components/empty-state'
import { PageHeader } from '@newt/ui/components/page-header'
import { Stack } from '@newt/ui/components/stack'

export function Releases() {
  return (
    <Stack gap={8}>
      <PageHeader title="Releases" description="Product versions, released together with the code that implements them." />
      <EmptyState icon={TagIcon} title="Nothing here yet" description="This zone arrives in a later phase." />
    </Stack>
  )
}
