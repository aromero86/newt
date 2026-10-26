import type { Mailer } from '../../shared/mail/mailer'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Activity_Module } from './modules/activity/activity.module'
import type { AccessEvents } from './modules/card/card.deps'
import { Board_Module } from './modules/board/board.module'
import { Card_Module } from './modules/card/card.module'
import { Column_Module } from './modules/column/column.module'
import type { Workspaces } from './modules/member/member.deps'
import { Member_Module } from './modules/member/member.module'
import type { TenantEvents } from './modules/workspace/workspace.deps'
import { Workspace_Module } from './modules/workspace/workspace.module'
import type { CardSearch } from './search/card-search'

/**
 * What `boards`' modules are given besides its base: what they need of auth, as ports
 * of their own (who belongs to each workspace, and auth's events about workspaces and
 * access), a mailer, and where the cards are searched. Whoever opens the context wires
 * them.
 */
export type Boards_ModuleDeps = {
  workspaces: Workspaces
  tenants: TenantEvents
  access: AccessEvents
  mailer: Mailer
  search: CardSearch
  /** Where a line goes as each card moves, for whoever watches: the console while tracing, nowhere if none. */
  log?: (line: string) => void
}

/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  const card = Card_Module.initialize(base, { board, column, member, access: deps.access }, { mailer: deps.mailer, publicUrl: config.publicUrl, search: deps.search })
  const workspace = Workspace_Module.initialize(base, { board, column, card, member, tenants: deps.tenants })
  const activity = Activity_Module.initialize(base, { card, member, tenants: deps.tenants }, { log: deps.log ?? (() => {}) })
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { member, board, column, card, workspace, activity, outbox }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
