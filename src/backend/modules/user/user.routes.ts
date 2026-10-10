import type { Base } from '../../base/base'
import type { UserUpdateDTO } from './user'
import type { User_Module } from './user.module'

export function registerUserRoutes(base: Base, users: User_Module) {
  // The signed-in person's own profile. The use case validates the body.
  base.http.patch('/users/me', async request => Response.json(await users.updateMine((await request.json()) as UserUpdateDTO)))
}
