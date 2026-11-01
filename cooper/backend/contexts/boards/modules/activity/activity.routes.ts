import { pageRequestFrom } from 'newt-kit/http'
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Activity_Deps } from './activity.deps'
import type { Activity_Module } from './activity.module'

export function registerActivityRoutes(base: BoardsBase, activity: Activity_Module, deps: Activity_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/cards/:cardId/activity', async request =>
    Response.json(await activity.listForCard(request.params.cardId, pageRequestFrom(request))))
}
