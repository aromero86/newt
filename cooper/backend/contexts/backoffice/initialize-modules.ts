import type { CooperBase } from '../../shared/cooper-base'
import { WebSession_Module } from '../../shared/web-session/web-session.module'
import type { Auth_Modules } from '../auth/initialize-modules'
import { PRODUCTS, WORKSPACES_PRODUCT } from '../auth/modules/product/product.schema'
import type { Boards_Modules } from '../boards/initialize-modules'
import type { Backoffice_Config } from './backoffice-config'
import { Staff_Module } from './modules/staff/staff.module'
import { User_Module } from './modules/user/user.module'
import { Workspace_Module } from './modules/workspace/workspace.module'

/**
 * What `backoffice`'s modules are given besides its base: the use cases of the
 * contexts it reads, those it needs and nothing else. Never a context's base nor its
 * store: another context is reached through its use cases and its events.
 */
export type Backoffice_ModuleDeps = {
  auth: Pick<Auth_Modules, 'user' | 'access' | 'tenant' | 'token'>
  boards: Pick<Boards_Modules, 'board' | 'card'>
}

/**
 * Every module of `backoffice`, each one after the modules it uses. They read auth and
 * boards through their modules' use cases, and keep only their sessions, in the
 * context's own database.
 */
export function initializeModules(base: CooperBase, config: Backoffice_Config, deps: Backoffice_ModuleDeps) {
  const { auth, boards } = deps

  const staff = Staff_Module.initialize(base, { user: auth.user, access: auth.access }, { productId: PRODUCTS.backoffice })
  const session = WebSession_Module.initialize(base, {
    context: 'backoffice',
    clientId: PRODUCTS.backoffice,
    clientSecret: config.clientSecret,
    publicUrl: config.publicUrl,
    authUrl: config.authPublicUrl,
    days: config.sessionDays,
    identify: accessToken => auth.token.verify(accessToken),
    // `{ user }`, as every web app reads its session; only for the staff: anyone else,
    // an access taken away since signing in, gets a 403.
    profile: async () => ({ user: await staff.me() }),
  })
  const user = User_Module.initialize(base, { staff, user: auth.user, access: auth.access, tenant: auth.tenant }, { workspacesProduct: WORKSPACES_PRODUCT })
  const workspace = Workspace_Module.initialize(base, { staff, tenant: auth.tenant, access: auth.access, user: auth.user, board: boards.board, card: boards.card })
  return { session, staff, user, workspace }
}

export type Backoffice_Modules = ReturnType<typeof initializeModules>
