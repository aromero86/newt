import type { Mailer } from '../../shared/mail/mailer'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import { WebSession_Module } from '../../shared/web-session/web-session.module'
import type { Auth_Modules } from '../auth/initialize-modules'
import { WORKSPACES_PRODUCT } from '../auth/modules/product/product.schema'
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Activity_Module } from './modules/activity/activity.module'
import { Board_Module } from './modules/board/board.module'
import type { AccessEvents } from './modules/card/card.deps'
import { Card_Module } from './modules/card/card.module'
import { Column_Module } from './modules/column/column.module'
import type { Workspaces } from './modules/member/member.deps'
import { Member_Module } from './modules/member/member.module'
import type { TenantEvents } from './modules/workspace/workspace.deps'
import { Workspace_Module } from './modules/workspace/workspace.module'

/**
 * auth's use cases `boards` calls besides its ports: who an access token is for (the
 * web session, the MCP server), who someone is, and what boards' routes for
 * workspaces, members and invitations manage in auth.
 */
export type Boards_Auth = Pick<Auth_Modules, 'token' | 'user' | 'tenant' | 'access' | 'invitation'>

/**
 * What `boards`' modules are given besides its base: what they need of auth, as ports
 * of their own (who belongs to each workspace, and auth's events about workspaces and
 * access) and as auth's use cases, and a mailer. Whoever opens the context wires them.
 */
export type Boards_ModuleDeps = {
  workspaces: Workspaces
  tenants: TenantEvents
  access: AccessEvents
  auth: Boards_Auth
  mailer: Mailer
  /** Where a line goes as each card moves, for whoever watches: the console while tracing, nowhere if none. */
  log?: (line: string) => void
}

/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  // Its people sign in through auth: boards is the OAuth client of the product `cooper`.
  const session = WebSession_Module.initialize(base, {
    context: 'boards',
    clientId: WORKSPACES_PRODUCT,
    clientSecret: config.clientSecret,
    publicUrl: config.publicUrl,
    authUrl: config.authPublicUrl,
    days: config.sessionDays,
    identify: accessToken => deps.auth.token.verify(accessToken),
    // `GET /api/session`: who is signed in, and only what boards' UI shows of them.
    profile: async userId => {
      const { id, name, email } = await deps.auth.user.get(userId)
      return { user: { id, name, email } }
    },
  })
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  const card = Card_Module.initialize(base, { board, column, member, access: deps.access }, { mailer: deps.mailer, publicUrl: config.publicUrl })
  const { tenant, access, invitation, user } = deps.auth
  const workspace = Workspace_Module.initialize(base, { board, column, card, member, tenants: deps.tenants, auth: { tenant, access, invitation, user } })
  const activity = Activity_Module.initialize(base, { card, member, tenants: deps.tenants }, { log: deps.log ?? (() => {}) })
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { session, member, board, column, card, workspace, activity, outbox }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
