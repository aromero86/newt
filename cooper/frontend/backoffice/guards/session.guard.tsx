import { Fragment, useEffect } from 'react'
import { Outlet } from 'react-router'
import { Alert } from 'newt-react-ui/alert'
import { Button } from 'newt-react-ui/button'
import { NarrowPage } from 'newt-react-ui/narrow-page'
import { Spinner } from 'newt-react-ui/spinner'
import { useService, useValue } from 'newt-react'
import { SignIn } from '../pages/sign-in/sign-in'
import { SessionService } from '../services/session/session.service'

/**
 * Guards every route of the backoffice: without a session of someone of the staff,
 * it shows the way to sign in where the page would be, so signing in comes back to
 * the same address.
 */
export function SessionGuard() {
  const session = useService(SessionService)
  const status = useValue(session.status)
  const user = useValue(session.user)

  useEffect(() => {
    if (status === 'checking') void session.check()
  }, [session, status])

  if (status === 'checking') {
    return (
      <NarrowPage>
        <Spinner label="Loading the backoffice" />
      </NarrowPage>
    )
  }
  if (status === 'failed') {
    return (
      <NarrowPage>
        <Alert tone="bad" title="Could not reach the backoffice">Whether you are signed in is not known yet.</Alert>
        <Button block variant="outline" onClick={() => void session.check()}>Retry</Button>
      </NarrowPage>
    )
  }
  if (!user) return <SignIn refused={status === 'refused'} />

  // Keyed by the person: someone else signing in starts every service below from scratch.
  // Each zone provides its own services, so none is app-wide here.
  return <Fragment key={user.id}><Outlet /></Fragment>
}
