import type { AppClient } from '../../../../shared/app-client/app-client'

export interface App_Deps {
  /** A port: the applications themselves, asked before an address or a key is saved. */
  client: AppClient
}
