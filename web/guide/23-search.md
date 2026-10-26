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
even appear in the use case: the card repository has a scope,
`scope: { field: 'workspaceId', current: currentWorkspaceId }`, which adds the current
workspace to every criteria query it runs ([chapter 5](./05-who-and-where)). A client
that filters on `board` with another workspace's board id finds nothing.

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

So the text part of a card search is done with Kysely, the second step of the
portability rule ([chapter 22](./22-backoffice)). The repository finds the ids of the
cards whose title or description contains the text, and adds them to the criteria:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/**
 * A page of the cards that meet the criteria and, if `text` is given, have it in
 * their title or description, whatever its case. Criteria have no "contains", so the
 * text is looked for with Kysely (portable to Postgres and MySQL: `lower` and
 * `like`), in the current workspace, and its cards' ids join the criteria.
 */
async search(criteria: Criteria<CardRow>, text: string | undefined, page: PageRequest): Promise<Page<Card>> {
  if (!text) return this.page(criteria, page)
  const pattern = `%${text.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`
  const matching = await this.base.db
    .selectFrom('card')
    .select('id')
    .where('workspaceId', '=', currentWorkspaceId())
    .where(eb => eb.or([
      sql<boolean>`lower(${eb.ref('title')}) like ${pattern} escape '\\'`,
      sql<boolean>`lower(${eb.ref('description')}) like ${pattern} escape '\\'`,
    ]))
    .execute()
  if (matching.length === 0) return toPage([], page.size, 0)
  return this.page(allOf(criteria, { id: { in: matching.map(row => row.id) } }), page)
}
```

Three details:

- **The workspace is written by hand.** Kysely does not know the repository's scope.
  Forget that `where`, and the search finds text in every workspace.
- **`%` and `_` are escaped.** In `like` they mean "anything" and "any character". A
  search for `100%` must find the text `100%`, not everything that starts with `100`.
  The test checks it with a card titled `100% done_ish`.
- **The page still comes from `this.page`.** The ids join the client's criteria with
  `allOf`, so the paging, the order, `hasMore` and `total` work as in every other list.

The test of the module covers text, filter and groups at once:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
expect(titles(await search({ text: 'PLAN' }))).toEqual(['Write the plan', 'Plan the party'])
expect(titles(await search({ text: 'people' }))).toEqual(['Write the plan'])
expect(titles(await search({ text: '%' }))).toEqual(['100% done_ish'])
expect(titles(await search({ text: 'plan', filter: { field: 'column', op: 'eq', value: doing } }))).toEqual(['Plan the party'])
expect(titles(await search({ filter: { or: [{ field: 'assignee', op: 'eq', value: 'bea' }, { field: 'number', op: 'eq', value: 4 }] } }))).toEqual(['Design the logo', '100% done_ish'])
```

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
/** Every account, the newest first; with a text, those whose email or name it is. */
@UseCase()
async list(input: UserSearchDTO, page: PageRequest): Promise<Page<UserDTO>> {
  const { text } = UserSearchSchema.parse(input)
  const filter: UserFilterDTO | undefined = text
    ? { or: [{ field: 'email', op: 'ieq', value: text }, { field: 'name', op: 'ieq', value: text }] }
    : undefined
  return this.deps.user.list(filter, page)
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
- The system's rules go beside the client's filter (`allOf`, or the repository's
  scope), never inside it.
- A search travels in the body of a `POST`; its page, in the query string.
- Criteria have no "contains": text search is a Kysely query in the repository, with
  the scope written by hand and `%` and `_` escaped.
- Each operator offered is a query anyone can run. Offer little, index it, widen later.
