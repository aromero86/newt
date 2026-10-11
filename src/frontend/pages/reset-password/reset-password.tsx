import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Alert } from '@newt/ui/components/alert'
import { Button } from '@newt/ui/components/button'
import { Card } from '@newt/ui/components/card'
import { TextLink } from '@newt/ui/components/link'
import { NarrowPage } from '@newt/ui/components/narrow-page'
import { PageHeader } from '@newt/ui/components/page-header'
import { Stack } from '@newt/ui/components/stack'
import { Text } from '@newt/ui/components/text'
import { Logo } from '@newt/ui/domain/logo'
import { FormField } from '../../components/form-field'
import { Provide } from '../../core/injector/provide'
import { useService } from '../../core/injector/use-service'
import { useValue } from '../../core/store/use-value'
import { ResetPasswordService } from './reset-password.service'

/** With its own ResetPasswordService: whoever renders it needs nothing else. */
export function ResetPassword() {
  return (
    <Provide services={[ResetPasswordService]}>
      <ResetPasswordWrapped />
    </Provide>
  )
}

function ResetPasswordWrapped() {
  const service = useService(ResetPasswordService)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)
  const token = useSearchParams()[0].get('token') ?? ''
  const navigate = useNavigate()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (await service.submit(token)) {
      navigate('/sign-in', { replace: true, state: { notice: 'Your password was changed. Sign in with the new one.' } })
    }
  }

  return (
    <NarrowPage>
      <Logo />
      <PageHeader title="Choose a new password" description="Every session of your account will be signed out." />
      <form onSubmit={onSubmit} noValidate>
        <Card footer={<Button type="submit" block loading={submitting}>Change password</Button>}>
          <Stack gap={4}>
            {failure && <Alert tone="bad" title="Could not change it">{failure}</Alert>}
            <FormField form={service.form} name="password" label="New password" type="password" description="At least 8 characters." autoComplete="new-password" />
            <FormField form={service.form} name="confirmPassword" label="New password, again" type="password" autoComplete="new-password" />
          </Stack>
        </Card>
      </form>
      <Text size="sm" tone="muted">
        Link not working? <TextLink href="/forgot-password">Ask for a new one</TextLink>
      </Text>
    </NarrowPage>
  )
}
