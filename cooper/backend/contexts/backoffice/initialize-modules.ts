import { SqliteAnalytics } from '../../shared/analytics/sqlite-analytics'
import type { CooperBase } from '../../shared/cooper-base'
import { WebSession_Module } from '../../shared/web-session/web-session.module'
import type { Auth_Context } from '../auth/auth.context'
import { WORKSPACES_PRODUCT } from '../auth/initialize-modules'
import type { Boards_Context } from '../boards/boards.context'
import type { Backoffice_Config } from './backoffice-config'
import { Metric_Module } from './modules/metric/metric.module'
import { Staff_Module } from './modules/staff/staff.module'
import { User_Module } from './modules/user/user.module'
import { Workspace_Module } from './modules/workspace/workspace.module'

/** What `backoffice`'s modules are given besides its base: the contexts it reads. */
export type Backoffice_ModuleDeps = {
  auth: Auth_Context
  boards: Boards_Context
}

/** The backoffice as a product of auth's: its OAuth client, and what its staff have access to. */
export const BACKOFFICE_PRODUCT = 'backoffice'

/** How many days the metrics' overview goes back, today included. */
const METRIC_DAYS = 30

/**
 * Every module of `backoffice`, each one after the modules it uses. They read auth and
 * boards through their modules' use cases, and keep only their sessions and their
 * analytics, in the context's own database.
 */
export function initializeModules(base: CooperBase, config: Backoffice_Config, deps: Backoffice_ModuleDeps) {
  const auth = deps.auth.modules
  const boards = deps.boards.modules

  const staff = Staff_Module.initialize(base, { user: auth.user, access: auth.access }, { productId: BACKOFFICE_PRODUCT })
  const session = WebSession_Module.initialize(base, {
    context: 'backoffice',
    clientId: BACKOFFICE_PRODUCT,
    clientSecret: config.clientSecret,
    publicUrl: config.publicUrl,
    authUrl: config.authPublicUrl,
    days: config.sessionDays,
    identify: accessToken => auth.token.verify(accessToken),
    // Only the staff: anyone else, an access taken away since signing in, gets a 403.
    profile: () => staff.me(),
  })
  const user = User_Module.initialize(base, { staff, user: auth.user, access: auth.access, tenant: auth.tenant }, { workspacesProduct: WORKSPACES_PRODUCT })
  const workspace = Workspace_Module.initialize(base, { staff, tenant: auth.tenant, access: auth.access, user: auth.user, board: boards.board, card: boards.card })
  const metric = Metric_Module.initialize(base, { staff, card: boards.card, tenant: auth.tenant, user: auth.user }, {
    analytics: new SqliteAnalytics(base.store),
    days: METRIC_DAYS,
  })
  return { session, staff, user, workspace, metric }
}

export type Backoffice_Modules = ReturnType<typeof initializeModules>
