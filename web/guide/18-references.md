# References between modules

A card sits in a column, and may be assigned to someone. The column is a module of
boards. The person is a user of auth, another context. How does a card keep them?

## By id, and nothing more

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export const CardSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.string(),
  boardId: z.string(),
  /** Its status: the column it is in, by id. The column is another module's. */
  columnId: z.string(),
  // …
  /** Who it is assigned to: a member of the workspace, by their user's id in auth. */
  assigneeId: z.string().nullable(),
  // …
})
```

Never the `Column` entity inside the card. Never a column that copies the
assignee's name. Never a JOIN to another module's table. One aggregate points at
another **by its identity**. Each module stays the owner of its data, and can change
how it stores it without anyone noticing.

That leaves three questions: how do you know the reference exists when you save,
what happens when the other side goes away, and how do you show its name?

## When writing: check it exists

Creating a card checks both references. They are **reads**, so the card module can
make them from anywhere:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
@UseCase()
async create(boardId: string, input: CardCreateDTO): Promise<CardDTO> {
  const { columnId, title, description, assigneeId } = CardCreateSchema.parse(input)
  const board = await this.deps.board.get(boardId)
  await this.assertColumnOf(boardId, columnId)
  if (assigneeId !== null) await this.assertMember(assigneeId)
  // …
}

/** The column a card goes to is one of its board's: asked to the column module, a read. */
private async assertColumnOf(boardId: string, columnId: string): Promise<void> {
  const columns = await this.deps.column.list(boardId)
  if (!columns.some(column => column.id === columnId)) throw new ColumnNotInBoard(columnId, boardId)
}

/** The assignee belongs to the workspace now: asked to auth, through the member module, every time (ch. 20). */
private async assertMember(userId: string): Promise<void> {
  if (!await this.deps.member.isMember(userId)) throw new AssigneeNotMember(userId)
}
```

The column is checked against the module that owns it. The assignee is checked
against auth, through two steps:

1. `member.isMember` asks the `Workspaces` port, for the current workspace.
2. The port, wired when the contexts open, asks auth's `access.check`.

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
/** Whether someone belongs to the current workspace. */
@UseCase()
async isMember(userId: string): Promise<boolean> {
  return this.deps.workspaces.isMember(currentWorkspaceId(), userId)
}
```

```ts
// cooper/backend/open-contexts.ts
isMember: async (workspaceId, userId) => (await access.check(userId, WORKSPACES_PRODUCT, workspaceId)) !== null,
```

It is asked **every time**, never cached in the card or the actor. Someone removed
from a workspace a second ago can't get a card assigned.

A reference that doesn't exist is the request's mistake. Both errors are
`ValidationError`s, a 400:

```ts
// cooper/backend/contexts/boards/modules/card/errors/assignee-not-member.ts
/** A card is assigned only to someone of its workspace: the request named anyone else. */
export class AssigneeNotMember extends ValidationError {
  readonly code = 'card.assignee_not_member'
  constructor(userId: string) {
    super(`${userId} is not a member of this workspace: a card is assigned to one of its members`)
  }
}
```

`null` means "nobody": `create` doesn't ask anything then.

## When the other side goes away: a worker cleans up

Two things can disappear under a card: its column, and its assignee's membership.

The column module can't fix the cards: it doesn't know they exist. And even if it
did, writing to `card` from a request would break the write rule
([chapter 17](./17-modules-talk)). So `card` **listens** to the column's `removed`
event, from a worker:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
// A card points at its column: when a column goes, no card is left in it.
deps.column.events.removed.subscribe(column => cards.leaveRemovedColumn(column), {
  strategy: 'handler',
  queue: 'card.leaveRemovedColumn.on.column.removed',
})
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * A column was removed: any card still in it goes to the bottom of the board's
 * first column. What a worker calls (ch. 20.3); the second time, there are none.
 */
@UseCase()
async leaveRemovedColumn(column: ColumnDTO): Promise<void> {
  await runInWorkspace(column.workspaceId, async () => {
    const left = await this.repo.inColumn(column.id)
    if (left.length === 0) return
    const [first] = await this.deps.column.list(column.boardId)
    if (!first) return
    const bottom = await this.repo.count({ columnId: first.id })
    left.forEach((card, index) => card.moveTo(first.id, bottom + index))
    await this.repo.persistOrder(left, [column.id, first.id])
  })
}
```

`card.removeColumn` only removes empty columns, so this usually finds nothing. It is
there for the card someone moved into the column at the very moment it was removed.

The assignee works the same way, across contexts. auth tells when someone loses
their access, and `card` unassigns them:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
// auth took someone's access to a workspace: their cards there are left unassigned.
// auth tells every access it takes away, to any product: only a workspace's is boards'.
deps.access.revoked.subscribe(async access => {
  if (access.productId === WORKSPACES_PRODUCT && access.tenantId !== null) await cards.unassignMember(access.tenantId, access.userId)
}, {
  strategy: 'handler',
  queue: 'card.unassignMember.on.access.revoked',
})
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
@UseCase()
async unassignMember(workspaceId: string, userId: string): Promise<void> {
  await runInWorkspace(workspaceId, async () => {
    const cards = await this.repo.find({ assigneeId: userId })
    for (const card of cards) card.unassign()
    await this.repo.persist(...cards)
  })
}
```

Notice two details in both:

- **They look for the cards when they run**, not before. The event only says which
  column went, or who left. The cards are read at that moment, so none that changed
  in between slips through.
- **They can run again.** The second time, there are no cards in the removed column,
  and none assigned to whoever left. Nothing happens.

A worker runs outside any request, so it has no workspace scope. It enters one with
`runInWorkspace`, which trusts the id: the event already says which workspace it is.

## When showing: compose, don't join

A screen wants "Plan the launch · Bob", not `assigneeId: "0190…"`. You never JOIN
auth's users to boards' cards. You **compose**: read each side from its owner, and
put them together.

`workspace.members` composes two reads of auth, the accesses to the workspace and
the users they are for:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
@UseCase()
async members(): Promise<WorkspaceMemberDTO[]> {
  const accesses = await everything(page => this.deps.auth.access.listForTenant(currentWorkspaceId(), page))
  const users = new Map((await this.deps.auth.user.getMany(accesses.map(access => access.userId))).map(user => [user.id, user]))
  return accesses.flatMap(access => {
    const user = users.get(access.userId)
    return user ? [{ id: user.id, name: user.name, email: user.email, isAdmin: access.role === 'admin' }] : []
  })
}
```

One `getMany` with every id, never one call per access. And the MCP server puts the
cards and the members together to show each assignee by name:

```ts
// cooper/backend/contexts/boards/mcp/mcp-tools.ts
/** A card as the assistant reads it: its assignee by name too. */
function cardOf(card: CardDTO, members: WorkspaceMemberDTO[]) {
  const assignee = members.find(member => member.id === card.assigneeId)
  return {
    // …
    assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
  }
}
```

boards' web app does the same in the browser: it asks for the board and the members,
and joins them itself. Members of a workspace are few, so this is the simplest way,
and it is enough almost always.

If you had to search or list by a name that lives in another module, at scale, you
would keep a **read model**: a table a worker fills from the events of both sides,
shaped for that screen ([chapter 22](./22-backoffice) shows the analytics side of this).

## What you accept

Between `assign` checking the member and saving the card, auth could remove that
person. Or the worker that unassigns them could take a moment to run. For that
moment, a card points at someone who is no longer a member.

**You accept it.** It is the price of each module owning its own data, and it is
small: the `access.revoked` event arrives, the worker runs, and the card is left
unassigned. The code that reads an assignee later doesn't trust it blindly either:
`notifyAssignee` asks `member.find` again, and sends nothing if the person is gone.

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
const member = await this.deps.member.find(card.workspaceId, card.assigneeId)
if (!member) return
```

## How to check it

The card's own test checks the assignee, with the fake auth:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('assigns a card only to a member of its workspace, and tells them by email once saved', async () => {
  const plan = await create('Plan')

  await expect(inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'carl' }))).rejects.toMatchObject({ code: 'card.assignee_not_member' })
  // …
})
```

The workspace's test removes a column with a card still in it, as if one had been
moved in at that moment, and waits for the worker:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
// As if a card were moved into it while it was being removed: the column goes with a card in it.
await inAcme(() => t.modules.column.remove(todo.id))
await t.settled()

const view = await inAcme(() => t.modules.workspace.boardView(board.id))
expect(view.columns.map(column => column.name)).toEqual(['Doing', 'Done'])
```

And cooper's end-to-end test removes Bob from Acme on the real auth, and checks his
card is unassigned a moment later:

```ts
// cooper/backend/cooper.test.ts
expect((await call(ana.as, 'DELETE', `/workspaces/${acme.id}/members/${bob.id}`)).status).toBe(204)
expect((await call(bob.as, 'GET', `/workspaces/${acme.id}/boards`)).status).toBe(404)
await settled()

expect((await call<{ assigneeId: string | null }>(ana.as, 'GET', `/workspaces/${acme.id}/cards/${card.id}`)).body.assigneeId).toBeNull()
```

```bash
bun test cooper/backend
```

## In short

- A module points at another's data **by id**. No entity inside, no copied names,
  no JOINs.
- **When writing**, check the reference with a read of its owner, every time. A
  missing one is a 400.
- **When it goes away**, the module that points at it listens to the event and
  cleans up from a worker. It reads what to fix when it runs, and can run again.
- **When showing**, compose reads (one `getMany`, not one call each). A read model
  only when you must search across modules at scale.
- For a moment, a reference may point at nothing. You accept it.
