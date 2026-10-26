import { Base } from 'newt/runtime'
import { HttpRouter } from 'newt/http'
import type { CooperStore } from './open-store'
import './actor'

/**
 * What every module of cooper receives: newt's base, on SQLite or Postgres, with the
 * router its context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class CooperBase extends Base<CooperStore> {
  readonly http = new HttpRouter()
}
