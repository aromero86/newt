import type { AppClient } from '../../../../shared/app-client/app-client'
import type { App_Module } from '../app/app.module'

export interface Connection_Deps {
  /** Where each application is, and its key. */
  app: App_Module
  /** A port: the applications themselves, through their monitor endpoints. */
  client: AppClient
}
