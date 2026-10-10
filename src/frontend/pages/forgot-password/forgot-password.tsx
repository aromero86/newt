import type { FormEvent } from 'react'
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
import { ForgotPasswordService } from './forgot-password.service'

/** With its own ForgotPasswordService: whoever renders it needs nothing else. */
export function ForgotPassword() {
  return (
    <Provide services={[ForgotPasswordService]}>
      <ForgotPasswordWrapped />
    </Provide>
  )
}

function ForgotPasswordWrapped() {
  const service = useService(ForgotPasswordService)
  const sent = useValue(service.sent)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void service.submit()
  }

  return (
    <NarrowPage>
      <Logo />
      <PageHeader title="Forgot your password?" description="We will email you a link to choose a new one." />
      {sent ? (
        <Alert tone="ok" title="Check your email">
          If there is an account with that email, a link to reset its password is on its way. Your current password keeps working until you use it.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <Card footer={<Button type="submit" loading={submitting}>Send the link</Button>}>
            <Stack gap={4}>
              {failure && <Alert tone="bad" title="Could not send it">{failure}</Alert>}
              <FormField form={service.form} name="email" label="Email" type="email" autoComplete="email" />
            </Stack>
          </Card>
        </form>
      )}
      <Text size="sm" tone="muted">
        Remembered it? <TextLink href="/sign-in">Sign in</TextLink>
      </Text>
    </NarrowPage>
  )
}
