import type { CooperBase } from '../../shared/cooper-base'
import type { Staff_Module } from './modules/staff/staff.module'

/**
 * The routes of the backoffice's API: each one runs once `staff.enter` has checked the
 * signed-in person is of the staff now (403 for anyone else). auth already refused
 * anyone else at signing in (the product's access is `granted`); this counts an
 * access taken away since, at once. Every module of the backoffice registers its
 * routes on it.
 */
export function staffRoutes(base: CooperBase, staff: Staff_Module) {
  return base.http.group('', async (_request, next) => {
    await staff.enter()
    return next()
  })
}
