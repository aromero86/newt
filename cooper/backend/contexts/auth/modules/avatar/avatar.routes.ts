import type { AuthBase } from '../../auth-base'
import type { Avatar_Module } from './avatar.module'

/** Always about whoever is signed in. No route takes a file: the client sends it to the address `uploadStart` gives. */
export function registerAvatarRoutes(base: AuthBase, avatars: Avatar_Module): void {
  base.http.post('/avatars', async request => Response.json(await avatars.uploadStart(await request.json()), { status: 201 }))

  base.http.post('/avatars/:avatarId/confirm', async request => Response.json(await avatars.uploadConfirm(request.params.avatarId)))
}
