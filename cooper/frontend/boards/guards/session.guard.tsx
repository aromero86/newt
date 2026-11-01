import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { Alert } from '@newt-kit/react-ui/alert'
import { Button } from '@newt-kit/react-ui/button'
import { NarrowPage } from '@newt-kit/react-ui/narrow-page'
import { Spinner } from '@newt-kit/react-ui/spinner'
import { Provide, type ServiceClass, useService, useValue } from '@newt-kit/react'
import { SignIn } from '../pages/sign-in/sign-in'
import { SessionService } from '../services/session/session.service'
import { WorkspacesService } from '../services/workspaces/workspaces.service'

/** App-wide services whose data belongs to the signed-in person go here, never at the root. */
const SESSION_SERVICES: ServiceClass[] = [WorkspacesService]

/**
 * Guards every route of the app: without a session, it shows the way to sign in
 * where the page would be, so signing in comes back to the same address.
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
        <Spinner label="Loading Cooper" />
      </NarrowPage>
    )
  }
  if (status === 'failed') {
    return (
      <NarrowPage>
        <Alert tone="bad" title="Could not reach Cooper">Whether you are signed in is not known yet.</Alert>
        <Button block variant="outline" onClick={() => void session.check()}>Retry</Button>
      </NarrowPage>
    )
  }
  if (!user) return <SignIn />

  // Keyed by the person: someone else signing in starts every service below from scratch.
  return (
    <Provide key={user.id} services={SESSION_SERVICES}>
      <Outlet />
    </Provide>
  )
}
