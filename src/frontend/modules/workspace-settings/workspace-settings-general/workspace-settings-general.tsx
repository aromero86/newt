import { useEffect, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { Alert } from '@newt/ui/components/alert'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Inline } from '@newt/ui/components/inline'
import { Stack } from '@newt/ui/components/stack'
import { FormField } from '../../../components/form-field'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { WorkspacesService } from '../../../services/workspaces/workspaces.service'
import { WorkspaceSettingsGeneralService } from './workspace-settings-general.service'

/** With its own WorkspaceSettingsGeneralService: whoever renders it needs nothing else. */
export function WorkspaceSettingsGeneral() {
  return (
    <Provide services={[WorkspaceSettingsGeneralService]}>
      <WorkspaceSettingsGeneralWrapped />
    </Provide>
  )
}

function WorkspaceSettingsGeneralWrapped() {
  const service = useService(WorkspaceSettingsGeneralService)
  const workspace = useValue(useService(WorkspacesService).workspace(useParams().workspaceId!))
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)

  useEffect(() => {
    if (workspace) service.edit(workspace)
  }, [service, workspace])

  if (!workspace) return null
  const archived = workspace.archivedAt !== null

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.save()
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card
        title="General"
        titleLevel={2}
        description={archived ? 'Archived: read only until you unarchive it.' : 'What the workspace is called and what product it defines.'}
        footer={
          <Inline gap={2} wrap>
            <Button type="submit" loading={submitting} disabled={archived}>Save</Button>
            {archived
              ? <Button variant="outline" onClick={() => void service.unarchive()}>Unarchive</Button>
              : <Button variant="outline" onClick={() => void service.archive()}>Archive</Button>}
          </Inline>
        }
      >
        <Stack gap={4}>
          {failure && <Alert tone="bad" title="Could not save">{failure}</Alert>}
          <FormField form={service.form} name="name" label="Name" />
          <FormField form={service.form} name="description" label="Description" rows={3} />
        </Stack>
      </Card>
    </form>
  )
}
