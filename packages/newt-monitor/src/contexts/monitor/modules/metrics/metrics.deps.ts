import type { App_Module } from '../app/app.module'
import type { Connection_Module } from '../connection/connection.module'

export interface Metrics_Deps {
  /** That an application is there, and which are watched. */
  app: App_Module
  /** Its metrics, asked of it. */
  connection: Connection_Module
}
