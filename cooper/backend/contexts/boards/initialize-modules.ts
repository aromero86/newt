import type { Mailer } from '../../shared/mail/mailer'
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Board_Module } from './modules/board/board.module'
import type { AccessEvents } from './modules/card/card.deps'
import { Card_Module } from './modules/card/card.module'
import { Column_Module } from './modules/column/column.module'
import type { Workspaces } from './modules/member/member.deps'
import { Member_Module } from './modules/member/member.module'
import type { TenantEvents } from './modules/workspace/workspace.deps'
import { Workspace_Module } from './modules/workspace/workspace.module'

/**
 * What `boards`' modules are given besides its base: what they need of auth, as ports
 * of their own (who belongs to each workspace, and auth's events about workspaces and
 * access), and a mailer. Whoever opens the context wires the ports to auth.
 */
export type Boards_ModuleDeps = {
  workspaces: Workspaces
  tenants: TenantEvents
  access: AccessEvents
  mailer: Mailer
}

/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  const card = Card_Module.initialize(base, { board, column, member, access: deps.access }, { mailer: deps.mailer, publicUrl: config.publicUrl })
  const workspace = Workspace_Module.initialize(base, { board, column, card, member, tenants: deps.tenants })
  return { member, board, column, card, workspace }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
