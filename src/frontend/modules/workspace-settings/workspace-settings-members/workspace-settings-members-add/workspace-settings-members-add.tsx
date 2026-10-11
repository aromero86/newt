import type { FormEvent } from 'react'
import { Button } from '@newt/ui/components/button'
import { Dialog } from '@newt/ui/components/dialog'
import { Inline } from '@newt/ui/components/inline'
import { Stack } from '@newt/ui/components/stack'
import { FormField } from '../../../../components/form-field'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { WorkspaceSettingsMembersAddService } from './workspace-settings-members-add.service'

/** The dialog to bring someone in, by nick or by email; its service opens it. */
export function WorkspaceSettingsMembersAdd() {
  const service = useService(WorkspaceSettingsMembersAddService)
  const open = useValue(service.open)
  const submitting = useValue(service.form.submitting)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.submit()
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && service.close()} title="Add people" description="A nick adds someone with an account. An email invites anyone, with or without one." size="md">
      <form onSubmit={onSubmit} noValidate>
        <Stack gap={4}>
          <FormField form={service.form} name="login" label="Nick or email" />
          <Inline justify="end"><Button type="submit" loading={submitting}>Add</Button></Inline>
        </Stack>
      </form>
    </Dialog>
  )
}
