import type { SqliteStore } from 'newt/adapter-sqlite'
import { Base } from 'newt/runtime'
import { HttpRouter } from 'newt/http'
import './actor'

/**
 * What every module of cooper receives: newt's base, on SQLite, with the
 * router its context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class CooperBase extends Base<SqliteStore> {
  readonly http = new HttpRouter()
}
