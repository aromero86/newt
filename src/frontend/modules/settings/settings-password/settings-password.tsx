import type { FormEvent } from 'react'
import { Alert } from '@newt/ui/components/alert'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Stack } from '@newt/ui/components/stack'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { FormField } from '../../../components/form-field'
import { SettingsPasswordService } from './settings-password.service'

/** With its own SettingsPasswordService: whoever renders it needs nothing else. */
export function SettingsPassword() {
  return (
    <Provide services={[SettingsPasswordService]}>
      <SettingsPasswordWrapped />
    </Provide>
  )
}

function SettingsPasswordWrapped() {
  const service = useService(SettingsPasswordService)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.change()
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card
        title="Password"
        titleLevel={2}
        description="Changing it signs you out everywhere else."
        footer={<Button type="submit" loading={submitting}>Change password</Button>}
      >
        <Stack gap={4}>
          {failure && <Alert tone="bad" title="Could not change it">{failure}</Alert>}
          <FormField form={service.form} name="currentPassword" label="Current password" type="password" autoComplete="current-password" />
          <FormField form={service.form} name="newPassword" label="New password" type="password" description="At least 8 characters." autoComplete="new-password" />
          <FormField form={service.form} name="confirmPassword" label="New password, again" type="password" autoComplete="new-password" />
        </Stack>
      </Card>
    </form>
  )
}
