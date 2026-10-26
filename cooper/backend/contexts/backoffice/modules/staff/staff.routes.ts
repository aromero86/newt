import { pageRequestFrom } from 'newt/http'
import type { CooperBase } from '../../../../shared/cooper-base'
import { staffRoutes } from '../../staff-routes'
import type { Staff_Module } from './staff.module'

export function registerStaffRoutes(base: CooperBase, staff: Staff_Module): void {
  const routes = staffRoutes(base, staff)

  routes.get('/staff', async request => Response.json(await staff.list(pageRequestFrom(request))))

  routes.post('/staff', async request => Response.json(await staff.grant(await request.json()), { status: 201 }))

  routes.delete('/staff/:userId', async request => {
    await staff.revoke(request.params.userId)
    return new Response(null, { status: 204 })
  })
}
