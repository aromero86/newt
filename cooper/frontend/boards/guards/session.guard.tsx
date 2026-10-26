import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { NarrowPage } from '@cooper/ui/components/narrow-page'
import { Spinner } from '@cooper/ui/components/spinner'
import { Provide } from '@cooper/core/injector/provide'
import type { ServiceClass } from '@cooper/core/injector/service-class'
import { useService } from '@cooper/core/injector/use-service'
import { useValue } from '@cooper/core/store/use-value'
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
  if (!user) return <SignIn />

  // Keyed by the person: someone else signing in starts every service below from scratch.
  return (
    <Provide key={user.id} services={SESSION_SERVICES}>
      <Outlet />
    </Provide>
  )
}
