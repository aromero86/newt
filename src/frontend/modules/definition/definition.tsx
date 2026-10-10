import { BookOpenIcon } from 'lucide-react'
import { EmptyState } from '@newt/ui/components/empty-state'
import { PageHeader } from '@newt/ui/components/page-header'
import { Stack } from '@newt/ui/components/stack'

export function Definition() {
  return (
    <Stack gap={8}>
      <PageHeader title="Definition" description="What your product does today, and what it will do once accepted proposals ship." />
      <EmptyState icon={BookOpenIcon} title="Nothing here yet" description="This zone arrives in a later phase." />
    </Stack>
  )
}
