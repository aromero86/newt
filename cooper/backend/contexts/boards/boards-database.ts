import type { SqliteRow } from 'newt/kysely'
import type { ActivityRow } from './modules/activity/activity.repository'
import type { BoardRow } from './modules/board/board.repository'
import type { CardCounterRow, CardRow } from './modules/card/card.repository'
import type { ColumnRow } from './modules/column/column.repository'

/**
 * The tables of `boards`, as its repositories query them with Kysely: each one by its
 * name, with the fields of its rows (`workspaceId`, never `workspace_id`). A
 * repository queries only its own table.
 */
export type BoardsDatabase = {
  board: SqliteRow<BoardRow>
  column: SqliteRow<ColumnRow>
  card: SqliteRow<CardRow>
  card_counter: SqliteRow<CardCounterRow>
  activity: SqliteRow<ActivityRow>
}
