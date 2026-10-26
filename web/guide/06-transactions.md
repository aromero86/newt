# Transactions

Moving a column on a board is not one write. The column moves, and every column
between its old place and its new one shifts by one. If the server stopped halfway,
two columns would share a position and another would be missing. This chapter shows
how newt keeps several writes together, and why it never keeps more than one module's.

## What a transaction is

A transaction is a set of writes that happen **all or none**. If something fails
halfway (an error, a power cut), nothing is left half done: it is as if it never
started.

In newt, **a transaction is a save**: each call to `repo.persist(...)`, or to the
`save` behind it. Inside that transaction the framework writes the entities **and the
jobs of the workers their events wake up**. Both are saved together, or neither is.
That guarantee is what chapters [10](./10-events) to [16](./16-sagas) build on.

## Several entities at once

`persist` takes several entities **of the same module**, and saves them in one
transaction:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
const cards = await this.repo.find({ assigneeId: userId })
for (const card of cards) card.unassign(BOARDS)
await this.repo.persist(...cards)
```

A repository can also give the save a name of its own, when the save says something
more. Moving a column is one of those. The use case loads the board's columns, puts
the moved one in its place, gives each its new position, and saves them all:

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
```

The entity tells two kinds of change apart. `moveTo` is what someone did, and tells it
with an event; `reposition` is a column taking the place left, and tells nothing:

```ts
// cooper/backend/contexts/boards/modules/column/column.ts
/** Someone moved it: where it goes. */
moveTo(position: number): void {
  this.change({ position })
  const diff = this.getChanges()
  if (diff) this.trackEvent(new Column_Moved({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
}

/** Another one moved, or left: this one takes the place left to it, and tells nothing. */
reposition(position: number): void {
  this.change({ position })
}
```

`persistOrder` writes every column it is given in one transaction:

```ts
// cooper/backend/contexts/boards/modules/column/column.repository.ts
async persistOrder(columns: Column[], boardId: string): Promise<void> {
  await this.save(columns, each => this.write(each), {
    guard: [`columns:${boardId}`],
    after: async () => {
      const positions = (await this.ofBoard(boardId)).map(each => each.position)
      if (positions.some((position, index) => position !== index)) throw new ConcurrencyConflict()
    },
  })
}
```

Ignore `guard` and `after` for now: they protect the order from someone else's save,
and chapters [7](./07-concurrency) and [8](./08-rules-over-rows) explain them. What
matters here is `this.save(columns, …)`: every column, or none.

A card move touches more rows. A card leaves one column and enters another: the cards
below it in the first column move up, the ones below its new place move down. One
save writes both columns:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
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
  target.forEach((each, index) => each === card ? card.moveTo(columnId, index, actingAuthor()) : each.reposition(index))
  await this.repo.persistOrder(target === left ? target : [...left, ...target], [from, columnId])
  return card.toDTO()
}
```

Deleting a card is the same move with one card gone: the deleted card and the ones
that move up go in one save.

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/** Deletes it, and the cards under it move one place up. Its number is not given again. */
@UseCase()
async delete(id: string): Promise<void> {
  const card = await this.load(id)
  const others = (await this.repo.inColumn(card.columnId)).filter(each => each.id !== id)
  others.forEach((each, index) => each.reposition(index))
  card.delete(actingAuthor())
  await this.repo.persistOrder([card, ...others], [card.columnId])
}
```

### Check it

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
test('moves a column, and the others take the places left', async () => {
  const [, , done] = [await add('To do'), await add('Doing'), await add('Done')]

  await inAcme(() => t.modules.column.move(done.id, { position: 0 }))
  expect(await names()).toEqual(['0:Done', '1:To do', '2:Doing'])

  await inAcme(() => t.modules.column.move(done.id, { position: 99 }))
  expect(await names()).toEqual(['0:To do', '1:Doing', '2:Done'])
})
```

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('moves a card to another column, or within its own, and the others make room', async () => {
  const [plan, design, build] = [await create('Plan'), await create('Design'), await create('Build')]

  await inAcme(() => t.modules.card.move(design.id, { columnId: doing }))
  await inAcme(() => t.modules.card.move(build.id, { columnId: doing, position: 0 }))
  await inAcme(() => t.modules.card.move(plan.id, { columnId: doing, position: 1 }))
  expect(await columns()).toEqual({ todo: [], doing: ['#3@0', '#1@1', '#2@2'], done: [] })
  // …
})
```

Or with cooper running, from the browser's session (the cookie is
`cooper_boards_session`):

```bash
curl -X POST http://localhost:3002/api/workspaces/$WORKSPACE/columns/$COLUMN/move \
  -H 'content-type: application/json' \
  -b "cooper_boards_session=$SESSION" \
  -d '{"position":0}'
```

## One module, one transaction

A save writes **one module's** rows. Cards and columns are two modules, so no save
moves a card and a column together. What has to be saved together, all or nothing, is
**an aggregate**, and an aggregate is **a module**. If two modules always had to
change at once, they would really be one. If not, one follows the other through
events.

cooper has a case of exactly that. Removing a column needs it to be empty, but the
column module does not know the cards. So `card.removeColumn` asks the cards, and then
has the column module remove it. The column's removal is its only write, so a failure
leaves nothing halfway:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
@UseCase({ writesTo: ['column'] })
async removeColumn(columnId: string): Promise<void> {
  const column = await this.deps.column.get(columnId)
  const cards = await this.repo.count({ columnId })
  if (cards > 0) throw new ColumnNotEmpty(columnId, cards)
  await this.deps.column.remove(column.id)
}
```

A card moved into that column at that very moment is not lost: a worker of the cards
takes it to the first column when it hears `column.removed` (chapter
[17](./17-modules-talk) tells that story, and why `writesTo` is needed).

## Why not one transaction per use case

It might look simpler to wrap the whole use case in a transaction. newt does not, for
two reasons:

- **A use case can read from other modules**, and each module saves only its own. A
  big transaction across modules would tie them to each other.
- **Short transactions do not get in each other's way.** In SQLite only one runs at a
  time, and the rest wait their turn; in Postgres and MySQL they run side by side but
  lock what they touch. A use case that read, thought and called others with its
  transaction open would make everyone wait. `card.create` reads the board and the
  columns, and asks auth whether the assignee is a member, before it opens its one
  short save.

The practical rule: **save once, at the end**.

When a use case cannot avoid saving in two steps, put first what may fail, and make
each step safe to repeat. `tenant.create` in auth is one: it saves the workspace, and
then gives its creator the admin access, a save of another module.

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
/**
 * A new workspace, made by the signed-in person, who is its admin. It writes to
 * `access` without being a worker, on purpose: whoever makes a workspace enters it
 * the moment it answers. The workspace is saved first and its admin after; should
 * that second save fail, the worker of `tenant.created` (`ensureAdmin`) gives it;
 * whichever of the two gives it second finds it given.
 * It never runs again on a conflict: it would make a second workspace.
 */
@UseCase({ writesTo: ['access'], retryOnConflict: false })
async create(input: TenantCreateDTO): Promise<TenantDTO> {
  const { name } = TenantCreateSchema.parse(input)
  const tenant = Tenant.create({ name, createdBy: currentActor().userId })
  await this.repo.persist(tenant)
  await this.admitAdmin(tenant.toDTO())
  return tenant.toDTO()
}
```

If the second save fails, the first one already wrote the `tenant.created` job in its
transaction, and the worker gives the admin access. Usually both run: the request
gives it, and the worker gives it again. `access.admit` is safe to run twice, even at
the same moment: given twice, it is given once, and the second time answers with the
access already there. Chapter [8](./08-rules-over-rows) shows how the save makes sure
of it, and chapter [13](./13-repeatable-workers) is about that kind of step.

Deleting a workspace is the same shape, the other way round. The workspace is saved
as deleted first. Its accesses go right after, in a second save, so that nobody enters
it from the moment the request answers:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
/**
 * Only its admin deletes it. The rest follows from `tenant.deleted`, each part from
 * a worker: its invitations here, its boards in boards, its accesses once more.
 * Its accesses also go at once, after it: it writes to `access` without being a
 * worker, on purpose, so that nobody enters it from the moment it answers. Should
 * that second save fail, its worker takes them away. It never runs again on a
 * conflict: it would find the workspace deleted already.
 */
@UseCase({ writesTo: ['access'], retryOnConflict: false })
async delete(tenantId: string): Promise<void> {
  await this.assertAdmin(tenantId)
  const tenant = await this.load(tenantId)
  tenant.delete()
  await this.repo.persist(tenant)
  await this.deps.access.revokeTenant(tenantId)
}
```

`revokeTenant` takes away whatever accesses are left, so its worker can run it again
after the request did, and finds nothing more to do:

```ts
// cooper/backend/contexts/auth/auth.test.ts
test('lets nobody in once deleted, before its workers run', async () => {
  // …
  await auth.base.jobs.stop()

  await as(ana, () => modules().tenant.delete(acme.id))
  expect(await modules().access.check(bob.id, 'cooper', acme.id)).toBeNull()
  expect(await modules().access.check(ana.id, 'cooper', acme.id)).toBeNull()
  // …
})
```

## In short

- A transaction is a save: `persist`, or the `save` a repository names. Everything in
  it is written, with its events' jobs, or nothing is.
- One save writes one module. Save several entities of it at once to keep them
  consistent: a column move, a card move.
- An aggregate is a module. Modules that must change together are one module; the
  others follow each other with events.
- Save once, at the end. Read and decide before, outside the transaction.
- If you must save twice, put first what may fail, and make every step repeatable.
