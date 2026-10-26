import { Module, UseCase, type EventMeta, type Page, type PageRequest } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { runInWorkspace } from '../../workspace-scope'
import type { CardAuthor, CardDTO } from '../card/card.schema'
import type { Card_Assigned } from '../card/events/card-assigned'
import type { Card_Created } from '../card/events/card-created'
import type { Card_Deleted } from '../card/events/card-deleted'
import type { Card_Edited } from '../card/events/card-edited'
import type { Card_Moved } from '../card/events/card-moved'
import type { Card_Unassigned } from '../card/events/card-unassigned'
import { Activity, type ActivityDTO, type ActivityKind } from './activity'
import type { Activity_Deps } from './activity.deps'
import type { Activity_Options } from './activity-options'
import { Activity_Repository } from './activity.repository'
import { registerActivityRoutes } from './activity.routes'
import { registerActivityWorkers } from './activity.workers'

/**
 * What happened to each card, and who did it: a log that only grows, one
 * entry per event a card tells, written by a worker reacting to it. An entry
 * is never changed: a card edited twice has two entries, and none of them collides
 * with another, nor with the card. Each one takes its event's id, so a job that runs
 * twice records it once.
 */
export class Activity_Module extends Module {

  static initialize(base: BoardsBase, deps: Activity_Deps, options: Activity_Options): Activity_Module {
    const module = new Activity_Module(base, new Activity_Repository(base))
    registerActivityRoutes(base, module, deps)
    registerActivityWorkers(module, deps, options)
    return module
  }

  private constructor(base: BoardsBase, private readonly repo: Activity_Repository) {
    super('activity', base.invocations)
  }

  /** A page of a card's activity, the newest first. Its card may be gone: its history stays. */
  @UseCase()
  async listForCard(cardId: string, page: PageRequest): Promise<Page<ActivityDTO>> {
    const found = await this.repo.page({ cardId }, page, { newestFirst: true })
    return { items: found.items.map(entry => entry.toDTO()), hasMore: found.hasMore, total: found.total }
  }

  @UseCase()
  async recordCreated(card: Card_Created['payload'], event: EventMeta): Promise<void> {
    await this.append(card, card, event, 'created', { number: card.number, title: card.title, columnId: card.columnId })
  }

  @UseCase()
  async recordEdited({ dto, changes, ...origin }: Card_Edited['payload'], event: EventMeta): Promise<void> {
    await this.append(dto, origin, event, 'edited', { changed: Object.keys(changes).filter(field => field !== 'updatedAt').join(', '), title: dto.title })
  }

  @UseCase()
  async recordMoved({ dto, previous, ...origin }: Card_Moved['payload'], event: EventMeta): Promise<void> {
    await this.append(dto, origin, event, 'moved', { fromColumnId: previous.columnId ?? dto.columnId, toColumnId: dto.columnId })
  }

  @UseCase()
  async recordAssigned({ dto, previousAssigneeId, ...origin }: Card_Assigned['payload'], event: EventMeta): Promise<void> {
    await this.append(dto, origin, event, 'assigned', { assigneeId: dto.assigneeId, previousAssigneeId })
  }

  @UseCase()
  async recordUnassigned({ dto, previousAssigneeId, ...origin }: Card_Unassigned['payload'], event: EventMeta): Promise<void> {
    await this.append(dto, origin, event, 'unassigned', { previousAssigneeId })
  }

  @UseCase()
  async recordDeleted(card: Card_Deleted['payload'], event: EventMeta): Promise<void> {
    await this.append(card, card, event, 'deleted', { number: card.number, title: card.title })
  }

  /** A workspace was deleted in auth: its log goes. A step of that deletion, safe to run again. */
  @UseCase()
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.repo.purgeWorkspace(workspaceId)
  }

  /**
   * Records an event of a card, in its workspace (a worker is in none), by the event's
   * id: the second time, the entry is there already.
   */
  private async append(card: CardDTO, { by, via }: CardAuthor, event: EventMeta, kind: ActivityKind, detail: ActivityDTO['detail']): Promise<void> {
    await runInWorkspace(card.workspaceId, async () => {
      if (await this.repo.first({ id: event.id })) return
      await this.repo.persist(Activity.record({
        id: event.id,
        workspaceId: card.workspaceId,
        boardId: card.boardId,
        cardId: card.id,
        kind,
        actorId: by,
        via,
        at: event.occurredAt,
        detail,
      }))
    })
  }
}
