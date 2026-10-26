# Modules that talk

boards has five modules: `member`, `board`, `column`, `card` and `workspace`. A card
needs its board and its column to exist. A new workspace needs a board, three
columns and a card. Modules need each other all the time. This chapter is about how
they talk without stepping on each other's data.

## Two ways to talk

A module talks to another in two ways, and only two:

| Way | When | In cooper |
|---|---|---|
| **Call a use case** | You need the answer **now**: reads and checks. | `card.create` asks `column.list` whether the column is on the board. |
| **Listen to an event** | Something is a **consequence** of something else. | A removed column makes `card` move the cards left in it. |

Reading from another module is always fine, from anywhere. Writing to another module
has a rule:

> A module writes to another **only from a worker** that reacts to an event.

## Why writes go through a worker

Each module saves in **its own transaction**. Look at `workspace.prepare`, which
gives a new workspace its welcome board. It writes to three modules: it creates a
board, then the columns, then a card.

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

Imagine a request ran this. The board is saved, then the server restarts before the
columns. The request already got its error, and nothing runs it again: the workspace
keeps a board with no columns forever.

So nothing calls `prepare` from a request. A worker calls it when auth tells that a
workspace was created:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.workers.ts
deps.tenants.created.subscribe(tenant => workspace.prepare(tenant.id), {
  strategy: 'handler',
  queue: 'workspace.prepare.on.tenant.created',
})
```

If `prepare` fails halfway, its job **runs again** until it finishes. Each step
looks for what an earlier run did first, so running it again is harmless
([chapter 13](./13-repeatable-workers)).

| Writing to another module from… | If it fails halfway… |
|---|---|
| a use case outside a worker (a request, a script, a test) | it stays halfway, and nobody finishes it |
| a use case a worker called | its job runs again until it finishes |

That is why whatever a worker writes to another module must be safe to repeat.

## newt checks the rule for you

You don't have to remember the rule: newt checks it while the app runs. Call
`workspace.prepare` from a test, outside a worker, and the first save to `board`
fails:

```
Error: [write rule] workspace.prepare writes to boards.board outside a worker: write it from a worker reacting to an event, or list it in its writesTo
```

What newt does when it finds one is the base's `writeRule` option:

| `writeRule` | What it does | For |
|---|---|---|
| `'error'` | Throws: the save does not happen. The default. | Always. |
| `'warn'` | A console warning, once per use case and module it writes to. | An app moving to the rule. |
| `'off'` | Nothing. | Almost never. |

cooper keeps the default. Its bases are built without the option:

```ts
// cooper/backend/contexts/boards/boards.context.ts
const base = new BoardsBase({ name: 'boards', store })
```

Because the default is an error, a write in the wrong place breaks a test instead of
hiding in a warning.

## When breaking the rule is right: `writesTo`

Sometimes a use case must write to another module in the same request, and the risk
is worth it. Then you say so **where it is seen**, in the use case, with the reason
next to it.

Removing a column is cooper's case. A column may be removed only when no card is in
it. But the `column` module knows nothing about cards: `card` depends on `column`
(a card points at its column), so `column` cannot ask `card` without the two
depending on each other. The module that can answer "is it empty?" is `card`. So
`card` owns the use case, and has `column` remove it:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * Removes a column of a board, only if no card is in it. The cards answer, since a
 * card points at its column and a column knows nothing of the cards: the column
 * module cannot ask them without the two needing each other (ch. 19). So this use
 * case asks, and has the column module remove it: a write to another module outside
 * a worker, said where it is seen. It is the only write it makes, so a failure leaves
 * nothing halfway; a card moved into the column at that very moment is taken to
 * another one by `leaveRemovedColumn`.
 */
@UseCase({ writesTo: ['column'] })
async removeColumn(columnId: string): Promise<void> {
  const column = await this.deps.column.get(columnId)
  const cards = await this.repo.count({ columnId })
  if (cards > 0) throw new ColumnNotEmpty(columnId, cards)
  await this.deps.column.remove(column.id)
}
```

Read the comment as the checklist for any `writesTo`:

- **Why it can't be a worker.** The person waits for the answer: "removed" or
  "not empty". A worker would answer later.
- **Why it is safe.** It is the only write the use case makes. If it fails, nothing
  was saved. There is no "halfway".
- **What is left over, and who fixes it.** A card moved into the column at that very
  moment ends up in a removed column. A worker of `card` moves it out
  ([chapter 18](./18-references)).

The route lives with the cards, because the cards decide:

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
// A column is removed by the cards, which know whether it is empty.
workspace.delete('/columns/:columnId', async request => {
  await cards.removeColumn(request.params.columnId)
  return new Response(null, { status: 204 })
})
```

And `column.remove` says in its own comment that it is not the one the API calls:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
/**
 * Removes a column, and the ones to its right move one place left. Whether it is
 * empty is not known here, where cards are not: `card.removeColumn` asks the cards
 * first, and is what the API calls. A card left in it anyway (moved in at that very
 * moment) is taken to another column by a worker of the cards.
 */
@UseCase()
async remove(id: string): Promise<void> {
  // …
}
```

`writesTo` counts for everything written **below** the use case, whoever calls it.
If another use case called `card.removeColumn`, the column would still be removed;
that caller only declares what it writes itself.

auth has three more, each with its reason in the code:

- `tenant.create` writes to `access`: whoever makes a workspace must be able to
  enter it the moment the answer arrives. If the second save fails, the worker of
  `tenant.created` gives the admin anyway (`ensureAdmin`).
- `session.signUp` writes to `user`: the person waits for their account and their
  session in one answer.
- `token.exchange` writes to `oauthGrant`: the client waits for its tokens in this
  answer ([chapter 20](./20-oauth-server)).

::: warning
`writesTo` is not a way to silence the error. Each one is a decision with a reason,
written next to it. If you can't write the reason, use a worker.
:::

## The dependencies: `.deps.ts`

A module declares the modules it knows in its `.deps.ts` file. Each entry says why
it needs it:

```ts
// cooper/backend/contexts/boards/modules/card/card.deps.ts
export interface Card_Deps {
  /** That a card's board exists, in the current workspace. */
  board: Board_Module
  /** That a card's column exists, and is of its board; and where cards left in a removed column go. */
  column: Column_Module
  /** That a card's assignee belongs to its workspace, and where to write to them. */
  member: Member_Module
  access: AccessEvents
}
```

The context creates the modules **in order**, each one after those it uses:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
const board = Board_Module.initialize(base, { member })
const column = Column_Module.initialize(base, { board, member })
const card = Card_Module.initialize(base, { board, column, member, access: deps.access }, { mailer: deps.mailer, publicUrl: config.publicUrl })
const { tenant, access, invitation, user } = deps.auth
const workspace = Workspace_Module.initialize(base, { board, column, card, member, tenants: deps.tenants, auth: { tenant, access, invitation, user } })
```

boards' dependencies form no circle:

| Module | Uses |
|---|---|
| `member` | nothing of boards (the `Workspaces` port) |
| `board` | `member` |
| `column` | `board`, `member` |
| `card` | `board`, `column`, `member` (and the `AccessEvents` port) |
| `workspace` | `board`, `column`, `card`, `member` (and auth) |

`workspace` sits at the top: it puts the others to work. Nothing depends on it.

## Ports: a dependency in your own words

Two entries above are not modules. `member` gets `workspaces`, and `card` gets
`access`. Both are **ports**: a type the module declares, in its own words, for
something it needs from outside its context.

```ts
// cooper/backend/contexts/boards/modules/member/member.deps.ts
/**
 * What `boards` needs to know of the workspaces, and asks whoever keeps them (auth's
 * tenants and access): a port, in boards' own words, so this module depends on no
 * module of auth. The context is handed one when it opens; a test, a fake.
 */
export type Workspaces = {
  /** Whether someone belongs to a workspace now: asked each time, so who leaves counts at once. */
  isMember(workspaceId: string, userId: string): Promise<boolean>
  /** Someone of a workspace, or null if they do not belong to it. */
  member(workspaceId: string, userId: string): Promise<MemberDTO | null>
}
```

```ts
// cooper/backend/contexts/boards/modules/card/card.deps.ts
/**
 * auth's events the cards react to, as a port: what boards needs of them, in its own
 * words. auth's emitters fit it; a test hands its own.
 */
export type AccessEvents = {
  revoked: Pick<DomainEventEmitter<{ userId: string, productId: string, tenantId: string | null }>, 'subscribe'>
}
```

A port gives you two things:

- **boards says what it needs, not how auth works.** auth has tenants, products and
  accesses. boards only asks "is this person a member of this workspace?".
- **Tests hand a fake.** boards' own tests open it with `FakeAuth`, which keeps the
  members in a map and publishes the same events. No auth needed.

Whoever opens the context wires the port to the real thing. You will see that in
[chapter 19](./19-several-contexts).

## How to check it

boards' tests cover the column removal, through the use case and through the API:

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

```bash
bun test cooper/backend/contexts/boards
```

## In short

- A module talks to another by **calling its use cases** (reads, checks) or
  **listening to its events** (consequences). Never through its repository, tables
  or entity.
- **Read from anyone; write to another module only from a worker.** newt checks it
  (`writeRule: 'error'` by default).
- A `writesTo` is a decision, written where it is seen, with its reason: why it can't
  wait, why it is safe, and who fixes what is left.
- Each module lists what it knows in its `.deps.ts`. **Dependencies never form a
  circle**: if two modules seem to need each other, one stops calling and starts
  listening, or the one that knows takes the use case (`card.removeColumn`).
- **A module doesn't know who depends on it.** `column` doesn't know about cards.
- What a module needs from outside its context is a **port**, in its own words.
