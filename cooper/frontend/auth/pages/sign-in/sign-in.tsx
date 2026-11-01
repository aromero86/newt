import { useEffect, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { Alert } from '@newt-kit/react-ui/alert'
import { Button } from '@newt-kit/react-ui/button'
import { Card } from '@newt-kit/react-ui/card'
import { TextLink } from '@newt-kit/react-ui/link'
import { PageHeader } from '@newt-kit/react-ui/page-header'
import { Stack } from '@newt-kit/react-ui/stack'
import { Text } from '@newt-kit/react-ui/text'
import { FormField } from '@newt-kit/react/form-field'
import { Provide, useService, useValue } from '@newt-kit/react'
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
      <PageHeader title={`Sign in to ${review?.product.name ?? 'Cooper'}`} description="With your Cooper account: one for every Cooper app." />
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
