# Searching

A board with forty cards is easy to scan. A workspace with four hundred is not. People
want to ask: the cards about "launch", in Doing, assigned to Bob. The staff want to
find an account by its email, or a workspace by its name.

The danger is in what a client may send. If a search took any criteria, a client could
filter on any column (a password hash, another workspace's id) and build a query slow
enough to stall the database. This chapter shows how newt lets a client search, and
only within what you decide.

## Criteria with groups

The criteria you have used so far ask for everything at once: `{ boardId, number }` is
"this board **and** this number". To say "this **or** that", criteria nest in groups:
`and` (every one) and `or` (at least one).

```ts
{ or: [{ assigneeId: 'bea' }, { number: 4 }] }
{ and: [criteria, { id: { in: ids } }] }
```

Every store answers them the same way. newt's `allOf(a, b)` is the second shape,
written for you:

```ts
// packages/newt/core/criteria/all-of.ts
/** Both at once: what `a` asks, and what `b` asks. */
export function allOf<Row>(a: Criteria<Row>, b: Criteria<Row>): Criteria<Row> {
  return { and: [a, b] } as Criteria<Row>
}
```

Criteria are for the module's own code, and can ask for anything in the row. What a
client sends is something else.

## What a client may ask: `defineFilter`

A **filter** is what a client sends. It is part of the module's public contract, so it
goes in `card.schema.ts`, beside the DTOs, and it is closed: it names the fields a
client may filter on, the operators for each, and how big a filter may get.

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
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

// …
/** A filter as a client sends it: groups of conditions on the fields of `CardFilter`. */
export type CardFilterDTO = z.infer<typeof CardFilter.schema>
export type CardSearchDTO = z.input<typeof CardSearchSchema>
```

- Each **public name** (`column`) points at a field of the row (`columnId`). The
  contract does not show how you store the data, and you can rename a field without
  breaking clients.
- A field or an operator that is not declared is a **400**. `workspaceId` and `title`
  are not in the list, so nobody filters on them.
- **`maxDepth`** limits how deep groups may nest, and **`maxConditions`** how many
  conditions a filter has in all. They default to 3 and 20. An `in` lists at most 100
  values. The limits are checked on the raw input, before zod walks it, so a filter
  nested thousands deep is refused cheaply.

A client sends a tree like this one:

```json
{
  "or": [
    { "field": "assignee", "op": "eq", "value": "bea" },
    { "field": "number", "op": "eq", "value": 4 }
  ]
}
```

## The use case

`card.search` parses the input, turns the filter into criteria, and asks the
repository for a page:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * A page of the workspace's cards that have the text and pass the filter: only the
 * fields and operators `CardFilter` allows.
 */
@UseCase()
async search(input: CardSearchDTO, page: PageRequest): Promise<Page<CardDTO>> {
  const { text, filter } = CardSearchSchema.parse(input)
  const criteria = filter ? CardFilter.toCriteria<CardRow>(filter) : {}
  const found = await this.repo.search(criteria, text, page)
  return {
    items: found.items.map(card => card.toDTO()),
    hasMore: found.hasMore,
    total: found.total,
  }
}
```

What the system imposes always goes **beside** the client's filter, never inside it,
so no filter can get around it. Here the system imposes the workspace, and it does not
even appear in the use case: the repository's search writes
`where('workspaceId', '=', currentWorkspaceId())` before the client's criteria, and
`and`s them together (below). A client that filters on `board` with another
workspace's board id finds nothing.

When a module has a rule of its own (only boards not archived, for example), add it
with `allOf(criteria, { … })` before asking the repository.

## The route

A tree of conditions does not fit well in a URL, so a search travels in the body of a
`POST`. The page (`size`, `cursor`) stays in the query string, as for every list:

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
// A search sends its filter in the body: groups of conditions do not fit in a URL.
workspace.post('/cards/search', async request => {
  const input = await request.json() as CardSearchDTO
  return Response.json(await cards.search(input, pageRequestFrom(request)))
})
```

It is registered on the workspace group, so it lives at
`/api/workspaces/:workspaceId/cards/search`, and only members reach it.

### Check it

boards' API test sends a search with a text and a filter, then one with a field the
filter does not allow:

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

With cooper running, you can send the same search by hand. Sign in to boards in a
browser, and copy its `cooper_boards_session` cookie:

```bash
curl -X POST "http://localhost:5172/api/workspaces/$WORKSPACE/cards/search?size=20" \
  -H 'content-type: application/json' -b "cooper_boards_session=$SESSION" \
  -d '{"text":"launch","filter":{"field":"assignee","op":"eq","value":"'"$BOB"'"}}'
```

## Text: what criteria cannot say

The operators of criteria are `eq`, `ne`, `in`, `gt`, `gte`, `lt`, `lte` and `ieq`
(equal, whatever the case of A to Z). There is no "contains". `ieq` finds "Plan the
launch" when you type "plan the LAUNCH", not when you type "launch".

So a card search with text is a Kysely query, the second step of the portability rule
([chapter 22](./22-backoffice)). One query does all of it: the workspace, the client's
criteria, the text, the page and the total.

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/**
 * A page of the current workspace's cards that meet the criteria and, if `text` is
 * given, have it in their title or description, whatever its case: one query of
 * Kysely, since criteria have no "contains", with the criteria in it too, and paged
 * by id as `page` pages (the cursor is the last id of the page before). Nothing is
 * read whole, however many cards match.
 *
 * What is portable to SQLite, Postgres and MySQL: `lower` on both sides of `like`,
 * so each database folds the column and the text alike (SQLite only A to Z; Postgres
 * and MySQL other letters too), and `!` as the escape character of `like`, which
 * none of them reads specially in a string (a backslash is one in MySQL's).
 */
async search(criteria: Criteria<CardRow>, text: string | undefined, page: PageRequest): Promise<Page<Card>> {
  const pattern = text ? `%${text.replace(/[!%_]/g, '!$&')}%` : undefined
  const matching = this.base.db
    .selectFrom('card')
    .where('workspaceId', '=', currentWorkspaceId())
    .where(eb => whereOf(eb, criteriaTree(criteria)))
    .$if(pattern !== undefined, query => query.where(eb => eb.or([
      sql<SqlBool>`lower(${eb.ref('title')}) like lower(${pattern}) escape '!'`,
      sql<SqlBool>`lower(${eb.ref('description')}) like lower(${pattern}) escape '!'`,
    ])))
  const [rows, counted] = await Promise.all([
    matching.selectAll().$if(page.cursor !== undefined, query => query.where('id', '>', page.cursor!)).orderBy('id').limit(page.size + 1).execute(),
    matching.select(eb => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow(),
  ])
  return toPage(rows.map(row => this.toEntity(row)), page.size, Number(counted.total))
}
```

`matching` is the query up to its `where`s. It runs twice, side by side: once for the
page (`selectAll`, after the cursor, by id, one more than the page to know `hasMore`)
and once for the total (`countAll`). newt's `toPage` makes the `Page` from both, as
`TableRepository.page` does for every other list.

The client's criteria get into the query through `criteriaTree`, from `newt/core`. It
turns criteria into a tree a store can translate: `all` (every one), `any` (at least
one) and `field` (a condition on one field). cooper translates that tree to Kysely,
for what `CardFilter` allows and nothing else:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/**
 * Criteria as a condition of Kysely on the cards: what `CardFilter` lets a client send
 * (every one, at least one, `eq` and `in` on a field of the card). Anything else is a
 * mistake of the code, not of the client.
 */
function whereOf(eb: ExpressionBuilder<BoardsDatabase, 'card'>, node: CriteriaNode): Expression<SqlBool> {
  if (node.kind === 'all') return eb.and(node.of.map(each => whereOf(eb, each)))
  if (node.kind === 'any') return eb.or(node.of.map(each => whereOf(eb, each)))
  const field = node.field as 'boardId' | 'columnId' | 'assigneeId' | 'number' | 'id'
  return eb.and(Object.entries(node.condition).map(([operator, operand]) => {
    if (operator === 'eq') return operand === null ? eb(field, 'is', null) : eb(field, '=', operand as string)
    // `in` with nothing in it holds for no card: an empty `or`.
    if (operator === 'in') return (operand as string[]).length === 0 ? eb.or([]) : eb(field, 'in', operand as string[])
    throw new Error(`A card search has no ${operator} on ${field}`)
  }))
}
```

The function is small because the filter is closed. A client cannot send `gt` on a
card, so `whereOf` does not have to know it. If one day `CardFilter` offers another
operator, the test that tries it fails here first.

Details that matter:

- **The workspace is written by hand.** Kysely does not know the repository's scope.
  Forget that `where`, and the search finds cards in every workspace.
- **`%`, `_` and `!` are escaped, with `!`.** In `like`, `%` means "anything" and `_`
  "any character". A search for `100%` must find the text `100%`, not everything that
  starts with `100`. The escape character is `!` and not the usual backslash, because
  MySQL reads a backslash inside a string as an escape of its own, and SQLite and
  Postgres do not: `!` means nothing special to any of the three.
- **`lower` on both sides.** The column and the text are folded by the same database,
  the same way. On SQLite that is A to Z only; on Postgres and MySQL, other letters
  too. So `ÄRGER IM` finds `Ärger im Büro` on every store: SQLite leaves `Ä` as it is
  on both sides, and folds the rest. (`ärger` would not find it on SQLite.) A test
  checks it.
- **One query, however many cards match.** An earlier version found the ids of the
  matching cards first, and then asked for a page with `{ id: { in: ids } }`. That
  breaks when the text matches more cards than a query takes parameters: SQLite in Bun
  takes 250,000. Put everything in one query, and the database never sends the ids
  back to be sent again.

The tests of the module cover text, filter and groups at once:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
expect(titles(await search({ text: 'PLAN' }))).toEqual(['Write the plan', 'Plan the party'])
expect(titles(await search({ text: 'people' }))).toEqual(['Write the plan'])
expect(titles(await search({ text: '%' }))).toEqual(['100% done_ish'])
expect(titles(await search({ text: 'plan', filter: { field: 'column', op: 'eq', value: doing } }))).toEqual(['Plan the party'])
expect(titles(await search({ filter: { or: [{ field: 'assignee', op: 'eq', value: 'bea' }, { field: 'number', op: 'eq', value: 4 }] } }))).toEqual(['Design the logo', '100% done_ish'])
```

And one test goes past the limit on purpose. It writes 250,001 cards straight as rows
(no use case would let a board have that many: a board holds at most 500), then pages
through them:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('searches by pages however many cards match, more than a query takes parameters (SQLite in Bun takes 250,000)', async () => {
  // Written as rows, past what any use case would let in: 250,001 cards of 501 boards.
  const now = new Date().toISOString()
  const rows = Array.from({ length: 250_001 }, (_, i) => ({
    id: Bun.randomUUIDv7(), workspaceId: 'acme', boardId: `board-${Math.floor(i / 500)}`, columnId: todo, number: i % 500 + 1,
    title: `Task ${i}`, description: '', assigneeId: i % 2 === 0 ? 'bea' : null, position: i % 500, createdAt: now, updatedAt: now, version: 1,
  }))
  await t.writeCards(rows)
  const search = (input: object, cursor?: string) => inAcme(() => t.modules.card.search(input, { size: 2, cursor }))

  const first = await search({ text: 'TASK' })
  expect(first).toMatchObject({ hasMore: true, total: 250_001 })
  expect(first.items.map(card => card.title)).toEqual(['Task 0', 'Task 1'])
  expect((await search({ text: 'task' }, first.items[1]!.id)).items.map(card => card.title)).toEqual(['Task 2', 'Task 3'])
  expect(await search({ text: 'task', filter: { field: 'assignee', op: 'eq', value: 'bea' } })).toMatchObject({ total: 125_001 })
  // `!`, `%` and `_` are only themselves.
  expect(await search({ text: '5!%' })).toMatchObject({ total: 0 })
}, 30_000)
```

A test of a limit has to cross it. With 249,999 rows the old version would have
passed.

## The same tool in auth

The staff search accounts and workspaces in the backoffice, but the accounts and
workspaces are auth's. So auth declares the filters, in its schemas:

```ts
// cooper/backend/contexts/auth/modules/user/user.schema.ts
export const UserFilter = defineFilter({
  email: { field: 'email', value: z.string(), ops: ['eq', 'ieq'] },
  name: { field: 'name', value: z.string(), ops: ['eq', 'ieq'] },
  signedUp: { field: 'createdAt', value: z.string(), ops: ['gte', 'lt'] },
}, { maxDepth: 2, maxConditions: 10 })
```

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.schema.ts
export const TenantFilter = defineFilter({
  name: { field: 'name', value: z.string(), ops: ['eq', 'ieq'] },
  admin: { field: 'createdBy', value: z.string(), ops: ['eq', 'in'] },
  created: { field: 'createdAt', value: z.string(), ops: ['gte', 'lt'] },
}, { maxDepth: 2, maxConditions: 10 })
```

`passwordHash` is not in `UserFilter`. Nobody, not even another context, filters
accounts by it. auth's `user.list` takes the filter as `unknown` and parses it itself,
since it cannot trust what it is given:

```ts
// cooper/backend/contexts/auth/modules/user/user.module.ts
/** Every account, newest first, as the staff look them up: only what `UserFilter` allows. */
@UseCase()
async list(filter: unknown, page: PageRequest): Promise<Page<UserDTO>> {
  const criteria = filter === undefined ? {} : UserFilter.toCriteria<UserRow>(UserFilter.schema.parse(filter))
  const found = await this.repo.page(criteria, page, { newestFirst: true })
  return { items: found.items.map(user => user.contract()), hasMore: found.hasMore, total: found.total }
}
```

The backoffice turns the one text box of its screen into a filter of auth's: an email
**or** a name, whole, whatever its case:

```ts
// cooper/backend/contexts/backoffice/modules/user/user.module.ts
/** Every account, the newest first, each saying whether it is staff; with a text, those whose email or name it is. */
@UseCase()
async list(input: UserSearchDTO, page: PageRequest): Promise<Page<UserSummaryDTO>> {
  const { text } = UserSearchSchema.parse(input)
  const filter: UserFilterDTO | undefined = text
    ? { or: [{ field: 'email', op: 'ieq', value: text }, { field: 'name', op: 'ieq', value: text }] }
    : undefined
  const users = await this.deps.user.list(filter, page)
  // One question to auth per account of the page: a page is short, and auth says it fresh.
  const items = await Promise.all(users.items.map(async user => ({ ...user, staff: await this.deps.staff.isStaff(user.id) })))
  return { ...users, items }
}
```

The backoffice imports only the type `UserFilterDTO` from auth's schema: the contract,
never the code that keeps accounts.

## Mind the performance

Every operator you offer is a query anyone can run. Some cost more than they look:

- **An `or` across different fields** keeps the database from using one index: it may
  read every row. `CardFilter` allows it, but with `maxDepth: 2` and
  `maxConditions: 10`.
- **`like '%text%'`** cannot use an index either: it reads the title and description
  of every card in the workspace. That is fine for a workspace's cards. It would not
  be for all of cooper's. A search over millions of rows wants a full-text index (step
  3 of the portability rule, marked as such) or a search engine fed by workers.
- **Indexes follow the filters you offer.** boards' migration has an index for each
  way `CardFilter` reaches cards, always behind the workspace, as every query has it:

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
CREATE UNIQUE INDEX card_number ON card (board_id, number);
CREATE INDEX card_column ON card (workspace_id, column_id, position);
CREATE INDEX card_assignee ON card (workspace_id, assignee_id);
```

Offer what your data can answer quickly, with low limits, and widen them when a real
case asks for it. Widening a contract is easy. Taking back an operator that clients
already use is not.

## In short

- Criteria nest with `and` and `or`. They are for the module's code.
- A client filters only by what `defineFilter` allows: public names, operators per
  field, `maxDepth` and `maxConditions`. Anything else is a 400.
- The system's rules go beside the client's filter (`allOf`, the repository's scope,
  or a `where` of its own), never inside it.
- A search travels in the body of a `POST`; its page, in the query string.
- Criteria have no "contains": text search is one Kysely query in the repository, with
  the workspace written by hand, the criteria in it through `criteriaTree`, `%`, `_`
  and `!` escaped with `escape '!'`, and the page and total from the same query.
- Never fetch ids to send them back in an `in`: a query takes a limited number of
  parameters. Test a limit by crossing it.
- Each operator offered is a query anyone can run. Offer little, index it, widen later.
