import type { FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
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
import { SignUpService } from './sign-up.service'

/** With its own SignUpService: whoever renders it needs nothing else. */
export function SignUp() {
  return (
    <Provide services={[SignUpService]}>
      <SignUpWrapped />
    </Provide>
  )
}

function SignUpWrapped() {
  const service = useService(SignUpService)
  const status = useValue(useService(SessionService).status)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)
  const navigate = useNavigate()

  if (status === 'signed-in') return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (await service.submit()) navigate('/', { replace: true })
  }

  return (
    <NarrowPage>
      <Logo />
      <PageHeader title="Create your account" description="Everything you do in newt is signed with it." />
      <form onSubmit={onSubmit} noValidate>
        <Card footer={<Button type="submit" loading={submitting}>Create account</Button>}>
          <Stack gap={4}>
            {failure && <Alert tone="bad" title="Could not create the account">{failure}</Alert>}
            <FormField form={service.form} name="nick" label="Nick" description="How others see and mention you: @nick." autoComplete="username" />
            <FormField form={service.form} name="fullName" label="Full name" autoComplete="name" />
            <FormField form={service.form} name="email" label="Email" type="email" autoComplete="email" />
            <FormField form={service.form} name="password" label="Password" type="password" description="At least 8 characters." autoComplete="new-password" />
            <FormField form={service.form} name="bio" label="Bio" description="Optional, up to 500 characters." rows={3} />
          </Stack>
        </Card>
      </form>
      <Text size="sm" tone="muted">
        Already have an account? <TextLink href="/sign-in">Sign in</TextLink>
      </Text>
    </NarrowPage>
  )
}
