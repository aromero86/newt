# Workers that can run again

The last chapter ended with a guarantee that sounds like a problem: a job runs at
least once, so maybe more. This chapter shows why, and how cooper's workers are
written so that running them twice gives the same result as running them once.

## Why a job can run twice

A worker finishes its job, and right before it marks the job done, the server stops.
When it is back, the job is still pending, and it runs again. There is no way to
avoid it entirely: between doing something and noting that it was done, there is
always a moment.

There are more ways to get there:

- The job failed halfway, after writing part of what it writes. Its retry starts from
  the beginning.
- A worker holds a job with a lease of a minute, and renews it every twenty seconds
  while it runs. If the process freezes and the lease runs out, another worker takes
  the job, and the first one may still finish.
- Two different events lead to the same use case. `card.notifyAssignee` runs on
  `card.created` and on `card.assigned`.

So every worker must be **idempotent**: running it twice must give the same result as
running it once. In practice, it means each use case a worker calls is written to be
repeated.

## Four techniques

### 1. Look at the state before acting

The simplest one: before doing something, check whether it is already done.
`workspace.prepare` does it for each of its steps:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
@UseCase()
async prepare(workspaceId: string): Promise<void> {
  if (!await this.deps.member.exists(workspaceId)) return
  await runInWorkspace(workspaceId, async () => {
    const board = await this.deps.board.findByName(WELCOME_BOARD.name)
      ?? await this.deps.board.create({ name: WELCOME_BOARD.name, description: WELCOME_BOARD.description })
    const columns = await this.deps.column.addMissing(board.id, [...WELCOME_BOARD.columns])
    const todo = columns.find(column => column.name === WELCOME_BOARD.columns[0])!
    await this.deps.card.createFirst(board.id, { columnId: todo.id, ...WELCOME_BOARD.card })
  })
  if (!await this.deps.member.exists(workspaceId)) await this.purge(workspaceId)
}
```

- The workspace: if auth deleted it meanwhile, there is nothing to prepare (the
  [previous chapter](./12-eventual-consistency) explains the check after).
- The board: it looks for one called "Welcome" before creating it.
- The columns: `column.addMissing` adds only the ones the board does not have.
- The card: `card.createFirst` creates it only if the board has none.

The last two are use cases written for a worker. Each one says in its name that it
can be called again, and answers what is there:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
/**
 * Adds at the end of the board the columns of these names it does not have yet,
 * and answers all its columns: what a worker preparing a board calls, as many
 * times as it takes. Runs at once add each name once: the save checks it again.
 */
@UseCase()
async addMissing(boardId: string, names: string[]): Promise<ColumnDTO[]> {
  await this.deps.board.get(boardId)
  const columns = await this.repo.ofBoard(boardId)
  const missing = names.filter(name => !columns.some(column => column.name === name))
  if (missing.length === 0) return columns.map(column => column.toDTO())
  // …
  await this.repo.persistMissing(added, boardId)
  return [...columns, ...added].map(column => column.toDTO())
}
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * A board's first card, unless it has one already (null then): what a worker
 * preparing a board calls, as many times as it takes. Runs at once create it once:
 * the save counts the board's cards again.
 */
@UseCase()
async createFirst(boardId: string, input: CardCreateDTO): Promise<CardDTO | null> {
  if (await this.repo.count({ boardId }) > 0) return null
  const card = await this.newCard(boardId, input, BOARDS)
  await this.repo.persistNew(card, { first: true })
  return card.toDTO()
}
```

Each step is a separate transaction, so a run can stop between any two of them. Any
later run finishes what the earlier one left, and adds nothing to a finished workspace.

Entities protect themselves in the same way. `card.unassign()` on a card with no
assignee changes nothing and tells nothing:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
unassign(author: CardAuthor): void {
  const previousAssigneeId = this.data.assigneeId
  if (previousAssigneeId === null) return
  // …
}
```

And `unassignMember`, which runs when someone loses their access to a workspace,
leans on that. The second time, the member has no cards left:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * Someone lost their access to a workspace: its cards they had are left without an
 * assignee. What a worker calls, reacting to auth; the second time, they have none.
 */
@UseCase()
async unassignMember(workspaceId: string, userId: string): Promise<void> {
  await runInWorkspace(workspaceId, async () => {
    const cards = await this.repo.find({ assigneeId: userId })
    for (const card of cards) card.unassign(BOARDS)
    await this.repo.persist(...cards)
  })
}
```

### 2. Something that identifies the operation, checked in the save

Looking first is enough when runs come one after another. But two runs at the same
time both look before either saves, and both see nothing. The real check has to be
inside the save.

For the welcome board, what identifies the operation is the board's name. A workspace
cannot have two boards with the same name, and that rule is checked inside the save,
guarding the name ([rules over rows](./08-rules-over-rows)):

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
async persistWithNameFree(board: Board): Promise<void> {
  const { workspaceId, name } = board
  await this.save([board], each => this.write(each), {
    guard: [`boardName:${workspaceId}:${name.replace(/[A-Z]/g, letter => letter.toLowerCase())}`],
    after: async () => {
      if (await this.count({ name: { ieq: name } }) > 1) throw new BoardNameTaken(name)
    },
  })
}
```

Two runs of `prepare` at once cannot both create "Welcome". The second one waits for
the first, sees its board, and fails with `BoardNameTaken`. Its job runs again later,
finds the board, and goes on from there. The check in step 1 stays as a shortcut: a
repeated run that comes alone does not even try to save.

The columns and the first card do the same, with a gentler ending. Their saves count
again under the board's guard, and the one that finds another run's work throws
`ConcurrencyConflict`, so its use case runs again at once and finds what is there:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
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

auth gives an access the same way, so `tenant.ensureAdmin` can run while the request
that created the workspace is still giving it. The save is guarded by the access's
key, and the table has a unique index on it. The one that loses answers with the
access the other gave:

```ts
// cooper/backend/contexts/auth/modules/access/access.module.ts
private async give(input: { userId: string, productId: string, tenantId: string | null, role: 'admin' | 'member' }): Promise<AccessDTO> {
  const { userId, productId, tenantId } = input
  const existing = await this.repo.first({ userId, productId, tenantId })
  if (existing) return existing.toDTO()
  const access = Access.grant(input)
  try {
    await this.repo.persistKeepingOneAdmin(access)
  } catch (error) {
    // Given by another save at the same time (a tenant's admin, by the request that
    // made it and by its worker): given once, and this one gives what is there.
    const given = error instanceof ConcurrencyConflict ? await this.repo.first({ userId, productId, tenantId }) : undefined
    if (!given) throw error
    return given.toDTO()
  }
  return access.toDTO()
}
```

```ts
// cooper/backend/contexts/auth/modules/access/access.repository.ts
await this.save(accesses, access => this.write(access), {
  guard: [
    ...accesses.map(access => `access:${access.userId}:${access.productId}:${access.tenantId ?? ''}`),
    ...tenants.map(tenantId => `tenantAdmin:${tenantId}`),
  ],
  // …
})
```

### 3. The event's id as the result's id

Sometimes nothing in the data identifies the operation. A card's activity log records
"Ana moved #4 to Done". Ana can move it there twice, and both moves belong in the log:
looking for "an entry about moving #4 to Done" would drop the second one.

What identifies each entry is the event it records. Every card event carries an
`eventId` ([events](./10-events)), and the entry takes it as its own id:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.module.ts
/**
 * Records an event of a card, in its workspace (a worker is in none), by the event's
 * id: the second time, the entry is there already.
 */
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

A job that runs twice finds its entry and stops. Two runs at once both try to insert
the same id, and the primary key refuses the second. Two moves are two events, with
two ids: two entries. Whenever a worker creates something, ask what its id should be;
the event's id is often the answer.

### 4. Write the result, not the change

"Set the assignee to nobody" can be repeated. "Toggle the assignee" cannot. When a
worker changes data, make it write the state it wants, not a step from the state it
found.

`workspace.purge`, the step of a workspace's deletion that runs in boards, is written
that way. It does not delete "the boards it read"; it deletes "every board of this
workspace", whatever is there:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
async purgeWorkspace(workspaceId: string): Promise<void> {
  await this.saveRows(async () => {
    await this.base.db.deleteFrom('board').where('workspaceId', '=', workspaceId).execute()
  })
}
```

The second time, there is nothing to delete, and nothing fails.

## When it runs late

Idempotent is not enough. A job can also run late, when the data has changed again.
`notifyAssignee` gets the card as it was when it was assigned. By the time the worker
runs, someone may have unassigned it, or given it to someone else. So it reads the
card again:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
@UseCase()
async notifyAssignee(card: CardDTO, by: string | null): Promise<void> {
  if (card.assigneeId === null || card.assigneeId === by) return
  const current = await runInWorkspace(card.workspaceId, () => this.repo.first({ id: card.id }))
  if (current?.assigneeId !== card.assigneeId) return
  const member = await this.deps.member.find(card.workspaceId, card.assigneeId)
  if (!member) return
  // …
}
```

- The card is gone: no email.
- It has another assignee now: no email. That assignment told its own event, and its
  job emails the new assignee.
- The assignee left the workspace: no email.

`prepare` asks the same kind of question with `member.exists`: is the workspace still
there? The event says what happened. What is true now, the worker reads again.

## The checklist

Before you call a worker done, ask:

- [ ] If it runs twice in a row, is the result the same?
- [ ] If two runs overlap, does a check inside the save stop the second one?
- [ ] If it runs late, when the data has changed again, does it do something sensible?
- [ ] If it fails halfway, does the retry finish the work?
- [ ] Does it tell a business "no" (nothing to do: return) from a failure (throw,
  and it runs again)? [When something fails](./15-failures) is about this one.

## Check it

cooper's tests ask each question on purpose. This one sets up a run
of `prepare` that stopped halfway (a board and one column, by hand), then runs the
job twice:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
test('prepares a workspace once, however many times its work runs, and finishes one left halfway', async () => {
  t.auth.join('acme', 'ana')
  // A first run that stopped halfway: the board and one column.
  const board = await inAcme(() => t.modules.board.create({ name: 'welcome' }))
  await inAcme(() => t.modules.column.add(board.id, { name: 'To do' }))

  await t.auth.createWorkspace('acme', 'ana')
  await t.settled()
  await t.auth.createWorkspace('acme', 'ana')
  await t.settled()

  expect(await welcome()).toEqual({
    boards: ['welcome'],
    columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
  })
})
```

One board (the one that was there, found by its name whatever the case), three
columns, one card. The second question, with three runs at once from a board left
without columns:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
test('gives the welcome board its columns and its card once, however many runs go at once', async () => {
  t.auth.join('acme', 'ana')
  // A first run that stopped halfway: the board, and none of its columns.
  await inAcme(() => t.modules.board.create({ name: 'Welcome' }))

  await Promise.all([t.auth.createWorkspace('acme', 'ana'), t.auth.createWorkspace('acme', 'ana'), t.auth.createWorkspace('acme', 'ana')])
  await t.settled()

  expect(await welcome()).toEqual({
    boards: ['Welcome'],
    columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
  })
  expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done'])
})
```

The third: the work of `tenant.created` run again late, after the workspace was
deleted and purged, writes nothing:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
test('prepares nothing in a workspace auth deleted before its work ran', async () => {
  await t.auth.createWorkspace('acme', 'ana')
  await t.auth.deleteWorkspace('acme')
  await t.settled()

  // The work of `tenant.created`, run again late: after the workspace was purged.
  await t.auth.tellCreatedAgain('acme')
  await t.settled()

  expect(await t.modules.board.listOf('acme', { size: 10 })).toMatchObject({ items: [], total: 0 })
  expect(await t.modules.card.countByWorkspace(['acme'])).toEqual([{ workspaceId: 'acme', cards: 0 }])
})
```

And the activity log, called twice with the same event, records it once:

```ts
// cooper/backend/contexts/boards/modules/activity/activity.test.ts
test('records each event once, however many times its job runs', async () => {
  const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
  await t.settled()
  const told = { ...card, by: 'ana', via: 'web' as const, eventId: Bun.randomUUIDv7(), at: new Date().toISOString() }

  await t.modules.activity.recordCreated(told)
  await t.modules.activity.recordCreated(told)

  expect((await activityOf(card.id)).total).toBe(2)
})
```

Two entries: the card's own `card.created`, recorded by its worker, and the one the
test told twice.

## In short

- A job runs at least once, so maybe twice: every worker must be idempotent.
- Look at the state before acting: find before creating, add only what is missing.
- When two runs can overlap, the real check is inside the save, guarded.
- When nothing in the data identifies the work, use the event's id as the result's id.
- Write the result, not the change.
- A late job reads the data again: the event says what happened, not what is true now.
- Test it: run the work twice, and from a state left halfway.
