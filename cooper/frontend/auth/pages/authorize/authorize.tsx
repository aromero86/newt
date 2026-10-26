import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router'
import { Alert } from '@cooper/ui/components/alert'
import { Button } from '@cooper/ui/components/button'
import { Card } from '@cooper/ui/components/card'
import { Inline } from '@cooper/ui/components/inline'
import { PageHeader } from '@cooper/ui/components/page-header'
import { Spinner } from '@cooper/ui/components/spinner'
import { Stack } from '@cooper/ui/components/stack'
import { Text } from '@cooper/ui/components/text'
import { Provide } from '@cooper/core/injector/provide'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
import { AuthorizationService } from '../../services/authorization/authorization.service'
import { SessionService } from '../../services/session/session.service'
import { keepingAuthorization } from '../sign-in/sign-in-next'
import { AuthorizeService } from './authorize.service'

/** With its own AuthorizeService: whoever renders it needs nothing else. */
export function Authorize() {
  return (
    <Provide services={[AuthorizeService]}>
      <AuthorizeWrapped />
    </Provide>
  )
}

function AuthorizeWrapped() {
  const service = useService(AuthorizeService)
  const status = useValue(service.status)
  const deciding = useValue(service.deciding)
  const failure = useValue(service.failure)
  const review = useValue(useService(AuthorizationService).review)
  const user = useValue(useService(SessionService).user)
  const id = useParams().id ?? ''

  useEffect(() => {
    void service.load(id)
  }, [service, id])

  if (status === 'signed-out') return <Navigate to={keepingAuthorization('/sign-in', id)} replace />
  if (status === 'missing') {
    return (
      <>
        <PageHeader title="This request does not exist" />
        <Alert tone="bad" title="Nothing to answer">Go back to the application and sign in again.</Alert>
      </>
    )
  }
  if (status === 'closed') {
    return (
      <>
        <PageHeader title="This request is over" />
        <Alert tone="warn" title="Answered or expired">It was answered already, or waited too long. Go back to the application and try again.</Alert>
      </>
    )
  }
  if (status !== 'consent' || !review) {
    return <Spinner label={review ? `Signing in to ${review.product.name}` : 'Loading the request'} />
  }

  return (
    <>
      <PageHeader title={`${review.clientName} wants to access your Cooper account`} description={user ? `Signed in as ${user.email}.` : undefined} />
      <Card
        footer={(
          <Inline justify="end">
            <Button variant="ghost" loading={deciding === 'deny'} disabled={deciding !== null} onClick={() => void service.deny()}>Cancel</Button>
            <Button loading={deciding === 'approve'} disabled={deciding !== null} onClick={() => void service.approve()}>Authorize {review.clientName}</Button>
          </Inline>
        )}
      >
        <Stack gap={4}>
          {failure && <Alert tone="bad" title="Could not answer">{failure}</Alert>}
          <Text size="sm">It will act for you in {review.product.name}: read your workspaces and boards, and create, move and assign cards, as you would.</Text>
          <Text size="sm" tone="muted">{`Authorizing sends you back to ${review.redirectHost}.`}</Text>
        </Stack>
      </Card>
    </>
  )
}
