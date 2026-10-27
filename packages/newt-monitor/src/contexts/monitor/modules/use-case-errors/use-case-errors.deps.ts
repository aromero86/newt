import type { App_Module } from '../app/app.module'
import type { Connection_Module } from '../connection/connection.module'
import type { Retention_Module } from '../retention/retention.module'

export interface UseCaseErrors_Deps {
  /** That an application is there, and which are watched. */
  app: App_Module
  /** How its use case calls ended, asked of it. */
  connection: Connection_Module
  /** How long they are kept. */
  retention: Retention_Module
}
