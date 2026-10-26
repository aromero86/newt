import { LayoutDashboardIcon } from 'lucide-react'
import { EmptyState } from '@cooper/ui/components/empty-state'
import { PageBody } from '@cooper/ui/components/page-body'
import { PageHeader } from '@cooper/ui/components/page-header'
import { Stack } from '@cooper/ui/components/stack'

/** Where the console opens. A placeholder until workspaces, users, staff and metrics arrive. */
export function Home() {
  return (
    <PageBody>
      <Stack gap={6}>
        <PageHeader title="Backoffice" description="Cooper's workspaces, people and numbers, for its staff." />
        <EmptyState icon={LayoutDashboardIcon} title="Nothing here yet" description="Workspaces, users, staff and metrics will show here." />
      </Stack>
    </PageBody>
  )
}
