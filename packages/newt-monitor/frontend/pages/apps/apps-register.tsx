import type { FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { Alert } from 'newt-react-ui/alert'
import { Button } from 'newt-react-ui/button'
import { Dialog } from 'newt-react-ui/dialog'
import { Inline } from 'newt-react-ui/inline'
import { Stack } from 'newt-react-ui/stack'
import { toast } from 'newt-react-ui/toast'
import { FormField } from 'newt-react/form-field'
import { useService, useValue } from 'newt-react'
import { AppsService } from './apps.service'

/** The dialog to register an application; its service opens it. It is saved only if it answers. */
export function AppsRegister() {
  const service = useService(AppsService)
  const open = useValue(service.registering)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)
  const navigate = useNavigate()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const app = await service.register()
    if (!app) return
    toast.success(`${app.name} answers: it is watched now`)
    navigate(`/apps/${app.id}`)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => !next && service.closeRegister()}
      title="New application"
      description="Where its monitor endpoint listens, and the key it shares with the monitor. The monitor asks it first: it is saved only if it answers."
    >
      <form onSubmit={event => void onSubmit(event)} noValidate>
        <Stack gap={4}>
          {failure && <Alert tone="bad" title="Could not register it">{failure}</Alert>}
          <FormField form={service.form} name="name" label="Name" placeholder="cooper" autoComplete="off" />
          <FormField form={service.form} name="url" label="Endpoint" placeholder="http://cooper:3010" description="Its serveMonitor address, reachable from the monitor." autoComplete="off" />
          <FormField form={service.form} name="key" label="Key" type="password" description="The key it was started with: 32 characters or more. It is kept encrypted." autoComplete="off" />
          <Inline justify="end" gap={2}>
            <Button variant="outline" onClick={() => service.closeRegister()}>Cancel</Button>
            <Button type="submit" loading={submitting}>Register application</Button>
          </Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
