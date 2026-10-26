import type { Mailer } from '../../shared/mail/mailer'
import { WEB_SESSION_CALLBACK } from '../../shared/web-session/web-session.schema'
import type { Auth_Config } from './auth-config'
import type { AuthBase } from './auth-base'
import { Access_Module } from './modules/access/access.module'
import { Invitation_Module } from './modules/invitation/invitation.module'
import { OauthClient_Module } from './modules/oauth-client/oauth-client.module'
import { OauthGrant_Module } from './modules/oauth-grant/oauth-grant.module'
import { Product_Module } from './modules/product/product.module'
import { PRODUCTS, WORKSPACES_PRODUCT, type ProductDTO } from './modules/product/product.schema'
import { Session_Module } from './modules/session/session.module'
import { Tenant_Module } from './modules/tenant/tenant.module'
import { Token_Module } from './modules/token/token.module'
import { User_Module } from './modules/user/user.module'

/** What `auth`'s modules are given besides its base. */
export type Auth_ModuleDeps = {
  mailer: Mailer
}

/**
 * cooper's products, declared here: the apps that sign people in through auth, each
 * with its OAuth client, whose codes arrive at the web-session helper's callback.
 */
export function declaredProducts(config: Auth_Config): ProductDTO[] {
  return [
    {
      id: WORKSPACES_PRODUCT,
      name: 'Cooper',
      publicUrl: config.boardsPublicUrl,
      signUp: true,
      access: 'anyone',
      mcpResource: `${config.boardsPublicUrl}/mcp`,
      redirectUri: `${config.boardsPublicUrl}${WEB_SESSION_CALLBACK}`,
    },
    {
      id: PRODUCTS.backoffice,
      name: 'Cooper backoffice',
      publicUrl: config.backofficePublicUrl,
      signUp: false,
      access: 'granted',
      mcpResource: null,
      redirectUri: `${config.backofficePublicUrl}${WEB_SESSION_CALLBACK}`,
    },
  ]
}

/** Every module of `auth`, each one after the modules it uses. */
export function initializeModules(base: AuthBase, config: Auth_Config, deps: Auth_ModuleDeps) {
  const product = Product_Module.initialize(base, { products: declaredProducts(config) })
  const user = User_Module.initialize(base)
  const session = Session_Module.initialize(base, { user, product }, { days: config.sessionDays })
  const access = Access_Module.initialize(base, { product })
  const tenant = Tenant_Module.initialize(base, { access }, { productId: WORKSPACES_PRODUCT })
  const invitation = Invitation_Module.initialize(base, { tenant, access, user }, {
    productId: WORKSPACES_PRODUCT,
    days: config.invitationDays,
    mailer: deps.mailer,
    // The link opens boards, which shows the workspace and accepts it through its own origin.
    acceptUrl: token => `${config.boardsPublicUrl}/invitations/${token}`,
  })
  const oauthClient = OauthClient_Module.initialize(base, { product }, { secrets: config.clientSecrets })
  const oauthGrant = OauthGrant_Module.initialize(base, { oauthClient, product, access }, { publicUrl: config.publicUrl })
  const token = Token_Module.initialize(base, { oauthClient, oauthGrant }, config.oauth)
  return { product, user, session, access, tenant, invitation, oauthClient, oauthGrant, token }
}

export type Auth_Modules = ReturnType<typeof initializeModules>
