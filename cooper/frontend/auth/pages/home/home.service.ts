import { AVATAR_RULE, AvatarApi } from '@cooper/api/avatar'
import { uploadFile } from '@cooper/api/upload-file'
import { ApiError, inject, Store } from '@newt-kit/react'
import { SessionService } from '../../services/session/session.service'

type AvatarType = (typeof AVATAR_RULE.types)[number]

/**
 * Changing someone's picture: asking where to send it, sending it there, not through the
 * API, and asking the API to look at what came.
 */
export class HomeService {

  private readonly api = inject(AvatarApi)
  private readonly session = inject(SessionService)
  private readonly store = new Store({ uploading: false, failure: null as string | null })

  readonly uploading = this.store.select('uploading')
  readonly failure = this.store.select('failure')

  async changePicture(file: File): Promise<void> {
    this.store.patch({ uploading: true, failure: null })
    try {
      const { avatar, uploadUrl } = await this.api.uploadStart({ contentType: file.type as AvatarType, sizeBytes: file.size })
      await uploadFile(uploadUrl, file)
      const { url } = await this.api.uploadConfirm(avatar.id)
      const user = this.session.user.value
      if (user) this.session.signedIn({ ...user, avatarUrl: url })
    } catch (error) {
      this.store.patch({ failure: error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong' })
    } finally {
      this.store.patch({ uploading: false })
    }
  }
}
