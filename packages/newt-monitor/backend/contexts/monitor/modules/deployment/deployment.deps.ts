import type { CommitMessages } from '../../../../shared/commit-messages/commit-messages'
import type { App_Module } from '../app/app.module'
import type { Instances_Module } from '../instances/instances.module'

export interface Deployment_Deps {
  /** That an application is there, and where its code is. */
  app: App_Module
  /** Each instance heard of for the first time, with the commit it was built from. */
  instances: Instances_Module
  /** A port: each commit's message, from its repository. */
  messages: CommitMessages
}
