import { InvitationApi, type InvitationPreviewDTO } from '@cooper/api/invitation'
import { inject, Store } from 'newt-kit-react'
import { WorkspacesService } from '../../services/workspaces/workspaces.service'

type InvitationState = {
  preview: InvitationPreviewDTO | null
  loading: boolean
  /** Why the link cannot be used: expired, revoked, unknown. */
  failure: string | null
  accepting: boolean
  /** Why accepting failed: usually, signed in with another email. */
  acceptFailure: string | null
}

/** An invitation link, opened by the person it was sent to: what it is about, and joining. */
export class InvitationService {

  private readonly api = inject(InvitationApi)
  private readonly workspaces = inject(WorkspacesService)
  private readonly store = new Store<InvitationState>({ preview: null, loading: false, failure: null, accepting: false, acceptFailure: null })
  private token = ''

  readonly preview = this.store.select('preview')
  readonly loading = this.store.select('loading')
  readonly failure = this.store.select('failure')
  readonly accepting = this.store.select('accepting')
  readonly acceptFailure = this.store.select('acceptFailure')

  async load(token: string): Promise<void> {
    this.token = token
    this.store.patch({ preview: null, loading: true, failure: null, acceptFailure: null })
    try {
      this.store.patch({ preview: await this.api.preview(token) })
    } catch (error) {
      this.store.patch({ failure: error instanceof Error ? error.message : 'This invitation cannot be used' })
    } finally {
      this.store.patch({ loading: false })
    }
  }

  /** Resolves to the workspace joined, or `null` when it could not be accepted. */
  async accept(): Promise<string | null> {
    this.store.patch({ accepting: true, acceptFailure: null })
    try {
      const { workspaceId } = await this.api.accept(this.token)
      await this.workspaces.joined()
      return workspaceId
    } catch (error) {
      this.store.patch({ acceptFailure: error instanceof Error ? error.message : 'Could not accept the invitation' })
      return null
    } finally {
      this.store.patch({ accepting: false })
    }
  }
}
