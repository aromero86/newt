import { useEffect, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Alert } from '@cooper/ui/components/alert'
import { Box, BoxRow } from '@cooper/ui/components/box'
import { Button } from '@cooper/ui/components/button'
import { ConfirmDialog } from '@cooper/ui/components/confirm-dialog'
import { Stack } from '@cooper/ui/components/stack'
import { Subhead } from '@cooper/ui/components/subhead'
import { Text } from '@cooper/ui/components/text'
import { FormField } from '@cooper/core/form/form-field'
import { Provide } from '@cooper/core/injector/provide'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
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

/** The workspace's name and, apart, deleting it. Its admin's only. */
function WorkspaceSettingsGeneralWrapped() {
  const service = useService(WorkspaceSettingsGeneralService)
  const workspace = useValue(useService(WorkspacesService).workspace(useParams().workspaceId!))
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)
  const confirmingDelete = useValue(service.confirmingDelete)
  const deleting = useValue(service.deleting)
  const navigate = useNavigate()

  useEffect(() => {
    if (workspace) service.edit(workspace)
  }, [service, workspace])

  if (!workspace) return null

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.save()
  }

  async function remove() {
    if (await service.delete()) navigate('/', { replace: true })
  }

  return (
    <Stack gap={8}>
      <section>
        <Subhead title="General" description="What the workspace is called, everywhere its members see it." />
        <form onSubmit={onSubmit} noValidate>
          <Stack gap={4} align="start">
            {failure && <Alert tone="bad" title="Could not save">{failure}</Alert>}
            <FormField form={service.form} name="name" label="Name" />
            <Button type="submit" loading={submitting}>Rename</Button>
          </Stack>
        </form>
      </section>
      <section>
        <Subhead title="Danger zone" tone="danger" />
        <Box label="Danger zone">
          <BoxRow trailing={<Button size="sm" variant="destructive" onClick={() => service.askDelete()}>Delete workspace</Button>}>
            <Text size="sm" weight="semibold">Delete this workspace</Text>
            <Text size="sm" tone="muted">Its boards, columns and cards are gone, and its members lose access. It cannot be undone.</Text>
          </BoxRow>
        </Box>
      </section>
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={open => !open && service.cancelDelete()}
        title={`Delete ${workspace.name}?`}
        description="Its boards, columns and cards are gone for good, and its members lose access."
        confirmLabel="Delete workspace"
        tone="destructive"
        loading={deleting}
        onConfirm={() => void remove()}
      />
    </Stack>
  )
}
