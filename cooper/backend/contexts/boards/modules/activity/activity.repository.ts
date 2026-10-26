import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Activity, type ActivityDTO } from './activity'

export type ActivityRow = ActivityDTO & { version: number }

export class Activity_Repository extends TableRepository<Activity, ActivityRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<ActivityRow>('activity', { types: { detail: 'json' } }), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: ActivityRow): Activity {
    return Activity.fromDTO(row)
  }
}
