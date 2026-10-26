# Values everyone changes

Every card of a board has a number: #1, #2, #3… People say "#12 is blocked", the
assignment email names it, and `card.getByNumber` finds a card by it. Two people creating cards on the same board at the same
moment must get two different numbers, and no number should be skipped.

The obvious design is a counter on the board: `nextCardNumber`, read and increased by
every new card. This chapter shows why that is a trap, and what cooper does instead.

## A value that collides with itself

A counter is a value **everyone changes at once**. Every new card would read the
board, add one, and save the board. Two cards created at the same moment would both
save the same board row: one of them gets a `ConcurrencyConflict`, and runs again
(chapter [7](./07-concurrency)). With ten people working on a board, the retries pile
up. And the board row would also collide with anything else that saves it: renaming
the board while cards are being created.

There is a second problem. The counter lives in the board, and the card is another
module. Creating a card would write two modules in one use case, and one module's
save never writes another's (chapter [6](./06-transactions)).

The way out is **not to keep the value at all**, and to derive it from rows that are
only ever **added**:

- adding a row never collides with another addition: they are different rows;
- the value is computed from those rows, when needed.

## The card number: the last one, plus one

A card's number is what its board's cards already have, plus one:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/** The number the next card of a board gets: one more than the last one's. */
async nextNumber(boardId: string): Promise<number> {
  const [last] = await this.find({ boardId }, { orderBy: [{ field: 'number', direction: 'desc' }], limit: 1 })
  return (last?.toDTO().number ?? 0) + 1
}
```

No row keeps a counter. The board is never written when a card is created.

Read in the use case, though, that number is only a guess: two cards created at once
would both read #7. So the save reads it again, **inside its transaction**, guarding
the board's numbers, and gives the card the number it really gets:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/**
 * Saves a new card with the next number of its board and at the bottom of its
 * column, both read inside the save, guarding the board's numbers and the column's
 * order: two cards created at once in a board get #7 and #8, in any store, and
 * neither waits for a conflict to try again.
 *
 * The number is a value everyone changes at once (ch. 11), so no row keeps a counter
 * that every new card would update, and collide on: a card's number is what its
 * board's cards already have, plus one, and the cards are only ever added. The
 * table's unique index on (board, number) is the last word.
 */
async persistNew(card: Card): Promise<void> {
  const { boardId, columnId } = card
  await this.save([card], each => this.write(each), {
    guard: [`cardNumbers:${boardId}`, `cards:${columnId}`],
    before: async () => card.place(await this.nextNumber(boardId), await this.count({ columnId })),
  })
}
```

This is `guard` with `before` and no `after` (chapter [8](./08-rules-over-rows)).
There is no rule to check after writing: what matters is that **reading the last
number and writing the next one** happen with no other save of the board's numbers in
between. Two cards created at once take turns, and neither waits for a conflict to
try again.

The entity takes its number and its place as it is saved, and the event it tells
says them:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
/**
 * A new one takes its number and its place as it is saved: the next number of its
 * board and the bottom of its column, read where no other card can take them in
 * between. What it tells says them.
 */
place(number: number, position: number): void {
  if (!this.isNew) throw new Error(`Card ${this.id} is placed once, as it is created`)
  this.change({ number, position })
  this.trackEvent(new Card_Created(this.toDTO()))
}
```

`trackEvent` replaces the `card.created` that `Card.create` noted with the guessed
number: an entity tells one event of each class per save (chapter [10](./10-events)).

The use case still reads both values first, so the card it builds is valid from the
start:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
const card = Card.create({
  workspaceId: board.workspaceId,
  boardId,
  columnId,
  // What they look to be now; the save reads them again, where nothing slips in.
  number: await this.repo.nextNumber(boardId),
  position: await this.repo.count({ columnId }),
  title,
  description,
  assigneeId,
})
await this.repo.persistNew(card)
```

And the table has the last word, in case a save ever forgot its guard:

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
-- #1, #2…: a number is its board's once.
CREATE UNIQUE INDEX card_number ON card (board_id, number);
```

### Check it

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('gives distinct numbers and places to cards created at once', async () => {
  const created = await Promise.all(Array.from({ length: 20 }, (_, i) => create(`Task ${i}`)))

  const sorted = (values: number[]) => values.toSorted((a, b) => a - b)
  expect(sorted(created.map(card => card.number))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  expect(sorted(created.map(card => card.position))).toEqual(Array.from({ length: 20 }, (_, i) => i))
})
```

Twenty cards created at once: numbers #1 to #20, positions 0 to 19, none repeated,
none skipped.

A deleted card leaves a gap in the numbers, and the next card does not fill it:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('never gives a deleted card\'s number again, and closes the gap it leaves', async () => {
  const [, second] = [await create('Plan'), await create('Design'), await create('Build')]

  await inAcme(() => t.modules.card.delete(second.id))
  await create('Ship')

  expect(await columns()).toEqual({ todo: ['#1@0', '#3@1', '#4@2'], doing: [], done: [] })
})
```

::: warning
"The last one, plus one" only sees the cards that are still there. A card's row is
removed when it is deleted, so if the deleted card was the **last** one (#3 of three),
the next card gets #3 again. If a number must never come back, the rows it is derived
from must stay: count deleted cards too (keep them, marked deleted), or keep the
highest number given in a row that only grows.
:::

## The card's position

A card's place in its column is the other value everyone changes. A new card goes to
the bottom: its position is how many cards the column has. That count is read in the
same `before`, under the guard `cards:<column id>`, so two cards created at once in a
column get 0 and 1, never 0 and 0.

Positions are dense: 0, 1, 2… with no gaps. That is easy to read and to check
(`persistOrder` checks it after every move, chapter [7](./07-concurrency)), and it has
a cost: moving a card rewrites the position of every card it passes. Those are writes
to rows other people may be moving too, protected by their versions, and by the guard
on each column. A conflict runs the move again, and that is fine for columns of tens
of cards, moved at the speed of a hand. A value written thousands of times a second
would need the other design: add rows, never rewrite them.

The same `cards:<column id>` key guards creation, moves and deletion. So a new card
and a move in the same column never interleave: the move either sees the new card, or
the card is created after the move, at the new bottom.

## In short

- A value everyone changes at once (a counter, a stock, a balance) collides with
  itself if it is kept in one row.
- Do not keep it: derive it from rows that are only ever added. Two additions never
  collide.
- Read what the new row needs (the next number, the bottom of the column) inside the
  save, in `before`, under a `guard` for it. They take turns instead of retrying.
- Keep a unique index as the last word.
- A value derived from rows is only as lasting as those rows: if they can be deleted,
  decide whether the value may come back.
