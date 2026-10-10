import { useParams } from 'react-router'
import { PageHeader } from '@newt/ui/components/page-header'
import { Stack } from '@newt/ui/components/stack'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'
import { DefinitionDimensions } from './definition-dimensions/definition-dimensions'

export function Definition() {
  const workspaceId = useParams().workspaceId!
  const workspace = useValue(useService(WorkspacesService).workspace(workspaceId))

  return (
    <Stack gap={8}>
      <PageHeader title="Definition" description="What your product does today, and what it will do once accepted proposals ship." />
      <DefinitionDimensions workspaceId={workspaceId} readOnly={Boolean(workspace?.archivedAt)} />
    </Stack>
  )
}
