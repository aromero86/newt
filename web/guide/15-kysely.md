# Queries a table cannot say: Kysely

acme's board has forty cards, and ana can see them all at once. The workspace has
four hundred, across many boards, and she can't. She wants to ask: the cards that say
"plan", in *Doing*, assigned to bea. The staff, later, want to know how many cards each
workspace has, all in one list.

Criteria have taken you this far. They can say "equal", "one of these", "greater than",
"equal whatever the case". They cannot say "contains", and they cannot say "count them
by board". This chapter adds the tool for what they cannot say: **Kysely**, a typed
query builder, run on boards' own store. With it come two things a search needs: the
groups criteria can nest in, and a way to say which filters a *client* may send, and to
answer 400 to the rest.

The text search you write here is a first version, on purpose. It works, and it shows
where a database's `like` stops being enough. [Chapter 16](./16-search-port) moves it
out of the table.

## Criteria, all of them

Until now criteria asked for everything at once: `{ boardId, number }` is "this board
**and** this number". A field can take a value (equal, `null` for "has none") or a
condition with operators:

| Operator | Means |
| --- | --- |
| `eq` | equal |
| `ne` | different, `null` included: `{ ne: null }` is "has one" |
| `in` | one of a list |
| `gt`, `gte`, `lt`, `lte` | greater, at least, less, at most |
| `ieq` | equal whatever the case of A to Z |

To say "this **or** that", criteria nest in groups: `and` (every one) and `or` (at least
one), as deep as you like:

```ts
{ or: [{ assigneeId: 'bea' }, { number: 4 }] }
{ boardId, and: [{ number: { gte: 10 } }, { number: { lt: 20 } }] }
```

Every store answers them the same way: SQLite writes a `WHERE`, the files store checks
each row. Criteria are for the module's own code, and can ask about any field of the
row. What a client sends is something else, and comes below.

None of these is "contains". `ieq` finds *Plan the launch* when you type *plan the
LAUNCH*, not when you type *launch*. And nothing in criteria groups or counts.

## Kysely on the store

Add Kysely to the project, at the version cooper uses:

```sh
bun add --exact kysely@0.29.6
```

newt does not run Kysely on a database of its own. `kyselyFor(store)`, from
`newt/kysely`, gives you Kysely on the **store's** connection:

- Its statements run inside `store.transaction` when one is in progress, so a query of
  yours in a save's hook reads and writes in the same transaction. Kysely's own
  transactions are refused: they would not be the store's.
- Field names are the rows' (`workspaceId`), turned into the columns' (`workspace_id`)
  on the way. You never write a column name.
- The same query runs on SQLite, Postgres and MySQL. It needs a SQL store: on files
  there is no Kysely.
- Outside a transaction, SQLite refuses a write. Use Kysely to read; write through the
  repository, or inside `store.transaction`.

boards' base is where every module gets it. Replace `boards-base.ts`:

```ts
// cooper/backend/contexts/boards/boards-base.ts
import { kyselyFor } from 'newt/kysely'
import { CooperBase } from '../../shared/cooper-base'
import type { BoardsDatabase } from './boards-database'

/**
 * What every module of `boards` receives: cooper's base, and Kysely on its store, for
 * the queries a table cannot say (cards counted by workspace and by board, and searched
 * by their text). Kysely needs a SQL store: `boards` opens on SQLite, and would open on
 * Postgres or MySQL the same way, never on files.
 */
export class BoardsBase extends CooperBase {
  readonly db = kyselyFor<BoardsDatabase>(this.store)
}
```

`kyselyFor` takes the shape of the database as a type: each table by its name, with
the fields of its rows. You already declared those rows, one per repository. A new
file lists them:

```ts
// cooper/backend/contexts/boards/boards-database.ts
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
```

`SqliteRow<Row>` says a row as SQLite gives it back to a query of your own: a boolean
as 0 or 1, an object or a list as its JSON text. An activity's `detail` is an object
in its row; in `BoardsDatabase` it is a `string`, which is what a query of yours reads.

Every table of boards is in the type, but the rule of chapter
[6](./06-rules-over-rows) still holds: a repository queries only its own table. Kysely
would let `Card_Repository` read `column`; the review should not.

## What a client may filter by: `CardFilter`

A search takes a filter from the client. If it took any criteria, a client could
filter on any field: `workspaceId` with another workspace's id, or a group of a
thousand `or`s built to stall the database. So the client sends a **filter**, and the
module declares which ones it accepts.

`defineFilter`, from `newt/contract`, declares one. A filter is part of the module's
public contract, so it goes in `card.schema.ts`, beside the DTOs; `newt/contract` is
safe in a browser, and the frontend gets its type too. Add its import at the top:

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
import { defineFilter } from 'newt/contract'
import { z } from 'zod'
```

After `CardAssignSchema`, declare the filter and the search's input:

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export const CardAssignSchema = z.object({ assigneeId: z.string() })

/** What a client may search cards by: these fields, these operators, nothing else. */
export const CardFilter = defineFilter({
  board: { field: 'boardId', value: z.string(), ops: ['eq', 'in'] },
  column: { field: 'columnId', value: z.string(), ops: ['eq', 'in'] },
  assignee: { field: 'assigneeId', value: z.string(), ops: ['eq', 'in'] },
  number: { field: 'number', value: z.number().int(), ops: ['eq'] },
}, { maxDepth: 2, maxConditions: 10 })

/** A search: words its title or description has (whatever their case), and a filter on the fields above. */
export const CardSearchSchema = z.object({
  text: z.string().trim().max(100).optional(),
  filter: CardFilter.schema.optional(),
})
```

and, after the other DTO types, the types a client uses, and two for the counts below:

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export type CardAssignDTO = z.input<typeof CardAssignSchema>
/** A filter as a client sends it: groups of conditions on the fields of `CardFilter`. */
export type CardFilterDTO = z.infer<typeof CardFilter.schema>
export type CardSearchDTO = z.input<typeof CardSearchSchema>

/** How many cards a workspace has, for whoever looks at many (the staff's backoffice). */
export type CardCountByWorkspace = { workspaceId: string, cards: number }
/** How many cards a board has. */
export type CardCountByBoard = { boardId: string, cards: number }
```

What `defineFilter` gives you:

- **Public names.** Each one (`column`) points at a field of the row (`columnId`). The
  contract does not show how cards are stored, and you can rename a field without
  breaking a client.
- **A closed list.** A field that is not declared, or an operator a field does not
  allow, does not pass. `workspaceId` and `title` are not in the list, so no client
  filters on them. Nor can a condition carry keys of its own: each is exactly
  `{ field, op, value }`.
- **Limits.** `maxDepth` is how deep groups may nest, `maxConditions` how many
  conditions a filter has in all; they default to 3 and 20. An `in` lists at most 100
  values. The limits are checked on the raw input first, before zod walks it, so a
  filter nested thousands deep is refused cheaply.
- **`schema`**, a zod schema for the tree, and **`toCriteria(filter)`**, which turns a
  parsed filter into criteria of the row's fields.

A client sends a tree like this one:

```json
{
  "or": [
    { "field": "assignee", "op": "eq", "value": "bea" },
    { "field": "number", "op": "eq", "value": 4 }
  ]
}
```

and `toCriteria` makes it `{ or: [{ assigneeId: { eq: 'bea' } }, { number: { eq: 4 } }] }`.

Anything else fails `CardSearchSchema.parse`, which throws zod's error; newt answers
it as a **400** with `code: 'validation'` and zod's issues, as for any body that is
not right ([chapter 3](./03-pages-and-errors)).

Every operator you offer is a query anyone can run. An `or` across different fields
keeps a database from using one index, and may read every row. `CardFilter` allows it,
with low limits, on fields boards' migration already indexes behind the workspace
(`card_column`, `card_assignee`, `card_number`). Offer little and widen it when a real
case asks: widening a contract is easy, taking back an operator clients use is not.

## The repository: one query for text, filter and page

The search needs "contains" on the title and the description, and criteria cannot say
it. So it is a Kysely query in the card repository. At the top of
`card.repository.ts`, the imports grow:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
import { toPage, type Criteria, type Page, type PageRequest } from 'newt/core'
import { whereOf } from 'newt/kysely'
import { TableRepository } from 'newt/repository'
import { sql, type SqlBool } from 'kysely'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Card, MAX_CARDS, type CardCountByBoard, type CardCountByWorkspace, type CardDTO } from './card'
```

Add the search before `purgeWorkspace`:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
  /**
   * A page of the current workspace's cards that meet the criteria and have the text in
   * their title or description, whatever its case: criteria have no "contains", so it
   * is one query of Kysely, with the criteria in it (`whereOf` says them as the store's
   * tables do), paged by id. `%` and `_` are only themselves: `!` escapes them.
   */
  async search(criteria: Criteria<CardDTO>, text: string | undefined, page: PageRequest): Promise<Page<Card>> {
    const pattern = `%${(text ?? '').replace(/[!%_]/g, '!$&')}%`
    const matching = this.base.db
      .selectFrom('card')
      .where('workspaceId', '=', currentWorkspaceId())
      .where(whereOf(this.store, criteria))
      .where(eb => eb.or([
        sql<SqlBool>`lower(${eb.ref('title')}) like lower(${pattern}) escape '!'`,
        sql<SqlBool>`lower(${eb.ref('description')}) like lower(${pattern}) escape '!'`,
      ]))
    const [rows, counted] = await Promise.all([
      matching.selectAll().$if(page.cursor !== undefined, query => query.where('id', '>', page.cursor!)).orderBy('id').limit(page.size + 1).execute(),
      matching.select(eb => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow(),
    ])
    return toPage(rows.map(row => this.toEntity(row)), page.size, Number(counted.total))
  }
```

Read it from the top:

- **The workspace is written by hand.** The repository's scope (chapter
  [4](./04-who-and-where)) filters what `find`, `count` and `page` read. Kysely does
  not go through them, so it does not know the scope. Forget this `where`, and the
  search finds the cards of every workspace.
- **`whereOf(store, criteria)`**, from `newt/kysely`, says criteria as a condition of
  Kysely: every operator and group, `null` and case answered exactly as `find` answers
  them on that store. The client's filter, turned into criteria, goes into the query
  this way, beside the workspace and never instead of it. A filter on `board` with
  another workspace's board id finds nothing.
- **`like`, escaped.** In `like`, `%` means "anything" and `_` "any character". A
  search for `100%` must find the text *100%*, not everything that starts with *100*.
  So `!`, `%` and `_` in the text get a `!` in front, and `escape '!'` says so. `!`,
  not the usual backslash: MySQL reads a backslash inside a string as an escape of its
  own, and `!` means nothing to any of the three databases.
- **`lower` on both sides.** The column and the text are folded by the same database,
  the same way. On SQLite that is A to Z only. So *ÄRGER IM* finds *Ärger im Büro*:
  SQLite leaves the *Ä* as it is on both sides and folds the rest. But *ärger* does not
  find it on SQLite. That is the first place `like` falls short.
- **One query, run twice side by side**: `matching` is the query up to its `where`s.
  Once for the page (every column, after the cursor, by id, one more row than the page
  to know whether more follow) and once for the total (`countAll`). newt's `toPage`
  makes the `Page` from both, as `TableRepository.page` does: it drops the extra row
  and says `hasMore`.
- **`Number(counted.total)`**: a count comes back as a number on SQLite and as text on
  Postgres. `Number` makes it the same everywhere.

Everything is in one query: the workspace, the filter, the text, the page and the
total. Never fetch the ids that match to send them back in an `in`: a query takes a
limited number of parameters (250,000 on SQLite in Bun), and a search that matches more
would break.

## Counts

Two more queries criteria cannot say: how many cards each workspace has, and each
board. `count(criteria)` is one number; these are a `GROUP BY`. Add them after the
search:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
  /**
   * How many cards each of these workspaces has, by one query that groups them.
   * Across workspaces on purpose: for the staff's backoffice, which looks at
   * all of them, never for a workspace's own work.
   */
  async countByWorkspace(workspaceIds: string[]): Promise<CardCountByWorkspace[]> {
    if (workspaceIds.length === 0) return []
    const rows = await this.base.db
      .selectFrom('card')
      .select(eb => ['workspaceId', eb.fn.countAll<number>().as('cards')])
      // Criteria, as a table takes them, said in Kysely's query by `whereOf`.
      .where(whereOf(this.store, { workspaceId: { in: workspaceIds } }))
      .groupBy('workspaceId')
      .execute()
    const counts = new Map(rows.map(row => [row.workspaceId, Number(row.cards)]))
    return workspaceIds.map(workspaceId => ({ workspaceId, cards: counts.get(workspaceId) ?? 0 }))
  }

  /** How many cards each board of the current workspace has: boards without any are not there. */
  async countByBoard(): Promise<CardCountByBoard[]> {
    const rows = await this.base.db
      .selectFrom('card')
      .select(eb => ['boardId', eb.fn.countAll<number>().as('cards')])
      .where('workspaceId', '=', currentWorkspaceId())
      .groupBy('boardId')
      .orderBy('boardId')
      .execute()
    return rows.map(row => ({ boardId: row.boardId, cards: Number(row.cards) }))
  }
```

`countByWorkspace` crosses workspaces, and says so: it is for the staff's backoffice
(chapter [25](./25-backoffice)), which looks at all of them. Its own criteria go
through `whereOf` too: `{ workspaceId: { in: workspaceIds } }`, which `whereOf` turns
into an `in` with one parameter per id. A workspace without cards has no row in the
`GROUP BY`, so the method gives it its 0. `countByBoard` stays in the current
workspace, written by hand as in the search.

## The use cases

In `card.module.ts`, the first import takes `mapPage`, `Page` and `PageRequest`, and
the import from `./card` takes the filter, the search's schema and the new types:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
import { currentActor, eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { runInWorkspace } from '../../workspace-scope'
import type { ColumnDTO } from '../column/column.schema'
import {
  Card,
  CardAssignSchema,
  CardCreateSchema,
  CardEditSchema,
  CardFilter,
  CardMoveSchema,
  CardSearchSchema,
  MAX_CARDS,
  type CardAssignDTO,
  type CardAuthor,
  type CardCountByBoard,
  type CardCountByWorkspace,
  type CardCreateDTO,
  type CardDTO,
  type CardEditDTO,
  type CardMoveDTO,
  type CardSearchDTO,
} from './card'
```

`listInBoard` reads a board whole, since it holds at most `MAX_CARDS`. Its comment now
says where the list that grows goes:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * A board's cards, column by column and from the top: whole, since a board is read
   * as one screen and holds at most `MAX_CARDS`. The list that grows without end, the
   * search, comes by pages.
   */
```

After `getByNumber`, the search:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * A page of the workspace's cards that have the text and pass the filter: only the
   * fields and operators `CardFilter` allows.
   */
  @UseCase()
  async search(input: CardSearchDTO, page: PageRequest): Promise<Page<CardDTO>> {
    const { text, filter } = CardSearchSchema.parse(input)
    const criteria = filter ? CardFilter.toCriteria<CardDTO>(filter) : {}
    return mapPage(await this.repo.search(criteria, text, page), card => card.toDTO())
  }
```

It parses what the client sent, turns the filter into criteria of the card's fields
(`toCriteria<CardDTO>`), and asks the repository for a page. What the system imposes,
the workspace, is not in the use case at all: the repository adds it beside the
criteria, so no filter can get around it. A rule of the module's own (say, only cards
not done) would go beside the filter too, as `{ and: [criteria, { … }] }`, never inside
what the client sent.

After `unassignMember`, the counts:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /** For other contexts (the staff's backoffice): how many cards each of these workspaces has. */
  @UseCase()
  async countByWorkspace(workspaceIds: string[]): Promise<CardCountByWorkspace[]> {
    return this.repo.countByWorkspace([...new Set(workspaceIds)])
  }

  /** For other contexts: how many cards each board of a workspace has. */
  @UseCase()
  async countByBoard(workspaceId: string): Promise<CardCountByBoard[]> {
    return runInWorkspace(workspaceId, () => this.repo.countByBoard())
  }
```

Nobody calls them over HTTP yet: they are use cases for other contexts, which chapter
[25](./25-backoffice) wires.

## The route

A tree of groups does not fit well in a URL, so a search travels in the body of a
`POST`. The page (`size`, `cursor`) stays in the query string, as for every list. In
`card.routes.ts`, import `pageRequestFrom` and the search's DTO:

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
import { pageRequestFrom, type KeptAnswer } from 'newt/http'
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { CardAssignDTO, CardCreateDTO, CardEditDTO, CardMoveDTO, CardSearchDTO } from './card'
```

and add the route after the one that creates a card, before `/cards/:cardId`:

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
  // A search sends its filter in the body: groups of conditions do not fit in a URL.
  workspace.post('/cards/search', async request => {
    const input = await request.json() as CardSearchDTO
    return Response.json(await cards.search(input, pageRequestFrom(request)))
  })
```

It is on the workspace group, so it lives at
`/api/workspaces/:workspaceId/cards/search`, and only the workspace's members reach it.
It does not take `idempotency`: a search changes nothing, so sending it twice is safe.

## Tests

In `card.test.ts`, import `CardDTO` too:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
import { MAX_CARDS, type CardCreateDTO, type CardDTO } from './card.schema'
```

and add three tests after *tells nobody of a card they created for themselves, or
took*:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('searches the workspace\'s cards by text, column and assignee, by pages', async () => {
    await create('Write the plan', { description: 'Dates and PEOPLE' })
    await create('Design the logo', { columnId: doing, assigneeId: 'bea' })
    await create('Plan the party', { columnId: doing })
    await create('100% done_ish')
    const search = (input: object, size = 10) => inAcme(() => t.modules.card.search(input, { size }))
    const titles = (page: { items: CardDTO[] }) => page.items.map(card => card.title)

    expect(titles(await search({ text: 'PLAN' }))).toEqual(['Write the plan', 'Plan the party'])
    expect(titles(await search({ text: 'people' }))).toEqual(['Write the plan'])
    expect(titles(await search({ text: '%' }))).toEqual(['100% done_ish'])
    expect(titles(await search({ text: 'plan', filter: { field: 'column', op: 'eq', value: doing } }))).toEqual(['Plan the party'])
    expect(titles(await search({ filter: { or: [{ field: 'assignee', op: 'eq', value: 'bea' }, { field: 'number', op: 'eq', value: 4 }] } }))).toEqual(['Design the logo', '100% done_ish'])

    const first = await search({}, 3)
    expect(first).toMatchObject({ hasMore: true, total: 4 })
    await expect(search({ filter: { field: 'title', op: 'eq', value: 'x' } })).rejects.toThrow()
  })

  test('finds a card by the text of its title as it is written, letters beyond A to Z too', async () => {
    await create('Ärger im Büro')

    const found = await inAcme(() => t.modules.card.search({ text: 'ÄRGER IM' }, { size: 10 }))

    expect(found.items.map(card => card.title)).toEqual(['Ärger im Büro'])
  })

  test('counts cards by workspace and by board, for the backoffice', async () => {
    await create('Plan')
    await create('Design')
    const other = await inAcme(() => t.modules.board.create({ name: 'Other' }))
    const column = await inAcme(() => t.modules.column.add(other.id, { name: 'To do' }))
    await inAcme(() => t.modules.card.create(other.id, { columnId: column.id, title: 'Elsewhere' }))

    expect(await t.modules.card.countByWorkspace(['acme', 'globex'])).toEqual([{ workspaceId: 'acme', cards: 3 }, { workspaceId: 'globex', cards: 0 }])
    expect(await t.modules.card.countByBoard('acme')).toEqual([{ boardId, cards: 2 }, { boardId: other.id, cards: 1 }].sort((a, b) => a.boardId.localeCompare(b.boardId)))
  })
```

The first one covers text (any case, in the description too, `%` as itself), a filter
alone and with text, a group, a page with more to come, and a field the filter does
not allow. The second checks the case: *Ä* is written as the title has it, so SQLite
finds it.

In `boards.context.test.ts`, after *removes a column only when it is empty*, a search
over HTTP, and a filter on a field it does not allow:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
  test('searches cards with a filter in the body, and refuses one it does not allow', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id
    const todo = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'To do' })).body.id
    for (const title of ['Plan the launch', 'Design', 'Plan the party']) await call('POST', `/acme/boards/${id}/cards`, { columnId: todo, title })

    const found = await call<{ items: { title: string }[], total: number }>('POST', '/acme/cards/search?size=1', { text: 'plan', filter: { field: 'column', op: 'eq', value: todo } })
    expect(found.body).toMatchObject({ items: [{ title: 'Plan the launch' }], total: 2, hasMore: true })

    expect(await call('POST', '/acme/cards/search', { filter: { field: 'workspaceId', op: 'eq', value: 'globex' } })).toMatchObject({ status: 400, body: { code: 'validation' } })
  })
```

And `workspace.test.ts` checks that a deleted workspace leaves no cards behind, now
that it can count them. In *prepares nothing in a workspace auth deleted before its
work ran*, add the last line:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
    expect(await t.modules.board.listOf('acme', { size: 10 })).toMatchObject({ items: [], total: 0 })
    expect(await t.modules.card.countByWorkspace(['acme'])).toEqual([{ workspaceId: 'acme', cards: 0 }])
  })
```

and in *removes all a workspace has once auth deletes it, and nothing of any other*,
the line in the middle:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
    expect(await t.modules.board.listOf('acme', { size: 10 })).toMatchObject({ items: [], total: 0 })
    expect(await t.modules.card.countByWorkspace(['acme', 'globex'])).toEqual([{ workspaceId: 'acme', cards: 0 }, { workspaceId: 'globex', cards: 1 }])
    expect((await t.modules.board.listOf('globex', { size: 10 })).total).toBe(1)
```

## Check it

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint
```

Then by hand. Start the backend (`bun cooper/backend/index.ts`), make a board with a
column and three cards, and search them a page of one at a time:

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
BOARD=$(curl -s -X POST $API/boards -H "$H" -H 'x-user: ana' -d "{\"name\":\"Launch $RANDOM\"}" | jq -r .id)
COLUMN=$(curl -s -X POST $API/boards/$BOARD/columns -H "$H" -H 'x-user: ana' -d '{"name":"To do"}' | jq -r .id)
for title in 'Plan the launch' 'Design' 'Plan the party' 'Ärger im Büro'; do
  curl -s -X POST $API/boards/$BOARD/cards -H "$H" -H 'x-user: ana' -d "{\"columnId\":\"$COLUMN\",\"title\":\"$title\"}" > /dev/null
done
curl -s -X POST "$API/cards/search?size=1" -H "$H" -H 'x-user: ana' \
  -d "{\"text\":\"PLAN\",\"filter\":{\"field\":\"column\",\"op\":\"eq\",\"value\":\"$COLUMN\"}}" \
  | jq '{ titles: [.items[].title], hasMore, total }'
```

```text
{
  "titles": [
    "Plan the launch"
  ],
  "hasMore": true,
  "total": 2
}
```

A filter on a field `CardFilter` does not offer:

```sh
curl -s -i -X POST $API/cards/search -H "$H" -H 'x-user: ana' \
  -d '{"filter":{"field":"workspaceId","op":"eq","value":"globex"}}' | head -1
```

```text
HTTP/1.1 400 Bad Request
```

Its body is `{ "error": …, "code": "validation", "issues": [ … ] }`, with zod's issues
for each field and operator it tried. A filter nested deeper than `maxDepth` is a 400
too, with one issue: `A filter nests at most 2 groups deep`.

And the limit of `lower` on SQLite:

```sh
for text in ÄRGER ärger; do
  curl -s -X POST $API/cards/search -H "$H" -H 'x-user: ana' -d "{\"text\":\"$text\"}" | jq -c '[.items[].title]'
done
```

```text
["Ärger im Büro"]
[]
```

## What `like` cannot do

The search works, and it is the right first step: one query, the workspace by hand,
the client's filter through `whereOf`, the page and the total together. It also shows
where a table stops being the place for text:

- **`%text%` cannot use an index.** It reads the title and description of every card
  in the workspace. That is fine for hundreds; it would not be for all of cooper's.
- **It finds letters, not words.** *plan* finds *planet* and *airplane*. Nobody asks
  for *Plans* to find *plan*, because `like` cannot.
- **Case is the database's.** SQLite folds A to Z only; Postgres and MySQL fold more.
  The same search answers differently depending on where boards runs.

Each database has a full-text index of its own, and each one's is different: SQLite's
FTS5, Postgres's `tsvector`, MySQL's `FULLTEXT`. Using one ties boards to that store.
The next chapter takes the other road: text search goes out of the table, behind a
port of boards' own.

## What to remember

- Criteria say equal, one of, greater and less, equal whatever the case, nested in
  `and` and `or`. They are for the module's own code.
- What criteria cannot say ("contains", a `GROUP BY`) is Kysely, from `kyselyFor` on
  the context's base, typed by its tables (`SqliteRow<Row>`), in the repository of the
  table it reads. It runs on the store's connection and transaction.
- Kysely does not know the repository's scope: write the workspace's `where` yourself.
  The criteria go in with `whereOf(store, criteria)`, answered as `find` answers them.
- A client filters only by what `defineFilter` allows: public names, operators per
  field, `maxDepth` and `maxConditions`. Anything else is a 400 `validation`. The
  system's rules go beside the client's filter, never inside it.
- One query for the page and its total; never ids fetched to be sent back in an `in`.

Next: [A search port of your own](./16-search-port).
