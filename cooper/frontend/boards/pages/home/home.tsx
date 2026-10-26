import { KanbanIcon } from 'lucide-react'
import { EmptyState } from '@cooper/ui/components/empty-state'
import { PageBody } from '@cooper/ui/components/page-body'
import { PageHeader } from '@cooper/ui/components/page-header'
import { Stack } from '@cooper/ui/components/stack'

/** Where the app opens. A placeholder until the workspaces and their boards arrive. */
export function Home() {
  return (
    <PageBody>
      <Stack gap={6}>
        <PageHeader title="Boards" description="Plan your work in columns and cards." />
        <EmptyState icon={KanbanIcon} title="Nothing here yet" description="Your workspaces and their boards will show here." />
      </Stack>
    </PageBody>
  )
}
