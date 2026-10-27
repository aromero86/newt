import type { SqliteStore } from 'newt/adapter-sqlite'
import { HttpRouter } from 'newt/http'
import { Base } from 'newt/runtime'

/**
 * What every module of the monitor receives: newt's base, on SQLite, with the router
 * its context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class MonitorBase extends Base<SqliteStore> {
  readonly http = new HttpRouter()
}
