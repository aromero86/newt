import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { Alert } from 'newt-react-ui/alert'
import { Button } from 'newt-react-ui/button'
import { Card } from 'newt-react-ui/card'
import { Inline } from 'newt-react-ui/inline'
import { PageHeader } from 'newt-react-ui/page-header'
import { Spinner } from 'newt-react-ui/spinner'
import { Stack } from 'newt-react-ui/stack'
import { Text } from 'newt-react-ui/text'
import { Provide, useService, useValue } from 'newt-react'
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
  const navigate = useNavigate()
  const [switching, setSwitching] = useState(false)

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
  if (status === 'refused' && review?.refused) {
    // Signed out of auth, the person signs in with another account, and comes back to this request.
    const switchAccount = async () => {
      setSwitching(true)
      await service.switchAccount().finally(() => setSwitching(false))
      navigate(keepingAuthorization('/sign-in', id), { replace: true })
    }
    return (
      <>
        <PageHeader title={`This account cannot use ${review.product.name}`} description={user ? `Signed in as ${user.email}.` : undefined} />
        <Card
          footer={(
            <Inline justify="end">
              <Button variant="ghost" loading={deciding === 'deny'} disabled={deciding !== null || switching} onClick={() => void service.deny()}>Back</Button>
              <Button loading={switching} disabled={deciding !== null} onClick={() => void switchAccount()}>Use another account</Button>
            </Inline>
          )}
        >
          <Stack gap={4}>
            <Alert tone="bad" title="No access">{review.refused.message}</Alert>
            {failure && <Alert tone="bad" title="Could not go back">{failure}</Alert>}
            <Text size="sm" tone="muted">{`Back returns to ${review.redirectHost} without signing in.`}</Text>
          </Stack>
        </Card>
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
