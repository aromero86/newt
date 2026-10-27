import { useEffect, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Alert } from 'newt-react-ui/alert'
import { Box, BoxRow } from 'newt-react-ui/box'
import { Button } from 'newt-react-ui/button'
import { ConfirmDialog } from 'newt-react-ui/confirm-dialog'
import { Stack } from 'newt-react-ui/stack'
import { Subhead } from 'newt-react-ui/subhead'
import { Text } from 'newt-react-ui/text'
import { FormField } from 'newt-react/form-field'
import { Provide, useService, useValue } from 'newt-react'
import type { AppDTO } from '../../../api/app'
import { AppSettingsService } from './app-settings.service'

/** With its own AppSettingsService. */
export function AppSettings({ app }: { app: AppDTO }) {
  return (
    <Provide services={[AppSettingsService]}>
      <AppSettingsWrapped app={app} />
    </Provide>
  )
}

/** Where it is and its key, and apart, its life: archiving, restoring, deleting. */
function AppSettingsWrapped({ app }: { app: AppDTO }) {
  const service = useService(AppSettingsService)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)
  const confirming = useValue(service.confirming)
  const working = useValue(service.working)
  const navigate = useNavigate()

  useEffect(() => {
    service.edit(app)
  }, [service, app])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.save(app)
  }

  async function remove() {
    if (await service.delete(app)) navigate('/?status=archived', { replace: true })
  }

  return (
    <Stack gap={8}>
      <Stack gap={0}>
        <Subhead title="General" description="Where its monitor endpoint is, and the key it shares with the monitor. A new address or key is saved only once it answers with them." />
        <form onSubmit={onSubmit} noValidate>
          <Stack gap={4} align="start">
            {failure && <Alert tone="bad" title="Could not save">{failure}</Alert>}
            <FormField form={service.form} name="name" label="Name" autoComplete="off" />
            <FormField form={service.form} name="url" label="Endpoint" description="Its serveMonitor address, reachable from the monitor." autoComplete="off" />
            <FormField form={service.form} name="key" label="Key" type="password" description="Leave it empty to keep the one it has: it is kept encrypted and never shown." autoComplete="off" />
            <Button type="submit" loading={submitting}>Save changes</Button>
          </Stack>
        </form>
      </Stack>
      <Stack gap={0}>
        <Subhead title="Danger zone" tone="danger" />
        <Box label="Danger zone">
          {app.archivedAt
            ? (
                <BoxRow trailing={<Button size="sm" variant="outline" loading={working} onClick={() => void service.restore(app)}>Restore</Button>}>
                  <Text size="sm" weight="semibold">Restore this application</Text>
                  <Text size="sm" tone="muted">It is watched again: its connection checked and its structure read every hour.</Text>
                </BoxRow>
              )
            : (
                <BoxRow trailing={<Button size="sm" variant="outline" onClick={() => service.ask('archive')}>Archive</Button>}>
                  <Text size="sm" weight="semibold">Archive this application</Text>
                  <Text size="sm" tone="muted">It stops being watched. Everything known of it is kept, and it can be restored.</Text>
                </BoxRow>
              )}
          <BoxRow trailing={<Button size="sm" variant="destructive" disabled={!app.archivedAt} onClick={() => service.ask('delete')}>Delete</Button>}>
            <Text size="sm" weight="semibold">Delete this application</Text>
            <Text size="sm" tone="muted">
              {app.archivedAt
                ? 'Everything known of it goes with it: its connection, its versions and its catalog. It cannot be undone.'
                : 'Only an archived application can be deleted: archive it first.'}
            </Text>
          </BoxRow>
        </Box>
      </Stack>
      <ConfirmDialog
        open={confirming === 'archive'}
        onOpenChange={open => !open && service.cancel()}
        title={`Archive ${app.name}?`}
        description="It stops being watched. Everything known of it is kept, and it can be restored."
        confirmLabel="Archive"
        loading={working}
        onConfirm={() => void service.archive(app)}
      />
      <ConfirmDialog
        open={confirming === 'delete'}
        onOpenChange={open => !open && service.cancel()}
        title={`Delete ${app.name}?`}
        description="Everything known of it goes with it: its connection, its versions and its catalog. It cannot be undone."
        confirmLabel="Delete this application"
        tone="destructive"
        confirmWith={app.name}
        loading={working}
        onConfirm={() => void remove()}
      />
    </Stack>
  )
}
