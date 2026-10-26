import type { FormEvent } from 'react'
import { Alert } from '@cooper/ui/components/alert'
import { Button } from '@cooper/ui/components/button'
import { Card } from '@cooper/ui/components/card'
import { Stack } from '@cooper/ui/components/stack'
import { toast } from '@cooper/ui/components/toast'
import { FormField } from '@cooper/core/form/form-field'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
import { StaffService } from './staff.service'

/** Gives someone with an account access to the backoffice, by their email. */
export function StaffGrant() {
  const staff = useService(StaffService)
  const submitting = useValue(staff.form.submitting)
  const failure = useValue(staff.form.failure)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (await staff.grant()) toast.success('They are staff now')
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card
        title="Add someone to the staff"
        titleLevel={2}
        description="They sign up at Cooper first; then they can sign in here."
        footer={<Button type="submit" loading={submitting}>Grant access</Button>}
      >
        <Stack gap={4}>
          {failure && <Alert tone="bad" title="Could not grant the access">{failure}</Alert>}
          <FormField form={staff.form} name="email" label="Email" type="email" autoComplete="off" placeholder="someone@example.com" />
        </Stack>
      </Card>
    </form>
  )
}
