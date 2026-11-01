import { kyselyFor } from '@newt-kit/newt/kysely'
import { CooperBase } from '../../shared/cooper-base'
import type { BoardsDatabase } from './boards-database'

/**
 * What every module of `boards` receives: cooper's base, and Kysely on its store, for
 * the queries a table cannot say (cards counted by workspace and by board). Kysely
 * needs a SQL store: `boards` opens on SQLite or Postgres, and would open on MySQL the
 * same way, never on files.
 */
export class BoardsBase extends CooperBase {
  readonly db = kyselyFor<BoardsDatabase>(this.store)
}
