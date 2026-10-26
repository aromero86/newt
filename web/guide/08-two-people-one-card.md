# Two people, one card

Ana and Bob open the same board. Ana drags card #1 to *Doing*; at the same moment Bob
drags it to *Done*. Both save. What is left?

Without protection, the second save would write over the first with what it read
before, and Ana's move would vanish without anyone knowing. Worse: each move also
rewrites the positions of the cards around it, so a column could end up with two
cards in one place and a gap elsewhere.

This chapter adds moving and removing to columns and cards. Every one of those
saves several rows at once, rows other people may be changing too. You will see how
newt notices, what it does about it on its own, and the one case it cannot notice
without your help.

## The version

Every row a store writes has a **version** that goes up with each save that writes
it. You have had it since chapter [2](./02-first-module): the `version` column of
every table, the `version` in every row type.

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
export type CardRow = CardDTO & { version: number }
```

An entity remembers the version it was read at. When `save` writes it, the store
checks the row is still at that version. If someone saved it in between, it is not,
and the save throws **`ConcurrencyConflict`** (409, `concurrency_conflict`) and writes
nothing: the whole transaction rolls back.

```text
Ana   reads card #1 (version 3)
Bob   reads card #1 (version 3)
Ana   saves the move, if it is still at 3   → done, now version 4
Bob   saves the move, if it is still at 3   → ConcurrencyConflict: it is at 4
```

Nobody loses anything in silence. You wrote none of it: `TableRepository.write`
updates and deletes at the version read, and `takeNumber` in chapter
[7](./07-cards-and-a-counter) did the same by hand with `update(id, version,
changes)`.

## Trying again, on its own

Bob getting an error would be correct, but it is rarely what anyone wants: the
sensible thing is to **try again**, read the card again, now in *Doing*, move it to
*Done*, and save. Every use case does that without being asked. On a
`ConcurrencyConflict` it runs again **from the start**, up to three more times, after
a short random wait. Only when every attempt collides does the 409 reach the client.

That works because a use case **loads, changes and saves at the end, and does nothing
that cannot be undone before saving**. Run again, it loads what is stored now and
decides again. A use case that sent an email and then saved would send it twice; what
cannot be undone leaves from a worker, after the save (chapter
[12](./12-failures)).

When a use case calls another, only **the first of the chain** runs again, with all
it calls. The inner one lets the conflict through to its caller, and runs again in
each of the caller's attempts. If both ran again, the inner one would repeat what its
caller then repeats anyway.

A use case that does something before saving that must not happen twice (a call to
another context that already saved, say) turns it off, with its reason beside it:

```ts
@UseCase({ retryOnConflict: false })
```

Then no use case of its chain runs again, not even the ones that called it. Nothing
in boards needs it: every use case here loads, decides and saves once. auth has a few
that do, in chapters [18](./18-tenants-and-access) and [21](./21-oauth-server).
Before you write it, check whether the use case can be reordered to save once, at the
end. The flag is for what cannot.

## Columns move

Start with the columns, where the idea is the same with less around it. A column
moved to another place on its board changes its own position, and the columns
between take one place each. Add two methods to `Column`, after `rename`, and one to
remove it:

```ts
// cooper/backend/contexts/boards/modules/column/column.ts
  rename(name: string): void {
    this.change({ name })
  }

  /** Someone moved it: where it goes. */
  moveTo(position: number): void {
    this.change({ position })
  }

  /** Another one moved, or left: this one takes the place left to it, and tells nothing. */
  reposition(position: number): void {
    this.change({ position })
  }

  remove(): void {
    this.markAsDeleted()
  }
}
```

`moveTo` and `reposition` do the same today. They are two methods because they mean
two things: one is what someone did, the other is a consequence. Chapter
[10](./10-events) gives the first an event and leaves the second silent.

`remove` marks the column deleted. The column's repository has no `softDelete`, so
its save removes the row for good, at the version read.

### Saving an order

The repository gets `persistOrder`: a board's columns in their new order, saved at
once, all or none. Add it after `persistAdded`:

```ts
// cooper/backend/contexts/boards/modules/column/column.repository.ts
  /**
   * Saves a board's columns in their new order, all of them or none: each
   * one moved, and the one removed. Each was read at a version, so a column moved by
   * someone else meanwhile makes it a conflict, and the use case runs again with what
   * there is now. One added meanwhile has no version here: the order is checked
   * whole after writing, guarding the board's columns, so it is a conflict too.
   */
  async persistOrder(columns: Column[], boardId: string): Promise<void> {
    await this.save(columns, each => this.write(each), {
      guard: [`columns:${boardId}`],
      after: async () => {
        const positions = (await this.ofBoard(boardId)).map(each => each.position)
        if (positions.some((position, index) => position !== index)) this.conflict()
      },
    })
  }
```

The versions protect the rows that were read. They cannot protect a row that **did
not exist** when the use case read: if Carla adds a column while Bob's move renumbers
the board, Bob's save never touches Carla's column, and two columns could end at the
same position. So `after` reads the board's columns again, inside the transaction,
and checks the positions run 0, 1, 2… with no gap.

If they do not, that is not an error to answer: someone slipped in, and what the use
case decided may no longer hold. **`this.conflict()`** says so. It is a method of
every repository, and throws the same `ConcurrencyConflict` a stale version does: the
transaction rolls back and the use case runs again, now seeing Carla's column.

The guard `columns:<board id>` is the one `persistAdded` takes (chapter
[6](./06-rules-over-rows)): no column of the board is added, moved or removed between
the writes and the check, in any store.

### The use cases

Add `ColumnMoveSchema` and `ColumnMoveDTO` to the imports of `column.module.ts` (both
are in `column.schema.ts` already: a position):

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
import {
  Column,
  ColumnAddSchema,
  ColumnMoveSchema,
  ColumnRenameSchema,
  MAX_COLUMNS,
  type ColumnAddDTO,
  type ColumnDTO,
  type ColumnMoveDTO,
  type ColumnRenameDTO,
} from './column'
```

and two use cases after `rename`:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
  /**
   * Moves a column to another place on its board, and the others take the places
   * left: several columns saved at once, all or none. Whoever moved one of them
   * meanwhile makes it run again, from the start, with the board as it is then.
   */
  @UseCase()
  async move(id: string, input: ColumnMoveDTO): Promise<ColumnDTO> {
    const { position } = ColumnMoveSchema.parse(input)
    const column = await this.load(id)
    const others = (await this.repo.ofBoard(column.boardId)).filter(each => each.id !== id)
    const at = Math.min(position, others.length)
    others.splice(at, 0, column)
    others.forEach((each, index) => each === column ? column.moveTo(index) : each.reposition(index))
    await this.repo.persistOrder(others, column.boardId)
    return column.toDTO()
  }

  /**
   * Removes a column, and the ones to its right move one place left. Whether it is
   * empty is not known here, where cards are not: `card.removeColumn` asks the cards
   * first, and is what the API calls.
   */
  @UseCase()
  async remove(id: string): Promise<void> {
    const column = await this.load(id)
    const others = (await this.repo.ofBoard(column.boardId)).filter(each => each.id !== id)
    others.forEach((each, index) => each.reposition(index))
    column.remove()
    await this.repo.persistOrder([column, ...others], column.boardId)
  }
```

`move` builds the new order in memory, gives every column its index, and saves them
all. A column whose position did not change has nothing to save: `save` does not
write it, and does not check its version. A position past the end is the end.

`remove` is a use case of the column module, but the API does not call it: a column
is removed only when no card is in it, and the column module does not know the cards.
That is for the card module, below.

### The route

`POST /columns/:columnId/move`, with a note on where removal went:

```ts
// cooper/backend/contexts/boards/modules/column/column.routes.ts
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { ColumnAddDTO, ColumnMoveDTO, ColumnRenameDTO } from './column'
import type { Column_Deps } from './column.deps'
import type { Column_Module } from './column.module'

/** A column's removal is the cards' route (`card.routes.ts`): they know whether it is empty. */
export function registerColumnRoutes(base: BoardsBase, columns: Column_Module, deps: Column_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/columns', async request => Response.json(await columns.list(request.params.boardId)))

  workspace.post('/boards/:boardId/columns', async request => {
    const input = await request.json() as ColumnAddDTO
    return Response.json(await columns.add(request.params.boardId, input), { status: 201 })
  })

  workspace.patch('/columns/:columnId', async request => {
    const input = await request.json() as ColumnRenameDTO
    return Response.json(await columns.rename(request.params.columnId, input))
  })

  workspace.post('/columns/:columnId/move', async request => {
    const input = await request.json() as ColumnMoveDTO
    return Response.json(await columns.move(request.params.columnId, input))
  })
}
```

## Cards move

A card moves to a column of its board (its own one too) at a position; the cards it
leaves close the gap, and the cards where it lands make room. Add what a client sends
for it to `card.schema.ts`, after `CardEditSchema`:

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export const CardEditSchema = z.object({ title: CardSchema.shape.title, description }).partial()
/** Where it goes: a column of its board and, in it, a position; at the bottom when none is given, or one past it. */
export const CardMoveSchema = z.object({
  columnId: CardSchema.shape.columnId,
  position: CardSchema.shape.position.optional(),
})
export const CardAssignSchema = z.object({ assigneeId: z.string() })
```

and its type, after `CardEditDTO`:

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export type CardEditDTO = z.input<typeof CardEditSchema>
export type CardMoveDTO = z.input<typeof CardMoveSchema>
```

The entity gets the same pair as the column, after `edit`, and `delete` at the end:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
  /** Someone moved it: to this column, at this position. */
  moveTo(columnId: string, position: number): void {
    this.change({ columnId, position })
  }

  /** Another one moved, or left: this one takes the place left to it in its column, and tells nothing. */
  reposition(position: number): void {
    this.change({ position })
  }
// …
  unassign(): void {
    this.change({ assigneeId: null })
  }

  delete(): void {
    this.markAsDeleted()
  }
}
```

A card is deleted for good too: the card repository has no `softDelete`. Its number
stays taken all the same, since `card_counter` is never lowered.

### The repository

Two methods. `inColumn` reads a column's cards from the top; add it after `toEntity`:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
  /** A column's cards, from the top. */
  inColumn(columnId: string): Promise<Card[]> {
    return this.find({ columnId }, { orderBy: [{ field: 'position' }] })
  }
```

`persistOrder` is the column's, for one or two columns at once. Add it after
`persistNew`:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
  /**
   * Saves cards in their new order, all of them or none: the one moved or
   * deleted, and the ones that took the places left, in each column it touches. Each
   * was read at a version, so a card someone else moved meanwhile makes it a
   * conflict, and the use case runs again with the columns as they are then.
   * One created meanwhile has no version here: the order of each column is checked
   * whole after writing, guarding those columns, so it is a conflict too.
   */
  async persistOrder(cards: Card[], columnIds: string[]): Promise<void> {
    const columns = [...new Set(columnIds)]
    await this.save(cards, each => this.write(each), {
      guard: columns.map(columnId => `cards:${columnId}`),
      after: async () => {
        for (const columnId of columns) {
          const positions = (await this.inColumn(columnId)).map(card => card.position)
          if (positions.some((position, index) => position !== index)) this.conflict()
        }
      },
    })
  }
```

It guards `cards:<column id>` for each column it touches: the key `persistNew` takes
for the column a new card goes to. So a new card and a move in the same column never
interleave: the move either sees the new card, or the card is created after the move,
at the new bottom. And a card created between the move's reads and its save is what
the check in `after` catches.

### A column that is not empty

Removing a column with cards in it would leave them pointing at nothing. It is a
conflict with the state of things, a 409:

```ts
// cooper/backend/contexts/boards/modules/card/errors/column-not-empty.ts
import { ConflictError } from 'newt/core'

/** A column is removed only once no card is in it. */
export class ColumnNotEmpty extends ConflictError {
  readonly code = 'card.column_not_empty'
  constructor(columnId: string, cards: number) {
    super(`Column ${columnId} has ${cards} card(s): move them to another column first`)
  }
}
```

### The use cases

Add `CardMoveSchema`, `CardMoveDTO` and `ColumnNotEmpty` to the imports of
`card.module.ts`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
import {
  Card,
  CardAssignSchema,
  CardCreateSchema,
  CardEditSchema,
  CardMoveSchema,
  MAX_CARDS,
  type CardAssignDTO,
  type CardCreateDTO,
  type CardDTO,
  type CardEditDTO,
  type CardMoveDTO,
} from './card'
import type { Card_Deps } from './card.deps'
import { Card_Repository } from './card.repository'
import { registerCardRoutes } from './card.routes'
import { AssigneeNotMember } from './errors/assignee-not-member'
import { CardNotFound } from './errors/card-not-found'
import { ColumnNotEmpty } from './errors/column-not-empty'
import { ColumnNotInBoard } from './errors/column-not-in-board'
import { TooManyCards } from './errors/too-many-cards'
```

`move` goes after `edit`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * Moves a card to a column of its board (the same one, too) at a position, and the
   * cards around take the places left and made: several cards saved at once, all or
   * none. Whoever moved one of them meanwhile, this card too, makes it run again from
   * the start, with the columns as they are then: two people dragging the same card
   * at once both get their move, one after the other.
   */
  @UseCase()
  async move(id: string, input: CardMoveDTO): Promise<CardDTO> {
    const { columnId, position } = CardMoveSchema.parse(input)
    const card = await this.load(id)
    const from = card.columnId
    if (columnId !== from) await this.assertColumnOf(card.boardId, columnId)
    const left = (await this.repo.inColumn(from)).filter(each => each.id !== id)
    const target = columnId === from ? left : await this.repo.inColumn(columnId)
    const at = Math.min(position ?? target.length, target.length)
    target.splice(at, 0, card)
    if (target !== left) left.forEach((each, index) => each.reposition(index))
    target.forEach((each, index) => each === card ? card.moveTo(columnId, index) : each.reposition(index))
    await this.repo.persistOrder(target === left ? target : [...left, ...target], [from, columnId])
    return card.toDTO()
  }
```

`left` is the column the card leaves, without it; `target` is where it lands, the
same list when it stays in its column. Each list is renumbered from 0, and every card
in them goes to one save.

Here is Ana and Bob's story with this code. Both load card #1 in *To do*, at the same
version. Ana's save commits first. Bob's save finds card #1 at a newer version: a
`ConcurrencyConflict`, nothing written. `move` runs again from the start, loads card
#1 now in *Doing*, takes it out of *Doing* and puts it in *Done*. Both requests answer
200; the card ends where the second one put it, and no column has a gap.

`delete` and `removeColumn` go after `unassign`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /** Deletes it, and the cards under it move one place up. Its number is not given again. */
  @UseCase()
  async delete(id: string): Promise<void> {
    const card = await this.load(id)
    const others = (await this.repo.inColumn(card.columnId)).filter(each => each.id !== id)
    others.forEach((each, index) => each.reposition(index))
    card.delete()
    await this.repo.persistOrder([card, ...others], [card.columnId])
  }

  /**
   * Removes a column of a board, only if no card is in it. The cards answer, since a
   * card points at its column and a column knows nothing of the cards: the column
   * module cannot ask them without the two needing each other. So this use
   * case asks, and has the column module remove it: a write to another module outside
   * a worker, said where it is seen. It is the only write it makes, so a failure leaves
   * nothing halfway.
   */
  @UseCase({ writesTo: ['column'] })
  async removeColumn(columnId: string): Promise<void> {
    const column = await this.deps.column.get(columnId)
    const cards = await this.repo.count({ columnId })
    if (cards > 0) throw new ColumnNotEmpty(columnId, cards)
    await this.deps.column.remove(column.id)
  }
```

### Writing to another module: `writesTo`

`removeColumn` is the first use case in cooper that writes to **another module**:
`column.remove` saves, and it is called from the card module. newt refuses that by
default. Each module's save is a transaction of its own; a use case that saved in two
modules and failed between the saves would leave the first saved, with nothing to
finish the work. So a write to another module happens from a worker reacting to an
event, whose job runs again until it completes (chapter [11](./11-reacting)). newt
checks it as the use cases run: a use case of `column` that saves, called under a use
case of `card` outside a worker, throws an error that starts `[write rule] card.removeColumn writes to
boards.column outside a worker`.

Here the exception is justified. The column module cannot ask the cards whether the
column is empty: `card` depends on `column`, and the reverse would be a cycle. The
card module asks, and then has the column removed. The rule's concern does not apply:
`column.remove` is the only write, so a failure leaves nothing halfway.

`@UseCase({ writesTo: ['column'] })` says so where it is seen, with the reason in the
comment above. It counts for whatever is written below that use case, however deep.

There is one gap left. A card moved into the column between the count and the
removal points at a column that is gone; chapter
[13](./13-another-context) closes it with a worker that moves such cards
out.

### The routes

`card.routes.ts` imports `CardMoveDTO`, and gets `POST /cards/:cardId/move`,
`DELETE /cards/:cardId` and the column's removal, `DELETE /columns/:columnId`:

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { CardAssignDTO, CardCreateDTO, CardEditDTO, CardMoveDTO } from './card'
import type { Card_Deps } from './card.deps'
import type { Card_Module } from './card.module'

export function registerCardRoutes(base: BoardsBase, cards: Card_Module, deps: Card_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/cards', async request => Response.json(await cards.listInBoard(request.params.boardId)))

  workspace.post('/boards/:boardId/cards', async request => {
    const input = await request.json() as CardCreateDTO
    return Response.json(await cards.create(request.params.boardId, input), { status: 201 })
  })

  workspace.get('/cards/:cardId', async request => Response.json(await cards.get(request.params.cardId)))

  workspace.patch('/cards/:cardId', async request => {
    const input = await request.json() as CardEditDTO
    return Response.json(await cards.edit(request.params.cardId, input))
  })

  workspace.post('/cards/:cardId/move', async request => {
    const input = await request.json() as CardMoveDTO
    return Response.json(await cards.move(request.params.cardId, input))
  })

  workspace.post('/cards/:cardId/assign', async request => {
    const input = await request.json() as CardAssignDTO
    return Response.json(await cards.assign(request.params.cardId, input))
  })

  workspace.post('/cards/:cardId/unassign', async request => Response.json(await cards.unassign(request.params.cardId)))

  workspace.delete('/cards/:cardId', async request => {
    await cards.delete(request.params.cardId)
    return new Response(null, { status: 204 })
  })

  // A column is removed by the cards, which know whether it is empty.
  workspace.delete('/columns/:columnId', async request => {
    await cards.removeColumn(request.params.columnId)
    return new Response(null, { status: 204 })
  })
}
```

Two modules may register routes under the same group; `/columns/:columnId` with
`DELETE` is the card module's, with `PATCH` the column module's.

## Tests

In `column.test.ts`, add two tests after the one that lets in only the columns that
fit:

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
  test('moves a column, and the others take the places left', async () => {
    const [, , done] = [await add('To do'), await add('Doing'), await add('Done')]

    await inAcme(() => t.modules.column.move(done.id, { position: 0 }))
    expect(await names()).toEqual(['0:Done', '1:To do', '2:Doing'])

    await inAcme(() => t.modules.column.move(done.id, { position: 99 }))
    expect(await names()).toEqual(['0:To do', '1:Doing', '2:Done'])
  })

  test('gives each of two moves at once its turn, and leaves no gap', async () => {
    const [todo, doing, done] = [await add('To do'), await add('Doing'), await add('Done')]

    await Promise.all([
      inAcme(() => t.modules.column.move(done.id, { position: 0 })),
      inAcme(() => t.modules.column.move(todo.id, { position: 2 })),
    ])

    const order = await names()
    expect(order.map(name => name.split(':')[0])).toEqual(['0', '1', '2'])
    expect(order.map(name => name.split(':')[1]).sort()).toEqual([todo.name, doing.name, done.name].sort())
  })
```

and one after `renames a column`:

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
  test('removes a column only when no card is in it, and the others move left', async () => {
    const [todo, doing] = [await add('To do'), await add('Doing'), await add('Done')]
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo.id, title: 'Write the plan' }))

    await expect(inAcme(() => t.modules.card.removeColumn(todo.id))).rejects.toMatchObject({ code: 'card.column_not_empty' })

    await inAcme(() => t.modules.card.move(card.id, { columnId: doing.id }))
    await inAcme(() => t.modules.card.removeColumn(todo.id))
    expect(await names()).toEqual(['0:Doing', '1:Done'])
  })
```

In `card.test.ts`, the counter's test now also deletes the last card and checks its
number is not given again. Add the lines at its end, and two tests after it:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
    expect(sorted(created.map(card => card.position))).toEqual(Array.from({ length: 20 }, (_, i) => i))

    // The last one deleted, its number stays taken: five more at once get #21 to #25.
    await inAcme(() => t.modules.card.delete(created.find(card => card.number === 20)!.id))
    const more = await Promise.all(Array.from({ length: 5 }, (_, i) => create(`More ${i}`)))
    expect(sorted(more.map(card => card.number))).toEqual([21, 22, 23, 24, 25])
  })

  test('never gives a deleted card\'s number again, and closes the gap it leaves', async () => {
    const [, second] = [await create('Plan'), await create('Design'), await create('Build')]

    await inAcme(() => t.modules.card.delete(second.id))
    await create('Ship')

    expect(await columns()).toEqual({ todo: ['#1@0', '#3@1', '#4@2'], doing: [], done: [] })
  })

  test('never gives the number of the last card again, once it is deleted', async () => {
    const [, , build] = [await create('Plan'), await create('Design'), await create('Build')]

    await inAcme(() => t.modules.card.delete(build.id))
    await create('Ship')

    expect(await columns()).toEqual({ todo: ['#1@0', '#2@1', '#4@2'], doing: [], done: [] })
  })
```

Then replace the test `creates a card only in a column of its board` (after the
`MAX_CARDS` one) with three:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('moves a card to another column, or within its own, and the others make room', async () => {
    const [plan, design, build] = [await create('Plan'), await create('Design'), await create('Build')]

    await inAcme(() => t.modules.card.move(design.id, { columnId: doing }))
    await inAcme(() => t.modules.card.move(build.id, { columnId: doing, position: 0 }))
    await inAcme(() => t.modules.card.move(plan.id, { columnId: doing, position: 1 }))
    expect(await columns()).toEqual({ todo: [], doing: ['#3@0', '#1@1', '#2@2'], done: [] })

    await inAcme(() => t.modules.card.move(design.id, { columnId: doing, position: 0 }))
    expect(await columns()).toEqual({ todo: [], doing: ['#2@0', '#3@1', '#1@2'], done: [] })
  })

  test('gives each of two moves of the same card at once its turn, and leaves no gap', async () => {
    const [plan] = [await create('Plan'), await create('Design'), await create('Build')]

    const moved = await Promise.all([
      inAcme(() => t.modules.card.move(plan.id, { columnId: doing })),
      inAcme(() => t.modules.card.move(plan.id, { columnId: done })),
    ])

    expect(moved.map(card => card.columnId).sort()).toEqual([doing, done].sort())
    const after = await columns()
    expect(after.todo).toEqual(['#2@0', '#3@1'])
    expect([...after.doing, ...after.done]).toEqual(['#1@0'])
  })

  test('moves a card only to a column of its board', async () => {
    const plan = await create('Plan')
    const other = await inAcme(() => t.modules.board.create({ name: 'Other' }))
    const elsewhere = await inAcme(() => t.modules.column.add(other.id, { name: 'To do' }))

    await expect(inAcme(() => t.modules.card.move(plan.id, { columnId: elsewhere.id }))).rejects.toMatchObject({ code: 'card.column_not_in_board' })
    await expect(create('Lost', { columnId: elsewhere.id })).rejects.toMatchObject({ code: 'card.column_not_in_board' })
  })
```

The second one is Ana and Bob: both moves succeed, one of them ran twice, and the
card is in one column at position 0, with no gap in *To do*.

In `boards.context.test.ts`, the first card test keeps the *Done* column's id and
moves the card there over HTTP:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
    const done = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'Done' })).body.id
    const card = await call<{ id: string, number: number }>('POST', `/acme/boards/${id}/cards`, { columnId: todo, title: 'Plan' })
    expect(card).toMatchObject({ status: 201, body: { number: 1 } })

    expect((await call('POST', `/acme/cards/${card.body.id}/move`, { columnId: done })).body).toMatchObject({ columnId: done, position: 0 })
```

and a test after it removes a column over HTTP:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
  test('removes a column only when it is empty', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id
    const todo = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'To do' })).body.id
    const card = (await call<{ id: string }>('POST', `/acme/boards/${id}/cards`, { columnId: todo, title: 'Plan' })).body.id

    expect(await call('DELETE', `/acme/columns/${todo}`)).toMatchObject({ status: 409, body: { code: 'card.column_not_empty' } })
    expect((await call('DELETE', `/acme/cards/${card}`)).status).toBe(204)
    expect((await call('DELETE', `/acme/columns/${todo}`)).status).toBe(204)
    expect((await call<unknown[]>('GET', `/acme/boards/${id}/columns`)).body).toEqual([])
  })
```

## Check it

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint
```

Then by hand, with the backend running (`bun cooper/backend/index.ts`). Make a board
with three columns and a card, and move the card to two columns at once:

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
post() { curl -s -X POST "$API$1" -H "$H" -H 'x-user: ana' -d "$2"; }
BOARD=$(post /boards "{\"name\":\"Moves $RANDOM\"}" | jq -r .id)
TODO=$(post /boards/$BOARD/columns '{"name":"To do"}' | jq -r .id)
DOING=$(post /boards/$BOARD/columns '{"name":"Doing"}' | jq -r .id)
DONE=$(post /boards/$BOARD/columns '{"name":"Done"}' | jq -r .id)
CARD=$(post /boards/$BOARD/cards "{\"columnId\":\"$TODO\",\"title\":\"Plan\"}" | jq -r .id)
post /cards/$CARD/move "{\"columnId\":\"$DOING\"}" | jq -c '{columnId, position}' &
post /cards/$CARD/move "{\"columnId\":\"$DONE\"}" | jq -c '{columnId, position}' &
wait
curl -s $API/boards/$BOARD/cards -H 'x-user: ana' | jq -c '.[] | {columnId, position}'
```

Both moves answer with the card at position 0, one in *Doing* and one in *Done*; the
list shows it once, in the column of the move that ran second. Now try to remove
*Done*, or whichever column holds it:

```sh
curl -s -X DELETE $API/columns/$DONE -H 'x-user: ana'
```

```text
{"error":"Column … has 1 card(s): move them to another column first","code":"card.column_not_empty"}
```

if the card is there, and nothing (a 204) if it is not.

## What to remember

- Every row has a version. Saving a row someone saved since you read it is a
  `ConcurrencyConflict` (409), and nothing is written.
- A use case runs again on a conflict, from the start, up to three more times. Only
  the first of a chain does, with all it calls. So a use case loads, decides and saves
  at the end, and does nothing that cannot be undone before saving;
  `retryOnConflict: false`, with its reason, is for one that cannot.
- A row created meanwhile has no version: check the whole order in `after`, under a
  guard, and call `this.conflict()` when someone slipped in.
- Several entities of one module saved at once are one `save`: all or none.
- A use case writes to another module only from a worker. A justified exception says
  `writesTo`, with the reason beside it.

Next: [Asking twice: idempotent POSTs](./09-idempotent-posts).
