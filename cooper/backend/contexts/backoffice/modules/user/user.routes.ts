import { pageRequestFrom } from '@newt-kit/newt/http'
import type { CooperBase } from '../../../../shared/cooper-base'
import { staffRoutes } from '../../staff-routes'
import type { User_Deps } from './user.deps'
import type { User_Module } from './user.module'

export function registerUserRoutes(base: CooperBase, users: User_Module, deps: User_Deps): void {
  const routes = staffRoutes(base, deps.staff)

  // `?text=ana@cooper.dev`: an email or a name, whole.
  routes.get('/users', async request => {
    const text = new URL(request.url).searchParams.get('text') || undefined
    return Response.json(await users.list({ text }, pageRequestFrom(request)))
  })

  routes.get('/users/:userId', async request => Response.json(await users.get(request.params.userId)))

  routes.get('/users/:userId/workspaces', async request => Response.json(await users.workspaces(request.params.userId, pageRequestFrom(request))))
}
