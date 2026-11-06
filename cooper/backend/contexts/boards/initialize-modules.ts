import type { StorageOptions } from '@newt-kit/newt/port-storage'
import type { Mailer } from '../../shared/mail/mailer'
import { Outbox_Module } from '../../shared/outbox/outbox.module'
import { WebSession_Module } from '../../shared/web-session/web-session.module'
import type { Auth_Modules } from '../auth/initialize-modules'
import { WORKSPACES_PRODUCT } from '../auth/modules/product/product.schema'
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Activity_Module } from './modules/activity/activity.module'
import { Attachment_Module } from './modules/attachment/attachment.module'
import { Board_Module } from './modules/board/board.module'
import { Card_Module } from './modules/card/card.module'
import { Column_Module } from './modules/column/column.module'
import { Member_Module } from './modules/member/member.module'
import { Workspace_Module } from './modules/workspace/workspace.module'
import type { CardSearch } from './search/card-search'

/**
 * auth's modules `boards` uses, as its own modules use each other: who an access
 * token is for (the web session, the MCP server), who belongs to each workspace
 * (`member`), auth's events about workspaces and access, and what boards' routes for
 * workspaces, members and invitations manage in auth.
 */
export type Boards_Auth = Pick<Auth_Modules, 'token' | 'user' | 'tenant' | 'access' | 'invitation'>

/**
 * What `boards`' modules are given besides its base: auth's modules, a mailer, and
 * where the cards are searched. Whoever opens the context wires them.
 */
export type Boards_ModuleDeps = {
  auth: Boards_Auth
  mailer: Mailer
  search: CardSearch
  /** Where its files are kept, instead of where its settings say: a test's, in memory. */
  storage?: StorageOptions
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
      const { id, name, email, avatarUrl } = await deps.auth.user.get(userId)
      return { user: { id, name, email, avatarUrl } }
    },
  })
  const { user, tenant, access, invitation } = deps.auth
  const member = Member_Module.initialize(base, { auth: { access, tenant, user } })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  const card = Card_Module.initialize(base, { board, column, member, auth: { access } }, { mailer: deps.mailer, publicUrl: config.publicUrl, search: deps.search })
  const attachment = Attachment_Module.initialize(base, { card, member, auth: { tenant } })
  const workspace = Workspace_Module.initialize(base, { board, column, card, member, auth: { tenant, access, invitation, user } })
  const activity = Activity_Module.initialize(base, { card, member, auth: { tenant } }, { log: deps.log ?? (() => {}) })
  // Its dead jobs, for the staff's backoffice to look at and retry.
  const outbox = Outbox_Module.initialize(base)
  return { session, member, board, column, card, attachment, workspace, activity, outbox }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
