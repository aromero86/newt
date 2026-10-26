# Two people, one card

Ana and Bob open the same board. Ana drags card #1 to *Doing*; at the same moment Bob
drags it to *Done*. Both save. What is left?

Without protection, the second save would write over the first with what it read
before, and Ana's move would vanish without anyone knowing. Worse here: each move also
rewrote the positions of the cards around it, so the column could end up with two
cards in one place and a gap elsewhere. This chapter shows how newt stops that, and
when it must not try again on its own.

## The version

Every saved row has a **version** that goes up with each save that writes it. On
saving, the framework checks the row is still at the version that was read. If someone
saved it in between, the version no longer matches, and the save fails with a
**`ConcurrencyConflict`** (409) without writing anything.

```text
Ana   reads card #1 (version 3)
Bob   reads card #1 (version 3)
Ana   saves the move, if it is still at 3   → done, now version 4
Bob   saves the move, if it is still at 3   → ConcurrencyConflict: it is at 4
```

Nobody loses anything in silence. You do not write any of it: every row of a
`TableRepository` has its `version`, as the row types show.

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
export type CardRow = CardDTO & { version: number }
```

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
CREATE TABLE card (
  id TEXT PRIMARY KEY,
  -- …
  version INTEGER NOT NULL
);
```

## Trying again, on its own

Bob getting an error would be correct, but in most cases the sensible thing is to
**try again**: read the card again, now in *Doing*, move it to *Done*, and save. Every
use case does that without being asked. On a conflict it runs again **from the start**,
up to three more times.

Look at `card.move` again (chapter [6](./06-transactions)): it loads the card and its
columns, decides, and saves at the end. Run again, it loads the card as Ana left it.
Both moves happen, one after the other, and the columns have no gaps.

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
  // …
  await this.repo.persistOrder(target === left ? target : [...left, ...target], [from, columnId])
  return card.toDTO()
}
```

It works because a use case **loads, changes and saves, and does nothing irreversible
before saving**. What cannot be undone (an email) leaves from a worker, after the save
(chapter [14](./14-irreversible)). A use case that sent an email and then saved would
send it twice on a retry.

When a use case calls another, only **the first of the chain** runs again, with all it
calls. The inner one lets the conflict through to it, and runs again in each attempt
of the outer one. Otherwise the inner one would repeat what its caller then repeats
again.

### A conflict without a version

A version protects the rows that were read. A row that **did not exist** when the use
case read has no version to check. If Carla creates a card in *Doing* while Bob's move
renumbers that column, Bob's save does not touch Carla's card, and the column could
end up with two cards at the same position.

`persistOrder` covers it. After writing, inside the same transaction, it reads each
column it touched and checks the positions run 0, 1, 2… with no gap. If not, someone
slipped a card in, and it throws the same `ConcurrencyConflict`. The use case runs
again with the column as it is now:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/**
 * Saves cards in their new order, all of them or none (ch. 8.2): the one moved or
 * deleted, and the ones that took the places left, in each column it touches. Each
 * was read at a version, so a card someone else moved meanwhile makes it a
 * conflict, and the use case runs again with the columns as they are then (ch. 9).
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
        if (positions.some((position, index) => position !== index)) throw new ConcurrencyConflict()
      }
    },
  })
}
```

The `guard` makes sure no other save of those columns runs between the write and the
check. Chapter [8](./08-rules-over-rows) is about that pair.

### Check it

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
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
```

Both calls succeed. One of them ran twice, and the card ended where the second one
put it. The same holds for columns:

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
test('gives each of two moves at once its turn, and leaves no gap', async () => {
  const [todo, doing, done] = [await add('To do'), await add('Doing'), await add('Done')]

  await Promise.all([
    inAcme(() => t.modules.column.move(done.id, { position: 0 })),
    inAcme(() => t.modules.column.move(todo.id, { position: 2 })),
  ])

  const order = await names()
  expect(order.map(name => name.split(':')[0])).toEqual(['0', '1', '2'])
  // …
})
```

## When it must not try again

Some use cases do something before saving that must not happen twice: a call to
another context, or a save of their own that a second run would repeat. They say so
where it is seen, with the reason beside it: `retryOnConflict: false`. It holds for
the whole chain: no use case in it runs again, not the ones that called it either,
even from another context.

cooper has three, and each one has its reason.

**auth's `tenant.create`** saves the workspace, and then its admin's access. If that
second save hit a conflict and the use case ran again, it would create a **second
workspace**:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
/**
 * A new workspace, made by the signed-in person, who is its admin. It writes to
 * `access` without being a worker, on purpose: whoever makes a workspace enters it
 * the moment it answers. The workspace is saved first and its admin after; should
 * that second save fail, the worker of `tenant.created` (`ensureAdmin`) gives it.
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

`boards` calls it from its `POST /api/workspaces` route. The flag counts there too:
the call starts in auth, and auth says it must not repeat.

**auth's `token.exchange`** spends the authorization code (a save in `oauthGrant`)
before it saves the tokens. Run again, it would bring the same code a second time, and
a code brought twice looks **copied**: auth revokes every token it gave.

```ts
// cooper/backend/contexts/auth/modules/token/token.module.ts
/**
 * A client trades its code for tokens. It writes to `oauthGrant` without being a
 * worker, on purpose: the client waits for its tokens in this answer. The code is
 * spent first, then the tokens saved; should that fail, the client signs the person
 * in again. It never runs again on a conflict: the code it spent would look copied.
 */
@UseCase({ writesTo: ['oauthGrant'], retryOnConflict: false })
async exchange(input: TokenExchangeDTO): Promise<TokenPairDTO> {
  const { clientId, clientSecret, code, codeVerifier, redirectUri } = TokenExchangeSchema.parse(input)
  const client = await this.deps.oauthClient.authenticate(clientId, clientSecret)
  const grant = await this.deps.oauthGrant.redeem({ code, codeVerifier, clientId: client.clientId, redirectUri })

  const { token, pair } = Token.issue(grant, this.options)
  await this.repo.persist(token)
  return pair
}
```

That is what `redeem` does with a code it already redeemed:

```ts
// cooper/backend/contexts/auth/modules/oauth-grant/oauth-grant.module.ts
if (grant.status === 'redeemed') {
  grant.replay()
  await this.repo.persist(grant)
  throw new InvalidGrant()
}
```

**The web session's `complete`** (chapter [5](./05-who-and-where)) calls auth over
HTTP before it saves its session. The code is spent the moment auth answers: a second
run could only fail.

```ts
// cooper/backend/shared/web-session/web-session.module.ts
/**
 * auth sent the browser back: the code is traded for who signed in, and the
 * context's own session is opened. It calls auth over HTTP before saving, so it
 * never runs again on a conflict: the code is spent.
 */
@UseCase({ retryOnConflict: false })
async complete(input: { code?: string, state?: string, error?: string, errorDescription?: string, pending?: string }): Promise<{ token: SecretToken, returnTo: string }> {
  // …
  const tokens = await this.post('/oauth/token', { grant_type: 'authorization_code', code: input.code, redirect_uri: this.redirectUri(), code_verifier: pending.verifier })
  // …
  const { session, token } = WebSession.open(identity.userId, this.options.days)
  await this.repo.persist(session)
  return { token, returnTo: pending.returnTo }
}
```

::: tip
Before you write `retryOnConflict: false`, check whether the use case can be reordered
to save once, at the end. The flag is for what cannot.
:::

## New rows that collide

The same happens with new rows. A board's name is unique in its workspace, whatever
its case. If Ana and Bob both create *Roadmap* at the same moment, one of the two saves
must lose.

`board` has three defenses, and each one has its job.

The **unique index** is the guarantee when two arrive at once. In SQLite it is on the
name in lower case, and only for boards not archived:

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
-- A name is a workspace's once, whatever its case (A to Z, as `lower` and `ieq` compare).
CREATE UNIQUE INDEX board_name ON board (workspace_id, lower(name)) WHERE deleted_at IS NULL;
```

A new row that collides with a unique index is a `ConcurrencyConflict` too. A store
whose structure cannot say it (the files store) reads the same rule from the table's
`unique` option, but only for the exact value:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
super(base, base.store.table<BoardRow>('board', { unique: [['workspaceId', 'name']] }), {
```

The **check inside the save** covers the rest, in any store: *Roadmap* and *ROADMAP*
at once. `persistWithNameFree` counts the name again, whatever its case, after
writing, and guards the name in lower case so no other save of it slips in between:

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

Chapter [8](./08-rules-over-rows) explains it in full.

The **check before saving** gives a **clear error**, `board.name_taken`:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
@UseCase()
async create(input: BoardCreateDTO): Promise<BoardDTO> {
  const { name, description } = BoardCreateSchema.parse(input)
  await this.assertNameFree(BoardName.from(name))
  const board = Board.create({ workspaceId: currentWorkspaceId(), name, description })
  await this.repo.persistWithNameFree(board)
  return board.toDTO()
}

// …
/** For a clear answer in the usual case: the save checks it again, where nothing can slip in between. */
private async assertNameFree(name: BoardName, exceptId?: string): Promise<void> {
  if (await this.repo.count({ name: { ieq: name }, id: exceptId === undefined ? undefined : { ne: exceptId } }) > 0) throw new BoardNameTaken(name)
}
```

The previous check also matters for the retries. When the index refuses the second
save, the conflict runs `create` again; this time `assertNameFree` finds *Roadmap*
and answers `board.name_taken`, not a bare conflict. Without it, a repeated name would
be tried four times for nothing before returning the conflict: a collision with a
unique value is not fixed by trying again.

### Check it

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
test('gives a name to one of several boards created with it at once, whatever its case', async () => {
  const created = await Promise.allSettled(['Roadmap', 'ROADMAP', 'roadmap', 'RoadMap'].map(create))

  expect(created.filter(each => each.status === 'fulfilled')).toHaveLength(1)
  for (const each of created.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'board.name_taken' })
  expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(1)
})
```

## In short

- Every row has a version. Saving a row someone else saved since you read it is a
  `ConcurrencyConflict` (409), and nothing is written.
- A use case runs again on a conflict, from the start, up to three more times. Only the
  first of a chain does, with all it calls.
- So a use case loads, changes and saves at the end, and does nothing irreversible
  before saving.
- A row created meanwhile has no version: check the whole order inside the save, and
  throw `ConcurrencyConflict` if someone slipped in.
- `retryOnConflict: false`, with its reason beside it, for a use case that did
  something before saving that must not happen twice.
- A unique value has three defenses: the index (the guarantee), the check inside the
  save (any case, any store), and the check before (the clear error).
