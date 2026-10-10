import type { FormEvent } from 'react'
import { Alert } from '@newt/ui/components/alert'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { Stack } from '@newt/ui/components/stack'
import { Provide } from '../../../core/injector/provide'
import { useService } from '../../../core/injector/use-service'
import { useValue } from '../../../core/store/use-value'
import { FormField } from '../../../components/form-field'
import { SettingsProfileService } from './settings-profile.service'

/** With its own SettingsProfileService: whoever renders it needs nothing else. */
export function SettingsProfile() {
  return (
    <Provide services={[SettingsProfileService]}>
      <SettingsProfileWrapped />
    </Provide>
  )
}

function SettingsProfileWrapped() {
  const service = useService(SettingsProfileService)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.save()
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card title="Profile" titleLevel={2} description="How others see you in newt." footer={<Button type="submit" loading={submitting}>Save profile</Button>}>
        <Stack gap={4}>
          {failure && <Alert tone="bad" title="Could not save">{failure}</Alert>}
          <FormField form={service.form} name="nick" label="Nick" description="How others mention you: @nick." autoComplete="username" />
          <FormField form={service.form} name="fullName" label="Full name" autoComplete="name" />
          <FormField form={service.form} name="email" label="Email" type="email" autoComplete="email" />
          <FormField form={service.form} name="bio" label="Bio" description="Up to 500 characters." rows={4} />
        </Stack>
      </Card>
    </form>
  )
}
