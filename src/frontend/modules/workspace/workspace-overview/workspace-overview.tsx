import { useParams } from 'react-router'
import { Badge } from '@newt/ui/components/badge'
import { Card } from '@newt/ui/components/card'
import { Grid } from '@newt/ui/components/grid'
import { TextLink } from '@newt/ui/components/link'
import { PageHeader } from '@newt/ui/components/page-header'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'

const zones = [
  { path: 'definition', title: 'Definition', description: 'What the product does today, and what it will do once accepted proposals ship.' },
  { path: 'proposals', title: 'Proposals', description: 'Changes to the definition, approved delta by delta.' },
  { path: 'releases', title: 'Releases', description: 'Product versions that ship together with the code.' },
]

/** A workspace's front page: what it is, and its zones. */
export function WorkspaceOverview() {
  const workspaceId = useParams().workspaceId!
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))
  if (!workspace) return null

  return (
    <Stack gap={8}>
      <PageHeader
        title={workspace.name}
        description={workspace.description || undefined}
        actions={workspace.archivedAt ? <Badge tone="warn">archived</Badge> : undefined}
      />
      <Grid columns={{ base: 1, md: 3 }} gap={4}>
        {zones.map(zone => (
          <Card key={zone.path} title={zone.title} description={zone.description} footer={<TextLink href={`/w/${workspace.id}/${zone.path}`}>Open {zone.title.toLowerCase()}</TextLink>}>
            <Text tone="muted" size="sm">Empty for now.</Text>
          </Card>
        ))}
      </Grid>
    </Stack>
  )
}
