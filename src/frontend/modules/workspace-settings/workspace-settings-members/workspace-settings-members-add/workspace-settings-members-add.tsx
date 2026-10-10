import type { FormEvent } from 'react'
import { Button } from '@newt/ui/components/button'
import { Stack } from '@newt/ui/components/stack'
import { FormField } from '../../../../components/form-field'
import { Provide } from '../../../../core/injector/provide'
import { useService } from '../../../../core/injector/use-service'
import { useValue } from '../../../../core/store/use-value'
import { WorkspaceSettingsMembersAddService } from './workspace-settings-members-add.service'

/** With its own WorkspaceSettingsMembersAddService: whoever renders it needs nothing else. */
export function WorkspaceSettingsMembersAdd() {
  return (
    <Provide services={[WorkspaceSettingsMembersAddService]}>
      <WorkspaceSettingsMembersAddWrapped />
    </Provide>
  )
}

function WorkspaceSettingsMembersAddWrapped() {
  const service = useService(WorkspaceSettingsMembersAddService)
  const submitting = useValue(service.form.submitting)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.submit()
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack gap={3} align="start">
        <FormField form={service.form} name="login" label="Add someone" description="A nick adds someone with an account. An email invites anyone, with or without one." />
        <Button type="submit" variant="secondary" loading={submitting}>Add</Button>
      </Stack>
    </form>
  )
}
