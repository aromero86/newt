import { Base } from 'newt/runtime'
import type { SqliteStore } from 'newt/adapter-sqlite'
import { HttpRouter } from 'newt/http'

/**
 * What every module of cooper receives: newt's base, on SQLite, with the router its
 * context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class CooperBase extends Base<SqliteStore> {
  readonly http = new HttpRouter()
}
