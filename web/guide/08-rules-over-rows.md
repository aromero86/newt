# Rules over several rows

A version protects **one row** (chapter [7](./07-concurrency)). Some rules speak about
**several**:

- A board's name is unique in its workspace, whatever its case.
- A board has at most 10 columns.
- A workspace has one admin, and only one.
- An email belongs to one account.

None of them can be checked by looking at the row being saved. This chapter shows how
newt checks them, the same way in every store.

## What a check before saving misses

A board has 9 columns. Ana and Bob each add one at the same moment. Each use case
counts first: "9 columns, there is room". Both pass, both save, and the board has 11.

```text
Ana   counts the columns: 9
Bob   counts the columns: 9
Ana   saves her column     → 10
Bob   saves his column     → 11  ✗
```

No version helps: the two new columns are new rows, and neither touches the other. The
check before saving is not enough, because someone can slip in between checking and
saving.

## Checking inside the save, and saying what it protects

`save`, the raw save behind `persist`, takes three options that act **inside its
transaction**:

- **`guard`** says **what** the save protects, with keys you choose
  (`columns:<board id>`);
- **`before`** does what must go first;
- **`after`** runs once the entities are written: it checks the rule and, if it does
  not hold, throws an error that **rolls everything back**.

The store's promise is this: **two saves with the same key never interleave**. One
waits for the other to commit or roll back, and only then starts writing and checking.
What `after` reads is the truth, and stays so until it commits.

This is how a column is added:

```ts
// cooper/backend/contexts/boards/modules/column/column.repository.ts
/**
 * Saves a new column at the end of its board, only if the board is left with no more
 * than `MAX_COLUMNS`: a rule over several rows, which no version covers (ch. 10). The
 * save guards its board's columns: its place is read before writing it, and the
 * columns counted after, with no other column of the board added, moved or removed
 * in between, in any store. Ten added at once to a board of five: five get in.
 */
async persistAdded(column: Column): Promise<void> {
  const { boardId } = column
  await this.save([column], each => this.write(each), {
    guard: [`columns:${boardId}`],
    before: async () => column.place(await this.count({ boardId })),
    after: async () => {
      if (await this.count({ boardId }) > MAX_COLUMNS) throw new TooManyColumns(boardId)
    },
  })
}
```

`this.write` is the write `TableRepository` already has. The key is per board, not one
for every column: two people adding columns to the same board take turns, but two
boards never wait for each other. The same key guards `persistOrder` (chapter
[6](./06-transactions)), so a move and an add on one board never interleave either.

`before` gives the new column its place: the end of the board, read where no other
column can be added in between.

```ts
// cooper/backend/contexts/boards/modules/column/column.ts
/** A new one takes its place as it is saved: the end of its board, read where no other column can be added in between. */
place(position: number): void {
  if (!this.isNew) throw new Error(`Column ${this.id} is placed once, as it is added`)
  this.change({ position })
  this.trackEvent(new Column_Added(this.toDTO()))
}
```

The use case still counts first. That gives a clear answer in the usual case, without
opening a transaction:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
/** A new column, at the end of the board: a board has at most `MAX_COLUMNS`. */
@UseCase()
async add(boardId: string, input: ColumnAddDTO): Promise<ColumnDTO> {
  const { name } = ColumnAddSchema.parse(input)
  await this.deps.board.get(boardId)
  const count = await this.repo.count({ boardId })
  // For a clear answer in the usual case: the save counts again, where nothing slips in.
  if (count >= MAX_COLUMNS) throw new TooManyColumns(boardId)
  const column = Column.add({ workspaceId: currentWorkspaceId(), boardId, name, position: count })
  await this.repo.persistAdded(column)
  return column.toDTO()
}
```

The error is a `ConflictError` (409), not a `ConcurrencyConflict`: the use case does
not run again, because trying again would not make room.

```ts
// cooper/backend/contexts/boards/modules/column/errors/too-many-columns.ts
export class TooManyColumns extends ConflictError {
  readonly code = 'column.too_many'
  // …
}
```

Now the story ends well:

```text
Ana   transaction: writes, counts 10 ≤ 10 ✓, commits
Bob   (waits for the key columns:<board>)
Bob   transaction: writes, counts 11 > 10 ✗, rolls back → column.too_many
```

### Check it

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
test('lets in only the columns that fit, when many are added at once', async () => {
  for (let i = 1; i <= 5; i++) await add(`Step ${i}`)

  const added = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => add(`More ${i}`)))

  expect(added.filter(each => each.status === 'fulfilled')).toHaveLength(5)
  for (const each of added.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'column.too_many' })
  expect((await names()).map(name => Number(name.split(':')[0]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
})
```

Eight columns added at once to a board of five: five get in, three are refused, and
the positions run 0 to 9 without a gap.

## Why say it, if SQLite already takes turns

Because **not every store is the same**, and your modules should not know which one
they run on:

| Store | Without `guard` | With `guard` |
|---|---|---|
| Files, SQLite | Transactions already run one at a time. | The same: the key is already protected. |
| Postgres, MySQL | Transactions run side by side: two `after`s could count before the other commits. | A lock per key: saves with the same key take turns. |

Declaring the `guard` costs a line, and makes the rule hold in any store. Moving
`boards` from SQLite to Postgres (chapter [26](./26-production)) does not make you
review anything.

So a save with `after` **must** say its `guard`: without it, it does not compile. If
the `after` checks no rule over rows (it only writes what follows from the save),
write `guard: []`, and whoever reads it knows none is needed.

Postgres and MySQL run in `READ COMMITTED` (MySQL's store sets it on each
transaction). You do not need to ask for anything stricter.

## Unique names, whatever the case

A board's name is the same rule, with a count in place of a limit. The guard key is
the name in lower case, so *Roadmap* and *ROADMAP* take turns, and the `after` counts
with `ieq`, which ignores case:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
/**
 * Saves a board only if no other one of its workspace has its name, whatever the
 * case: counted again after writing it, in its transaction, guarding the name in
 * lower case, so no other save of that name slips in between. `Roadmap` and
 * `ROADMAP` created at once cannot both have it (ch. 10).
 */
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

`count` sees only the current workspace (the repository's scope, chapter
[5](./05-who-and-where)) and only boards not archived (`softDelete`), so the name of
an archived board is free again. Both `create` and `update` save through it, so a
rename cannot take a name either.

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
test('gives a name to one board of a workspace, whatever its case; another workspace has its own', async () => {
  await create('Roadmap')

  await expect(create('ROADMAP')).rejects.toMatchObject({ code: 'board.name_taken' })
  expect((await t.as('bea', 'globex', () => t.modules.board.create({ name: 'roadmap' }))).workspaceId).toBe('globex')

  const bugs = await create('Bugs')
  await expect(inAcme(() => t.modules.board.update(bugs.id, { name: 'roadMAP' }))).rejects.toMatchObject({ code: 'board.name_taken' })
  // …
})
```

An account's email is the same rule in auth, and it shows something more: the table
has **no unique index** on the email at all. The rule lives only in the save, so it
holds the same way in any store:

```ts
// cooper/backend/contexts/auth/modules/user/user.repository.ts
/**
 * Saves an account only if no other one has its email: checked after the write, in
 * its transaction, guarding that email, so two people signing up with it at once
 * cannot both get it. Emails are kept in lower case, so this is whatever the case
 * they were typed in. Any store keeps this rule the same way, with no unique index.
 */
async persistWithEmailFree(user: User): Promise<void> {
  await this.save([user], each => this.write(each), {
    guard: [`userEmail:${user.email}`],
    after: async () => {
      if (await this.count({ email: user.email }) > 1) throw new EmailTaken()
    },
  })
}
```

```sql
-- cooper/backend/contexts/auth/migrations/00001_user_up.sql
-- The accounts. An email belongs to one account: the user module checks it after each
-- save, in its transaction (a rule over rows any store can keep), so this index only
-- finds an account by its email quickly. Emails are kept in lower case.
CREATE INDEX user_email ON "user" (email);
```

```ts
// cooper/backend/contexts/auth/auth.test.ts
const atOnce = await Promise.allSettled([signUp('Bob', 'bob@cooper.test'), signUp('Bob', 'BOB@cooper.test')])
expect(atOnce.map(each => each.status).sort()).toEqual(['fulfilled', 'rejected'])
```

## One admin per workspace

In auth, a workspace has a single admin: the person who made it. Accesses are rows of
`access`, one per member, with a `role`. "One admin at most" is a count over the
workspace's rows:

```ts
// cooper/backend/contexts/auth/modules/access/access.repository.ts
/**
 * Saves accesses keeping every tenant they touch with one admin at most: checked
 * after the writes, in their transaction, guarding each tenant's admin, so two
 * saves giving a tenant an admin at once cannot both succeed.
 */
async persistKeepingOneAdmin(...accesses: Access[]): Promise<void> {
  const tenants = [...new Set(accesses.map(access => access.tenantId).filter(tenantId => tenantId !== null))]
  await this.save(accesses, access => this.write(access), {
    guard: tenants.map(tenantId => `tenantAdmin:${tenantId}`),
    after: async () => {
      for (const tenantId of tenants) {
        if (await this.count({ tenantId, role: 'admin' }) > 1) throw new TenantHasAdmin(tenantId)
      }
    },
  })
}
```

One save can touch several workspaces, so it guards one key per workspace, and checks
each one. A staff access to the backoffice has no workspace (`tenantId` is null), and
guards nothing.

"Never less than one" is the other half, and it needs no guard: an admin's access is
never revoked, so nothing can take the count to zero.

```ts
// cooper/backend/contexts/auth/modules/access/access.module.ts
const access = await this.resolve(() => this.repo.find({ userId, productId, tenantId }), () => new AccessNotFound())
if (access.role === 'admin') throw new AdminNotRevocable()
access.revoke()
await this.repo.persist(access)
```

```ts
// cooper/backend/contexts/auth/auth.test.ts
test('keeps one admin, who is never removed; a member may be removed or leave', async () => {
  const [ana, bob, cai] = [await signUp('Ana'), await signUp('Bob'), await signUp('Cai')]
  const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))

  await expect(modules().access.admit({ userId: bob.id, productId: 'cooper', tenantId: acme.id, role: 'admin' })).rejects.toMatchObject({ code: 'access.tenant_has_admin' })
  await expect(as(ana, () => modules().access.revoke({ userId: ana.id, productId: 'cooper', tenantId: acme.id }))).rejects.toMatchObject({ code: 'access.admin_not_revocable' })
  // …
})
```

## The version and the guard

Keep the split in mind:

- **The version protects one row**: nobody overwrites an entity someone else changed
  (chapter [7](./07-concurrency)).
- **The `guard` protects a rule over several rows**: nobody slips in between your
  write and your check.

**In practice**: check first in the use case, for a clear answer in the usual case,
and **check again in `after`**, which is the guarantee.

## In short

- A rule over several rows cannot be checked before saving alone: someone may slip in
  between.
- Check it in the save's `after`, which rolls everything back by throwing.
- Name what it protects in `guard`, with a key as narrow as the rule (per board, per
  workspace, per name). Saves with the same key never interleave, in any store.
- A save with `after` must say its `guard`; `guard: []` when it checks no rule.
- `before` reads what the new row needs (its place at the end) where nothing slips in.
- Keep the check before saving too: it gives the clear error in the usual case.
