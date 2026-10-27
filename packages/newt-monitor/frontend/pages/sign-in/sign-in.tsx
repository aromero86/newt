import type { FormEvent } from 'react'
import { Alert } from 'newt-react-ui/alert'
import { Button } from 'newt-react-ui/button'
import { Card } from 'newt-react-ui/card'
import { NarrowPage } from 'newt-react-ui/narrow-page'
import { PageHeader } from 'newt-react-ui/page-header'
import { Stack } from 'newt-react-ui/stack'
import { FormField } from 'newt-react/form-field'
import { Provide, useService, useValue } from 'newt-react'
import { Brand } from '../../components/brand/brand'
import { SignInService } from './sign-in.service'

/** Where the page would be, while nobody is signed in: signing in shows it. */
export function SignIn() {
  return (
    <Provide services={[SignInService]}>
      <SignInWrapped />
    </Provide>
  )
}

function SignInWrapped() {
  const service = useService(SignInService)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.submit()
  }

  return (
    <NarrowPage>
      <Brand size="lg" />
      <PageHeader title="Sign in to newt-monitor" />
      <form onSubmit={onSubmit} noValidate>
        <Card footer={<Button type="submit" block loading={submitting}>Sign in</Button>}>
          <Stack gap={4}>
            {failure && <Alert tone="bad" title="Could not sign in">{failure}</Alert>}
            <FormField form={service.form} name="user" label="User" autoComplete="username" />
            <FormField form={service.form} name="password" label="Password" type="password" autoComplete="current-password" />
          </Stack>
        </Card>
      </form>
    </NarrowPage>
  )
}
