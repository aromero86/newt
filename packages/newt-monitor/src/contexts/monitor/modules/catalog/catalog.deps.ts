import type { App_Module } from '../app/app.module'
import type { Structure_Module } from '../structure/structure.module'

export interface Catalog_Deps {
  /** That an application is there. */
  app: App_Module
  /** Its last version, and when it changes. */
  structure: Structure_Module
}
