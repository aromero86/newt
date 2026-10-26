import type { Access_Module } from '../access/access.module'
import type { OauthClient_Module } from '../oauth-client/oauth-client.module'
import type { Product_Module } from '../product/product.module'
import type { Session_Module } from '../session/session.module'

export interface OauthGrant_Deps {
  oauthClient: OauthClient_Module
  product: Product_Module
  access: Access_Module
  /** Who is signed in to auth, for the review of a request: a public route, asked before signing in. */
  session: Session_Module
}
