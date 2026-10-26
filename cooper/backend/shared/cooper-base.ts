import type { FileStore } from 'newt/adapter-files'
import { Base } from 'newt/runtime'
import { HttpRouter } from 'newt/http'
import './actor'

/**
 * What every module of cooper receives: newt's base, on plain files for now, with the
 * router its context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class CooperBase extends Base<FileStore> {
  readonly http = new HttpRouter()
}
