import { pageRequestFrom } from 'newt/http'
import type { CooperBase } from '../../../../shared/cooper-base'
import { staffRoutes } from '../../staff-routes'
import type { Staff_Module } from './staff.module'
import type { StaffGrantDTO } from './staff.schema'

export function registerStaffRoutes(base: CooperBase, staff: Staff_Module): void {
  const routes = staffRoutes(base, staff)

  routes.get('/staff', async request => Response.json(await staff.list(pageRequestFrom(request))))

  routes.post('/staff', async request => {
    const input = await request.json() as StaffGrantDTO
    return Response.json(await staff.grant(input), { status: 201 })
  })

  routes.delete('/staff/:userId', async request => {
    await staff.revoke(request.params.userId)
    return new Response(null, { status: 204 })
  })
}
