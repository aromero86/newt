import { useEffect, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { Alert } from '@cooper/ui/components/alert'
import { Button } from '@cooper/ui/components/button'
import { Card } from '@cooper/ui/components/card'
import { TextLink } from '@cooper/ui/components/link'
import { PageHeader } from '@cooper/ui/components/page-header'
import { Stack } from '@cooper/ui/components/stack'
import { Text } from '@cooper/ui/components/text'
import { FormField } from '@cooper/core/form/form-field'
import { Provide } from '@cooper/core/injector/provide'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
import { AuthorizationService } from '../../services/authorization/authorization.service'
import { SessionService } from '../../services/session/session.service'
import { keepingAuthorization, nextOf } from './sign-in-next'
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
  const session = useService(SessionService)
  const authorizations = useService(AuthorizationService)
  const status = useValue(session.status)
  const review = useValue(authorizations.review)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const { authorization, next } = nextOf(search)

  useEffect(() => {
    void session.check()
    void authorizations.load(authorization)
  }, [session, authorizations, authorization])

  if (status === 'signed-in') return <Navigate to={next} replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (await service.submit()) navigate(next, { replace: true })
  }

  return (
    <>
      <PageHeader title="Sign in to Cooper" description={review ? `to continue to ${review.product.name}` : 'One account for every Cooper app.'} />
      <form onSubmit={onSubmit} noValidate>
        <Card footer={<Button type="submit" block loading={submitting}>Sign in</Button>}>
          <Stack gap={4}>
            {failure && <Alert tone="bad" title="Could not sign in">{failure}</Alert>}
            <FormField form={service.form} name="email" label="Email" type="email" autoComplete="username" />
            <FormField form={service.form} name="password" label="Password" type="password" autoComplete="current-password" />
          </Stack>
        </Card>
      </form>
      {(!review || review.product.signUp) && (
        <Text size="sm" tone="muted">
          New to Cooper? <TextLink href={keepingAuthorization('/sign-up', authorization)}>Create an account</TextLink>
        </Text>
      )}
    </>
  )
}
