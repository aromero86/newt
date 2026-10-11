import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { Alert } from '@newt/ui/components/alert'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { TextLink } from '@newt/ui/components/link'
import { NarrowPage } from '@newt/ui/components/narrow-page'
import { PageHeader } from '@newt/ui/components/page-header'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { Logo } from '@newt/ui/domain/logo'
import { Provide } from '../../core/injector/provide'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { SessionService } from '../../services/session/session.service'
import { FormField } from '../../components/form-field'
import { SignInService } from './sign-in.service'

/** With its own SignInService: whoever renders it needs nothing else. */
export function SignIn() {
  return (
    <Provide services={[SignInService]}>
      <SignInWrapped />
    </Provide>
  )
}

function SignInWrapped() {
  const service = useService(SignInService)
  const status = useValue(useService(SessionService).status)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)
  const navigate = useNavigate()
  // Where the person was going when they were sent here, and anything to tell them on arrival.
  const state = useLocation().state as { from?: string, notice?: string } | null
  const from = state?.from ?? '/'

  if (status === 'signed-in') return <Navigate to={from} replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (await service.submit()) navigate(from, { replace: true })
  }

  return (
    <NarrowPage>
      <Logo />
      <PageHeader title="Sign in" description="The living definition of your product." />
      {state?.notice && <Alert tone="ok" title="Done">{state.notice}</Alert>}
      <form onSubmit={onSubmit} noValidate>
        <Card footer={<Button type="submit" block loading={submitting}>Sign in</Button>}>
          <Stack gap={4}>
            {failure && <Alert tone="bad" title="Could not sign in">{failure}</Alert>}
            <FormField form={service.form} name="login" label="Nick or email" autoComplete="username" />
            <FormField form={service.form} name="password" label="Password" type="password" autoComplete="current-password" />
          </Stack>
        </Card>
      </form>
      <Stack gap={2}>
        <Text size="sm" tone="muted">
          <TextLink href="/forgot-password">Forgot your password?</TextLink>
        </Text>
        <Text size="sm" tone="muted">
          New to newt? <TextLink href="/sign-up">Create an account</TextLink>
        </Text>
      </Stack>
    </NarrowPage>
  )
}
