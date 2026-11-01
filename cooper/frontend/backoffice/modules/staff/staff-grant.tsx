import type { FormEvent } from 'react'
import { Alert } from 'newt-kit-react-ui/alert'
import { Button } from 'newt-kit-react-ui/button'
import { Card } from 'newt-kit-react-ui/card'
import { Stack } from 'newt-kit-react-ui/stack'
import { toast } from 'newt-kit-react-ui/toast'
import { FormField } from 'newt-kit-react/form-field'
import { useService, useValue } from 'newt-kit-react'
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
