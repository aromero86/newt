import type { ActivityDTO } from '../../../backend/contexts/boards/modules/activity/activity.schema'
import type { Page } from 'newt-kit/contract'
import { type PageRequest, Requester } from 'newt-kit-react'

/** The backend's `activity` module: what happened to each card, and who did it. */
export class ActivityApi extends Requester {
  protected readonly path = '/workspaces'

  /** A card's activity, the newest first: a moment behind what happens. */
  listForCard(workspaceId: string, cardId: string, page?: PageRequest) {
    return this.get<Page<ActivityDTO>>(`/${workspaceId}/cards/${cardId}/activity`, page)
  }
}
