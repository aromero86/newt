import type { App_Module } from '../app/app.module'
import type { Connection_Module } from '../connection/connection.module'
import type { Retention_Module } from '../retention/retention.module'

export interface Traces_Deps {
  /** That an application is there, which are watched, and its key: to sign the header that keeps a trace. */
  app: App_Module
  /** The traces it kept, asked of it. */
  connection: Connection_Module
  /** How long they are kept. */
  retention: Retention_Module
}
