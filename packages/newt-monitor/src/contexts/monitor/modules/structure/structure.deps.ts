import type { App_Module } from '../app/app.module'
import type { Connection_Module } from '../connection/connection.module'

export interface Structure_Deps {
  /** That an application is there. */
  app: App_Module
  /** What an application is made of, asked of it. */
  connection: Connection_Module
}
