import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { NarrowPage } from 'newt-react-ui/narrow-page'
import { Spinner } from 'newt-react-ui/spinner'
import { useService, useValue } from 'newt-react'
import { SignIn } from '../pages/sign-in/sign-in'
import { SessionService } from '../services/session/session.service'

/**
 * Guards every route of the monitor: without a session it shows the way to sign in
 * where the page would be, so signing in stays on the same address.
 */
export function SessionGuard() {
  const session = useService(SessionService)
  const status = useValue(session.status)

  useEffect(() => {
    if (status === 'checking') void session.check()
  }, [session, status])

  if (status === 'checking') {
    return (
      <NarrowPage>
        <Spinner label="Loading the monitor" />
      </NarrowPage>
    )
  }
  if (status === 'signed-out') return <SignIn />
  return <Outlet />
}
