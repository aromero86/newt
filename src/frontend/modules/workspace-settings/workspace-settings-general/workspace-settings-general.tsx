import { useEffect, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { Alert } from '@newt/ui/components/alert'
import { Box, BoxRow } from '@newt/ui/components/box'
import { Button } from '@newt/ui/components/button'
import { Stack } from '@newt/ui/components/stack'
import { Subhead } from '@newt/ui/components/subhead'
import { Text } from '@newt/ui/components/text'
import { FormField } from '../../../components/form-field'
import { WORKSPACE_LANGUAGES } from '../../../services/workspaces/workspace-languages'
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

/** The workspace's name and description and, apart, archiving it. Admins only. */
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
    <Stack gap={8}>
      <section>
        <Subhead title="General" description={archived ? 'Archived: read only until you unarchive it.' : 'What the workspace is called and what product it defines.'} />
        <form onSubmit={onSubmit} noValidate>
          <Stack gap={4} align="start">
            {failure && <Alert tone="bad" title="Could not save">{failure}</Alert>}
            <FormField form={service.form} name="name" label="Name" />
            <FormField form={service.form} name="description" label="Description" rows={3} />
            <FormField form={service.form} name="language" label="Language" description="What its definition is written in: newt writes the deltas it reads from documents in it." options={WORKSPACE_LANGUAGES} />
            <Button type="submit" loading={submitting} disabled={archived}>Save</Button>
          </Stack>
        </form>
      </section>
      <section>
        <Subhead title="Danger zone" tone="danger" />
        <Box label="Danger zone">
          <BoxRow trailing={archived
            ? <Button size="sm" variant="outline" onClick={() => void service.unarchive()}>Unarchive</Button>
            : <Button size="sm" variant="destructive" onClick={() => void service.archive()}>Archive</Button>}
          >
            <Text size="sm" weight="semibold">{archived ? 'Unarchive this workspace' : 'Archive this workspace'}</Text>
            <Text size="sm" tone="muted">{archived ? 'It takes changes again: proposals, releases, settings.' : 'It stays readable, but takes no more changes until it is unarchived.'}</Text>
          </BoxRow>
        </Box>
      </section>
    </Stack>
  )
}
