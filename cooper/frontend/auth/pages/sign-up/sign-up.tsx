import { useEffect, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { Alert } from 'newt-react-ui/alert'
import { Button } from 'newt-react-ui/button'
import { Card } from 'newt-react-ui/card'
import { TextLink } from 'newt-react-ui/link'
import { PageHeader } from 'newt-react-ui/page-header'
import { Stack } from 'newt-react-ui/stack'
import { Text } from 'newt-react-ui/text'
import { FormField } from 'newt-react/form-field'
import { Provide, useService, useValue } from 'newt-react'
import { AuthorizationService } from '../../services/authorization/authorization.service'
import { SessionService } from '../../services/session/session.service'
import { keepingAuthorization, nextOf } from '../sign-in/sign-in-next'
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
  const session = useService(SessionService)
  const authorizations = useService(AuthorizationService)
  const status = useValue(session.status)
  const review = useValue(authorizations.review)
  const submitting = useValue(service.form.submitting)
  const failure = useValue(service.form.failure)
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const { authorization, next } = nextOf(search)
  const signIn = keepingAuthorization('/sign-in', authorization)

  useEffect(() => {
    void session.check()
    void authorizations.load(authorization)
  }, [session, authorizations, authorization])

  if (status === 'signed-in') return <Navigate to={next} replace />

  // A product that lets in only whom it was told: nobody makes an account for it.
  if (review && !review.product.signUp) {
    return (
      <>
        <PageHeader title={`${review.product.name} takes no new accounts`} />
        <Alert tone="warn" title="Ask for access">Someone who runs {review.product.name} gives access to it. If you have an account already, sign in with it.</Alert>
        <Button href={signIn} variant="outline" block>Sign in</Button>
      </>
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (await service.submit(review?.product.id)) navigate(next, { replace: true })
  }

  return (
    <>
      <PageHeader title="Create your Cooper account" description={review ? `One account for every Cooper app. Then you go on to ${review.product.name}.` : 'One account for every Cooper app.'} />
      <form onSubmit={onSubmit} noValidate>
        <Card footer={<Button type="submit" block loading={submitting}>Create account</Button>}>
          <Stack gap={4}>
            {failure && <Alert tone="bad" title="Could not create the account">{failure}</Alert>}
            <FormField form={service.form} name="name" label="Name" autoComplete="name" />
            <FormField form={service.form} name="email" label="Email" type="email" autoComplete="email" />
            <FormField form={service.form} name="password" label="Password" type="password" autoComplete="new-password" description="At least 8 characters." />
          </Stack>
        </Card>
      </form>
      <Text size="sm" tone="muted">
        Already have an account? <TextLink href={signIn}>Sign in</TextLink>
      </Text>
    </>
  )
}
