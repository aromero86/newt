import type { App_Module } from '../app/app.module'
import type { Connection_Module } from '../connection/connection.module'
import type { Retention_Module } from '../retention/retention.module'

export interface Outbox_Deps {
  /** That an application is there, and which are watched. */
  app: App_Module
  /** How full its queues are, and its dead jobs, asked of it. */
  connection: Connection_Module
  /** How long its snapshots are kept: as its minutes. */
  retention: Retention_Module
}
