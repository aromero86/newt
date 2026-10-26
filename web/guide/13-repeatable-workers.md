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

## Three techniques

### 1. Look at the state before acting

The simplest one: before doing something, check whether it is already done.
`workspace.prepare` does it for each of its steps:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
@UseCase()
async prepare(workspaceId: string): Promise<void> {
  await runInWorkspace(workspaceId, async () => {
    const board = await this.deps.board.findByName(WELCOME_BOARD.name)
      ?? await this.deps.board.create({ name: WELCOME_BOARD.name, description: WELCOME_BOARD.description })
    const columns = await this.deps.column.list(board.id)
    for (const name of WELCOME_BOARD.columns) {
      if (!columns.some(column => column.name === name)) columns.push(await this.deps.column.add(board.id, { name }))
    }
    if ((await this.deps.card.listInBoard(board.id)).length > 0) return
    const todo = columns.find(column => column.name === WELCOME_BOARD.columns[0])!
    await this.deps.card.create(board.id, { columnId: todo.id, ...WELCOME_BOARD.card })
  })
}
```

- The board: it looks for one called "Welcome" before creating it.
- The columns: it adds only the ones that are missing.
- The card: if the board has any card, there is nothing to add.

Each step is a separate transaction, so a run can stop between any two of them. Any
later run finishes what the earlier one left, and adds nothing to a finished workspace.

Entities protect themselves in the same way. `card.unassign()` on a card with no
assignee changes nothing and tells nothing:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
unassign(): void {
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
    for (const card of cards) card.unassign()
    await this.repo.persist(...cards)
  })
}
```

auth does the same when it gives an access, so `tenant.ensureAdmin` can run after
the request already gave it:

```ts
// cooper/backend/contexts/auth/modules/access/access.module.ts
private async give(input: { userId: string, productId: string, tenantId: string | null, role: 'admin' | 'member' }): Promise<AccessDTO> {
  const { userId, productId, tenantId } = input
  const existing = await this.repo.first({ userId, productId, tenantId })
  if (existing) return existing.toDTO()
  const access = Access.grant(input)
  await this.repo.persistKeepingOneAdmin(access)
  return access.toDTO()
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
    guard: [`boardName:${workspaceId}:${name.toLowerCase()}`],
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

The same goes for a workspace's admin: `persistKeepingOneAdmin` guards the tenant's
admin, so two saves of an admin at once cannot both succeed.

### 3. Write the result, not the change

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
/**
 * Tells the assignee of a card they have it, by email: from a worker, once the
 * assignment is saved, since an email cannot be taken back (ch. 16). Run late, it
 * reads the card again: if it is gone, or has another assignee by then, there is
 * nothing to tell (that assignment tells its own).
 */
@UseCase()
async notifyAssignee(card: CardDTO): Promise<void> {
  if (card.assigneeId === null) return
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

The event says what happened. What is true now, the worker reads again.

## The checklist

Before you call a worker done, ask:

- [ ] If it runs twice in a row, is the result the same?
- [ ] If two runs overlap, does a check inside the save stop the second one?
- [ ] If it runs late, when the data has changed again, does it do something sensible?
- [ ] If it fails halfway, does the retry finish the work?
- [ ] Does it tell a business "no" (nothing to do: return) from a failure (throw,
  and it runs again)? [When something fails](./15-failures) is about this one.

## Check it

cooper's tests ask the first and fourth questions on purpose. This one sets up a run
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
columns, one card. And this one checks that a card assigned and unassigned before its
worker runs tells nobody:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('tells the assignee of a card created for them, and nobody of one assigned and unassigned at once', async () => {
  await create('Plan', { assigneeId: 'bea' })
  const design = await create('Design')
  await inAcme(() => t.modules.card.assign(design.id, { assigneeId: 'ana' }))
  await inAcme(() => t.modules.card.unassign(design.id))

  await t.settled()

  expect(t.mails.map(mail => mail.subject)).toEqual(['#1 Plan is yours'])
})
```

## In short

- A job runs at least once, so maybe twice: every worker must be idempotent.
- Look at the state before acting: find before creating, add only what is missing.
- When two runs can overlap, the real check is inside the save, guarded.
- Write the result, not the change.
- A late job reads the data again: the event says what happened, not what is true now.
- Test it: run the work twice, and from a state left halfway.
