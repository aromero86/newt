import type { AvatarConfirmedDTO, AvatarStartDTO, AvatarUploadDTO } from '../../../backend/contexts/auth/modules/avatar/avatar.schema'
import { Requester } from '@newt-kit/react'

/** auth's `avatar` module: the picture of whoever is signed in. */
export class AvatarApi extends Requester {
  protected readonly path = '/avatars'

  /** A picture about to be uploaded: where to send it. */
  uploadStart(input: AvatarStartDTO) {
    return this.post<AvatarUploadDTO>('', input)
  }

  /** The file was sent: whether it is what it said, and where it is read from. */
  uploadConfirm(avatarId: string) {
    return this.post<AvatarConfirmedDTO>(`/${avatarId}/confirm`)
  }
}
