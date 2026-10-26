# Use cases with judgement

You have a module working. Before going on, it is worth stopping on how a good use case
is written, because they all follow the same shape. This chapter looks at the use
cases of `board` and `card` and at the decisions behind them: where input is checked,
which error a missing thing is, and how a list is returned.

## The shape of a use case

Read `board.update` again:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
/** Renames it, describes it, or both. */
@UseCase()
async update(id: string, input: BoardUpdateDTO): Promise<BoardDTO> {
  const changes = BoardUpdateSchema.parse(input)
  const board = await this.load(id)
  if (changes.name !== undefined) await this.assertNameFree(BoardName.from(changes.name), id)
  board.update(changes)
  await this.repo.persistWithNameFree(board)
  return board.toDTO()
}
```

Every use case is the same six steps, in this order:

1. **Validate at the door**: `BoardUpdateSchema.parse(input)`. From here on, the data
   can be trusted.
2. **Load** what it needs: the entity, or data from other modules through their use
   cases.
3. **Decide**: check the rules ("is the name free?").
4. **Change the entity** with its own methods (`board.update(changes)`).
5. **Save once, at the end**: `this.repo.persist…`.
6. **Return DTOs**, never entities.

When a use case does not fit this shape (it saves twice, or changes an entity by hand),
it is usually doing two things, or doing the entity's job.

## Validate twice, on purpose

A board's name is checked **twice**. The use case parses the input against
`BoardCreateSchema`; then the entity checks the whole board against `BoardSchema`,
every time it is built or changed. It is not an oversight. They are two different
checks, with two different jobs:

| | In the use case | In the entity |
|---|---|---|
| What it checks | What **comes in**: the client's request | Its **state**: what a valid board is |
| How | Forgiving: trims, tidies, sets defaults | Strict: an invalid value never gets in |
| When | Once, on arrival | On every change, and also when read from the store |
| If it fails | A 400 for the client, with what is wrong | `InvalidEntity`, a programming error: something slipped through. The client gets a 500 that tells nothing; the log gets the field and the reason |

The first is for the client: it says what they sent wrong. The second is the guarantee
that **no** invalid entity exists, wherever the change comes from (a route, a worker, a
script, an old row of the store).

In `board`, the two sides of the name are the two halves of its value object:

```ts
// cooper/backend/contexts/boards/modules/board/value-objects/board-name.ts
export const BoardName = {
  /** How it is kept: what `from` makes of what someone typed. */
  schema: z.string()
    .min(1)
    .max(MAX_LENGTH)
    .refine(name => name === tidy(name), 'A board\'s name has no spaces around it, nor two in a row')
    .brand<'BoardName'>(),
  from(value: string): BoardName {
    const name = tidy(value)
    if (name.length === 0 || name.length > MAX_LENGTH) throw new InvalidBoardName(value)
    return name as BoardName
  },
} satisfies ValueObject<BoardName, string>
```

`from` is forgiving: `'  Road   map '` becomes `'Road map'`, and only what cannot be
fixed is refused, with a 400 the client understands. `schema` is strict: it does not
fix anything, it refuses a name that is not tidy already. `BoardSchema` uses `schema`;
`Board.create` and `Board.update` use `from`.

And still, **each rule is written once**. The forgiving schemas are derived from the
strict one. `card` shows it plainly:

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export const CardSchema = z.object({
  // …
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5_000),
  // …
})

const description = z.string().trim().pipe(CardSchema.shape.description)

export const CardCreateSchema = CardSchema.pick({ columnId: true, title: true }).extend({
  description: description.default(''),
  assigneeId: CardSchema.shape.assigneeId.default(null),
})
export const CardEditSchema = z.object({ title: CardSchema.shape.title, description }).partial()
```

`pick` takes the title's rule as it is; `pipe` trims first and then applies the
description's rule. If tomorrow a title may have 300 characters, you change it in
`CardSchema` and both checks know.

## One or none: `resolve`

`this.resolve(find, onMissing)` turns a search into one result or an error. You choose
the error, because it depends on what the absence means:

- If the id **is** what is asked for (`GET /boards/:boardId`), the thing is missing:
  a `NotFoundError`, 404.
- If the id goes **inside** what is sent (a card sent to a column), what is wrong is
  the request: a 400.

`board` has the first case:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
private load(id: string): Promise<Board> {
  return this.resolve(() => this.repo.find({ id }), () => new BoardNotFound(id))
}
```

`card` has the second. A card is created in a board named by the path, and in a column
named by the body:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
@UseCase()
async create(boardId: string, input: CardCreateDTO): Promise<CardDTO> {
  const { columnId, title, description, assigneeId } = CardCreateSchema.parse(input)
  const board = await this.deps.board.get(boardId)
  await this.assertColumnOf(boardId, columnId)
  // …
}

// …

/** The column a card goes to is one of its board's: asked to the column module, a read. */
private async assertColumnOf(boardId: string, columnId: string): Promise<void> {
  const columns = await this.deps.column.list(boardId)
  if (!columns.some(column => column.id === columnId)) throw new ColumnNotInBoard(columnId, boardId)
}
```

A board that does not exist is a 404 (`board.not_found`, from `board.get`): the path
pointed at nothing. A column that is not the board's is a 400:

```ts
// cooper/backend/contexts/boards/modules/card/errors/column-not-in-board.ts
import { ValidationError } from 'newt/core'

/** A card goes only to a column of its own board: the request named another. */
export class ColumnNotInBoard extends ValidationError {
  readonly code = 'card.column_not_in_board'
  constructor(columnId: string, boardId: string) {
    super(`Column ${columnId} is not a column of board ${boardId}`)
  }
}
```

When all you need is "this id exists in that module", there is a shortcut:
`resolveRefs` looks each id up through the other module's `find`, and throws newt's
`ReferenceNotFound` (400, `reference_not_found`) for the first one that points nowhere.
`auth`'s `access.grant` checks the product it is given that way:

```ts
// cooper/backend/contexts/auth/modules/access/access.module.ts
@UseCase()
async grant(input: AccessGrantDTO): Promise<AccessDTO> {
  const { userId, productId, tenantId } = AccessGrantSchema.parse(input)
  await this.resolveRefs({ productId }, { productId: this.deps.product })
  // …
}
```

```ts
// cooper/backend/contexts/auth/auth.test.ts
await expect(as(staff, () => modules().access.grant({ userId: ana.id, productId: 'nope' }))).rejects.toMatchObject({ code: 'reference_not_found' })
```

`card` writes its own error instead, because "the column exists, but in another board"
deserves its own `code`. Chapter [18](./18-references) is about references.

### Or none, on purpose

Not every absence is an error. When another module asks "is there a board with this
name?", "no" is an answer, not a failure. Then the use case returns `null`:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
/** For other modules: the board with this name, whatever its case, if there is one. */
@UseCase()
async findByName(name: string): Promise<BoardDTO | null> {
  const board = await this.repo.first({ name: { ieq: BoardName.from(name) } })
  return board?.toDTO() ?? null
}
```

`get` says "give me this one": its absence is a 404. `findByName` says "is there one?":
its absence is `null`. Name them so the caller can tell.

## Lists: always by pages

No list is returned whole. A use case that lists receives a `PageRequest` (`size`,
`cursor`) and returns a `Page` (`items`, `hasMore`, `total`):

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
/** A page of the workspace's boards, the newest first. */
@UseCase()
async list(page: PageRequest): Promise<Page<BoardDTO>> {
  const found = await this.repo.page({}, page, { newestFirst: true })
  return {
    items: found.items.map(board => board.toDTO()),
    hasMore: found.hasMore,
    total: found.total,
  }
}
```

The repository returns a page of **entities**; the use case turns it into a page of
**DTOs**, writing the three fields one by one. It could be shorter, but this way you
read exactly what goes out.

The route reads the page with `pageRequestFrom(request)`: `?size=20&cursor=<id>`. The
size defaults to 20 and is kept between 1 and 100, whatever the client asks:

```ts
// cooper/backend/contexts/boards/modules/board/board.routes.ts
workspace.get('/boards', async request => Response.json(await boards.list(pageRequestFrom(request))))
```

The cursor is the id of the last item the client already has. Ids are UUIDv7, which
sort by creation time, so pages are stable even while boards are added meanwhile.

Pages go from oldest to newest by default. For lists people read the other way round
(the latest boards, the activity), pass `{ newestFirst: true }`: it starts with the
newest and the cursor goes backwards. That is what boards do, and the test shows it:

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
test('lists a workspace\'s boards by pages, the newest first', async () => {
  for (const name of ['Roadmap', 'Bugs', 'Launch']) await create(name)

  const first = await inAcme(() => t.modules.board.list({ size: 2 }))
  expect(first.items.map(board => String(board.name))).toEqual(['Launch', 'Bugs'])
  expect(first).toMatchObject({ hasMore: true, total: 3 })

  const next = await inAcme(() => t.modules.board.list({ size: 2, cursor: first.items[1]!.id }))
  expect(next.items.map(board => String(board.name))).toEqual(['Roadmap'])
  expect(next.hasMore).toBe(false)
})
```

Over HTTP:

```http
GET /api/workspaces/acme/boards?size=2
→ { "items": [Launch, Bugs], "hasMore": true, "total": 3 }

GET /api/workspaces/acme/boards?size=2&cursor=<id of Bugs>
→ { "items": [Roadmap], "hasMore": false, "total": 3 }
```

### The lists that are whole, and why

Two lists in `boards` are returned whole, and each says why in its comment:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
/**
 * A board's columns, from left to right: whole, since a board has at most
 * `MAX_COLUMNS`. A board the workspace does not have has none.
 */
@UseCase()
async list(boardId: string): Promise<ColumnDTO[]> {
  return (await this.repo.ofBoard(boardId)).map(column => column.toDTO())
}
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * A board's cards, column by column and from the top: whole, since a board is read
 * as one screen. The list that grows without end, the search, comes by pages.
 */
@UseCase()
async listInBoard(boardId: string): Promise<CardDTO[]> {
  const cards = await this.repo.find({ boardId }, { orderBy: [{ field: 'columnId' }, { field: 'position' }] })
  return cards.map(card => card.toDTO())
}
```

A board's columns are at most ten: a rule the module keeps (chapter
[8](./08-rules-over-rows)), so the list has a bound. A board's cards are what its
screen shows at once. The rule is not "never an array"; it is "never a list without a
bound". When a list's size is set by a rule of the domain, it may be whole; when it
grows with use (boards of a workspace, the search over every card), it is paged.

::: warning
A board's cards have no hard limit in cooper: a board with thousands of cards would
send them all. The search, which pages, is how you look across many cards (chapter
[23](./23-search)). If your screen can grow without bound, page it too.
:::

## Use cases for other callers

A use case does not only serve a route. `board` has some that only other modules,
workers or contexts call:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
/** For other contexts (the backoffice): a page of a workspace's boards, the newest first. */
@UseCase()
async listOf(workspaceId: string, page: PageRequest): Promise<Page<BoardDTO>> {
  return runInWorkspace(workspaceId, () => this.list(page))
}
```

A route's use case takes the workspace from the scope its route entered. The
backoffice is in no workspace: it names one, and `listOf` enters it and calls `list`.
The rule (newest first, by pages) is still written once, in `list`.

## In short

- A use case validates, loads, decides, changes the entity, saves once, and returns
  DTOs.
- Validate twice on purpose: forgiving at the door (a 400 for the client), strict in
  the entity (no invalid entity ever exists). Write each rule once, and derive the
  input schemas from the entity's.
- `resolve` turns "one or none" into an entity or the error you choose: 404 when the
  id is what is asked for, 400 when it is inside the request. `resolveRefs` does the
  second for you. When absence is an answer, return `null`.
- Every list that grows is paged: `PageRequest` in, `Page` out, `newestFirst` for lists
  read backwards. A list may be whole only when a rule of the domain bounds it.
