import type { Access_Module } from '../access/access.module'
import type { OauthClient_Module } from '../oauth-client/oauth-client.module'
import type { Product_Module } from '../product/product.module'

export interface OauthGrant_Deps {
  oauthClient: OauthClient_Module
  product: Product_Module
  access: Access_Module
}
