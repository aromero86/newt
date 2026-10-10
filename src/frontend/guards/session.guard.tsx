import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { NarrowPage } from '@newt/ui/components/narrow-page'
import { Spinner } from '@newt/ui/components/spinner'
import { Provide } from '../core/injector/provide'
import type { ServiceClass } from '../core/injector/service-class'
import { useService } from '../core/injector/use-service'
import { useValue } from '../core/store/use-value'
import { SessionService } from '../services/session/session.service'
import { WorkspacesService } from '../services/workspaces/workspaces.service'

/** App-wide services whose data belongs to the signed-in user go here, never at the root. */
const SESSION_SERVICES: ServiceClass[] = [WorkspacesService]

/** Guards every route of newt: without a session, it sends the person to sign in. */
export function SessionGuard() {
  const session = useService(SessionService)
  const status = useValue(session.status)
  const user = useValue(session.user)
  const location = useLocation()

  useEffect(() => {
    if (status === 'checking') void session.check()
  }, [session, status])

  if (status === 'checking') {
    return (
      <NarrowPage>
        <Spinner label="Loading newt" />
      </NarrowPage>
    )
  }
  if (!user) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />

  // Keyed by the user: someone else signing in starts every service below from scratch.
  return (
    <Provide key={user.id} services={SESSION_SERVICES}>
      <Outlet />
    </Provide>
  )
}
