import { InvitationApi, type InvitationPreviewDTO } from '@cooper/api/invitation'
import { inject, Store } from '@newt-kit/react'

type SignInInvitationState = {
  preview: InvitationPreviewDTO | null
  /** Why the link cannot be used: expired, revoked, unknown. */
  failure: string | null
}

/** An invitation link opened before signing in: which workspace, and who sent it. Anyone with the link may read it. */
export class SignInInvitationService {

  private readonly api = inject(InvitationApi)
  private readonly store = new Store<SignInInvitationState>({ preview: null, failure: null })

  readonly preview = this.store.select('preview')
  readonly failure = this.store.select('failure')

  async load(token: string): Promise<void> {
    this.store.reset()
    try {
      this.store.patch({ preview: await this.api.preview(token) })
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'This invitation cannot be used' })
    }
  }
}
