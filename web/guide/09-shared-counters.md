# Values everyone changes

Every card of a board has a number: #1, #2, #3… People say "#12 is blocked", the
assignment email names it, and `card.getByNumber` finds a card by it. Two people
creating cards on the same board at the same moment must get two different numbers.
And a number must never come back: if #12 is deleted, "#12" in last week's email must
not end up meaning another card.

A board's next number is a value **everyone changes at once**: every new card of the
board takes it and moves it one up. This chapter shows where cooper keeps it, how two
cards created at once take turns on it instead of colliding, and what to do when
taking turns is not enough.

## Two designs that do not work

**A counter on the board.** `nextCardNumber`, a field of the board, read and increased
by every new card. Two problems:

- The board row would collide with anything else that saves it. Renaming the board
  while cards are being created would make one of the two saves a
  `ConcurrencyConflict`, and run again (chapter [7](./07-concurrency)).
- The board is another module. Creating a card would write two modules in one use
  case, and one module's save never writes another's (chapter [6](./06-transactions)).

**No counter at all: the last card's number, plus one.** Nothing to collide on, and
nothing written outside the cards. But it only sees the cards that are still there.
Cards are deleted for good: delete #3 of three, and the next card gets #3 again. The
number that must never come back comes back.

## The cards' own counter

cooper keeps the last number each board gave in a table of the **card module**, not of
the board: `card_counter`, one row per board, with the board's id as its own.

```sql
-- cooper/backend/contexts/boards/migrations/00003_card_counter_up.sql
-- The last number each board gave a card, so a deleted card's number is never given
-- again: cards are deleted for good, and the highest one left is not the last one
-- given. Its id is the board's. A board that has cards starts from its highest number.
CREATE TABLE card_counter (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  last_number INTEGER NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX card_counter_workspace ON card_counter (workspace_id);

INSERT INTO card_counter (id, workspace_id, last_number, version)
SELECT board_id, workspace_id, max(number), 1 FROM card GROUP BY board_id, workspace_id;
```

The last line matters when you add a table like this to an app already running: the
boards that have cards start from their highest number, not from 1. Chapter
[24](./24-migrations) is about migrations.

The table has no entity of its own. It is part of how the card repository saves a
card, so the repository opens it beside its own table:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/** The last number a board gave a card: its id is the board's. A card deleted does not give it back. */
export type CardCounterRow = { id: string, workspaceId: string, lastNumber: number, version: number }

export class Card_Repository extends TableRepository<Card, CardRow, BoardsBase> {

  private readonly counters

  constructor(base: BoardsBase) {
    super(base, base.store.table<CardRow>('card', { unique: [['boardId', 'number']] }), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
    this.counters = base.store.table<CardCounterRow>('card_counter')
  }
  // …
}
```

Creating a card writes only the card module's rows, and the board row is never
touched: renaming a board and creating its cards never collide.

## Taking the number in the save

The counter is one row that every new card of the board updates. Two cards created at
once would both read `lastNumber: 6`, and both try to write 7: one of them would hit
the row's version, and run again. With ten people on a board, the retries pile up.

So the number is not taken in the use case. It is taken **inside the save**, in
`before`, under a `guard` on the board (chapter [8](./08-rules-over-rows)):

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/**
 * Saves a new card with the next number of its board and at the bottom of its
 * column, both read inside the save, and only if the board is left with no more
 * than `MAX_CARDS`. The save guards the board's cards and the column's order: two
 * cards created at once in a board get #7 and #8, in any store, and neither waits
 * for a conflict to try again.
 *
 * The number is a value everyone changes at once: each board keeps the last one it
 * gave in a row of its own, which every new card of the board updates. Updated in
 * place, those saves would collide with each other; under the board's guard, they
 * take turns instead, and none is refused. The row is never lowered, so a deleted
 * card's number, even the last one's, is not given again. The table's unique index
 * on (board, number) is the last word.
 */
async persistNew(card: Card, options: { first?: boolean } = {}): Promise<void> {
  const { boardId, columnId } = card
  await this.save([card], each => this.write(each), {
    guard: [`boardCards:${boardId}`, `cards:${columnId}`],
    before: async () => card.place(await this.takeNumber(card), await this.count({ columnId })),
    after: async () => {
      const count = await this.count({ boardId })
      if (count > MAX_CARDS) throw new TooManyCards(boardId)
      // Its board's first, and another one got in first: the use case runs again, and finds it.
      if (options.first && count > 1) throw new ConcurrencyConflict()
    },
  })
}
```

`takeNumber` reads the counter and moves it one up, in the same transaction as the
card. A board's first card creates the row:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/** The board's next number, taken: its counter one up, in the save of the card that gets it. */
private async takeNumber(card: Card): Promise<number> {
  const [counter] = await this.counters.find({ id: card.boardId })
  if (!counter) {
    await this.counters.insert({ id: card.boardId, workspaceId: card.workspaceId, lastNumber: 1 })
    return 1
  }
  const number = counter.lastNumber + 1
  await this.counters.update(counter.id, counter.version, { lastNumber: number })
  return number
}
```

The key `boardCards:<board id>` is what turns the collision into a queue: two saves
with it never interleave, in any store. The second save starts once the first has
committed, reads `lastNumber: 7`, and writes 8. Neither is refused, and neither runs
again. The same key guards the 500-card limit in `after`, a rule over the board's
cards (chapter [8](./08-rules-over-rows)).

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
  this.trackEvent(new Card_Created({ ...this.toDTO(), ...this.author! }))
}
```

`trackEvent` replaces the `card.created` that `Card.create` noted with the guessed
number: an entity tells one event of each class per save (chapter [10](./10-events)).

The use case still reads both values first, without taking anything, so the card it
builds is valid from the start:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/** The number the next card of a board gets: one more than the last one it gave. */
async nextNumber(boardId: string): Promise<number> {
  const [counter] = await this.counters.find({ id: boardId })
  return (counter?.lastNumber ?? 0) + 1
}
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
return Card.create({
  workspaceId: board.workspaceId,
  boardId,
  columnId,
  // What they look to be now; the save reads them again, where nothing slips in.
  number: await this.repo.nextNumber(boardId),
  position: await this.repo.count({ columnId }),
  title,
  description,
  assigneeId,
}, author)
```

And the table has the last word, in case a save ever forgot its guard:

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
-- #1, #2…: a number is its board's once.
CREATE UNIQUE INDEX card_number ON card (board_id, number);
```

The counters live and die with the cards: when auth deletes a workspace, the card
repository removes its cards and its counters together (chapter
[16](./16-sagas)).

### Check it

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('gives distinct numbers and places to cards created at once', async () => {
  const created = await Promise.all(Array.from({ length: 20 }, (_, i) => create(`Task ${i}`)))

  const sorted = (values: number[]) => values.toSorted((a, b) => a - b)
  expect(sorted(created.map(card => card.number))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  expect(sorted(created.map(card => card.position))).toEqual(Array.from({ length: 20 }, (_, i) => i))

  // The last one deleted, its number stays taken: five more at once get #21 to #25.
  await inAcme(() => t.modules.card.delete(created.find(card => card.number === 20)!.id))
  const more = await Promise.all(Array.from({ length: 5 }, (_, i) => create(`More ${i}`)))
  expect(sorted(more.map(card => card.number))).toEqual([21, 22, 23, 24, 25])
})
```

Twenty cards created at once: numbers #1 to #20, positions 0 to 19, none repeated,
none skipped. Then #20 is deleted, and the next five get #21 to #25: the counter
never goes down.

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('never gives the number of the last card again, once it is deleted', async () => {
  const [, , build] = [await create('Plan'), await create('Design'), await create('Build')]

  await inAcme(() => t.modules.card.delete(build.id))
  await create('Ship')

  expect(await columns()).toEqual({ todo: ['#1@0', '#2@1', '#4@2'], doing: [], done: [] })
})
```

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
of cards, moved at the speed of a hand.

The same `cards:<column id>` key guards creation, moves and deletion. So a new card
and a move in the same column never interleave: the move either sees the new card, or
the card is created after the move, at the new bottom.

## When taking turns is not enough: add rows

Taking turns works because a board gets a few new cards a minute. A value written
thousands of times a second would spend its time waiting for its key. For that, the
other design: **do not update a row at all; add one**. Adding a row never collides
with another addition: they are different rows. Whatever you need to know is computed
from them, or kept by whoever reads them.

cooper's example is a card's **activity**: what happened to it, who did it, and how
they came in (chapter [5](./05-who-and-where)). It is a log that only grows, one entry
per event a card tells, written by a worker reacting to it (chapter
[11](./11-reacting)). An entry is recorded once and never changed, and tells nothing
itself: it is what a card's events told.

```ts
// cooper/backend/contexts/boards/modules/activity/activity.ts
export class Activity extends Entity<typeof ActivitySchema> {
  // …
  /** A new entry, by the id of the event it records. */
  static record(input: EntityInput<ActivityDTO> & { id: string }): Activity {
    return new Activity(input, true)
  }
}
```

There is no `edit`, no `delete`: a card edited twice has two entries. Two people
moving cards of the same board at once write two new rows, and neither waits for the
other. There is no guard, and none is needed: no rule speaks about several entries.

```sql
-- cooper/backend/contexts/boards/migrations/00004_activity_up.sql
-- Each card's activity: one row for each thing that happened to it, by the id of the
-- event that told it. Rows are only ever added, never changed; a card deleted keeps
-- its history. Who did it is a user of auth's, by id; null when boards did it itself.
CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  -- …
  version INTEGER NOT NULL
);
```

Each entry takes the id of the event it records. A worker may run twice (chapter
[13](./13-repeatable-workers)); the second time, the entry is already there:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.module.ts
private async append(card: CardDTO, told: CardAuthor & CardEventStamp, kind: ActivityKind, detail: ActivityDTO['detail']): Promise<void> {
  const { eventId, at, by, via } = told
  await runInWorkspace(card.workspaceId, async () => {
    if (await this.repo.first({ id: eventId })) return
    await this.repo.persist(Activity.record({
      id: eventId,
      // …
    }))
  })
}
```

```ts
// cooper/backend/contexts/boards/modules/activity/activity.test.ts
test('records what happens to a card, who did it and how they came in, the newest first', async () => {
  const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
  await inAcme(() => t.modules.card.edit(card.id, { title: 'Plan it' }))
  await inAcme(() => t.modules.card.move(card.id, { columnId: doing }), 'mcp')
  await inAcme(() => t.modules.card.assign(card.id, { assigneeId: 'bea' }))
  await inAcme(() => t.modules.card.unassign(card.id))
  await inAcme(() => t.modules.card.delete(card.id))
  await t.settled()

  const { items, total } = await activityOf(card.id)
  expect(total).toBe(6)
  // …
})
```

A stock, a balance, a vote count work the same way: a row per movement, and the value
is their sum. When the sum is read much more than it is written, keep it too, in a
row updated by a worker that reads the movements, and remember that the movements are
the truth.

## In short

- A value everyone changes at once (a counter, a stock, a balance) collides with
  itself if every change updates one row in a use case.
- Keep it in the module that changes it, never in a row other saves write too: the
  card numbers live in the cards' `card_counter`, not on the board.
- Take it inside the save, in `before`, under a `guard` on what it counts. Saves take
  turns instead of colliding and running again.
- If the value must never come back, keep it in a row that only grows, not derived
  from rows that can be deleted.
- Keep a unique index as the last word.
- When even turns are too slow, add rows instead of updating one: an append-only log,
  each row by the id of what it records.
