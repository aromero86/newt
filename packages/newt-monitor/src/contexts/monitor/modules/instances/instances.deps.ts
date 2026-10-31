import type { App_Module } from '../app/app.module'
import type { Connection_Module } from '../connection/connection.module'
import type { Retention_Module } from '../retention/retention.module'

export interface Instances_Deps {
  /** That an application is there, and which are watched. */
  app: App_Module
  /** Its instances and their servers, asked of it. */
  connection: Connection_Module
  /** How long their minutes and days are kept. */
  retention: Retention_Module
}
