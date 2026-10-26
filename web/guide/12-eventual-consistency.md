# Eventual consistency: the welcome board

When someone creates a workspace in cooper, it should not open empty. It gets a
board called "Welcome", with three columns and a card that shows how things work.
The workspace belongs to auth; the board belongs to boards. This chapter follows
that board from the request that creates the workspace to the moment it appears, and
shows what the client sees in between.

## Two ways to be up to date

When the request that creates a workspace answers, one of two things can be true:

- **Immediate consistency**: the request creates the workspace and its welcome board,
  and only then answers. When the client gets the answer, everything is there.
- **Eventual consistency**: the request creates the workspace and answers. A worker
  creates the welcome board a moment later. During that moment, the workspace exists
  and has no board.

cooper does the second. Here it is not even a choice:

- **The workspace and the board are in different databases.** auth keeps its data in
  `data/cooper-auth.db`, boards in `data/cooper-boards.db`. No transaction holds both.
  Even within one store, doing it all at once would tie two modules together forever
  ([modules that talk](./17-modules-talk) explains the rule).
- **The request waits for nobody.** If preparing the board were slow, the person
  creating the workspace would not notice.
- **Nothing is lost.** If the server stops right after the workspace is saved, the job
  that prepares its board is saved with it, and runs when the server is back.

## The journey of a workspace

1. The client sends `POST /api/workspaces` to boards. The route calls auth's
   `tenant.create`.
2. auth saves the workspace in one transaction. With it, it saves the jobs of every
   `'handler'` subscribed to `tenant.created`: `tenant.ensureAdmin…` and
   `workspace.prepare…`.
3. auth saves the creator's admin access in a second transaction.
4. The route answers `201` with the workspace. The client has its answer.
5. auth's worker wakes up after the commit, claims `workspace.prepare.on.tenant.created`
   and calls boards' `workspace.prepare` with the workspace's id.
6. `prepare` checks the workspace is still there, then creates the board, its
   columns and its card, each in a short transaction of its own.
7. The client lists the workspace's boards again, and "Welcome" is there.

Each step that touches a store is a short transaction of its own. And every time one
of them leaves a job pending, the job is saved with it.

## The code

The route is boards', but the workspace is auth's: the route calls auth's use case
directly, as any client would ([several contexts](./19-several-contexts) explains why
that is allowed).

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.routes.ts
base.http.post('/workspaces', async request => {
  const created = await tenant.create(await request.json() as TenantCreateDTO)
  return Response.json(workspaceOf(created, currentActor().userId), { status: 201 })
})
```

auth's use case saves the workspace, which tells `tenant.created`:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
@UseCase({ writesTo: ['access'], retryOnConflict: false })
async create(input: TenantCreateDTO): Promise<TenantDTO> {
  const { name } = TenantCreateSchema.parse(input)
  const tenant = Tenant.create({ name, createdBy: currentActor().userId })
  await this.repo.persist(tenant)
  await this.admitAdmin(tenant.toDTO())
  return tenant.toDTO()
}
```

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.ts
static create(input: { name: string, createdBy: string }): Tenant {
  const tenant = new Tenant(input, true)
  tenant.trackEvent(new Tenant_Created(tenant.toDTO()))
  return tenant
}
```

boards listens. Its workspace module subscribes on auth's emitter, so the job is
saved in auth's transaction:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.workers.ts
/**
 * boards follows auth's workspaces, a moment later: a new one gets its welcome board,
 * and a deleted one loses everything it had here. Each reaction is a job of auth's
 * worker, saved with the change that tells it, and run until it completes.
 */
export function registerWorkspaceWorkers(workspace: Workspace_Module, deps: Workspace_Deps): void {
  deps.tenants.created.subscribe(tenant => workspace.prepare(tenant.id), {
    strategy: 'handler',
    queue: 'workspace.prepare.on.tenant.created',
  })
  // …
}
```

And the worker calls the use case that prepares the board:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
/**
 * A new workspace gets its welcome board: "Welcome", with To do, Doing and Done, and
 * a first card. A worker calls it once auth created the workspace (eventual
 * consistency: for a moment, the workspace has no board), and it writes in three
 * modules, which only a worker may: if it fails halfway, its job runs it again.
 * Each step looks for what an earlier run did first, so a second run only finishes
 * what the first left, and adds nothing to a finished one; two runs at once add
 * each column and the card once, since their saves look again.
 *
 * A workspace auth deleted meanwhile gets nothing: its job may run late, after the
 * workspace's purge. One deleted while it runs has what it wrote purged again.
 */
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

`prepare` writes in three modules: board, column and card. A use case may do that
only from a worker. If it fails halfway, its job runs it again, and every step first
looks for what an earlier run left. That is the subject of the
[next chapter](./13-repeatable-workers).

Look at the two `exists` checks, before and after. A job runs a moment after its
event, and the world may have moved on by then. Someone can create a workspace and
delete it a second later: by the time `prepare` runs, the workspace is gone, and
boards may even have purged it already. Writing a welcome board then would leave a
board in a workspace that no longer exists, with nobody to ever remove it. So
`prepare` asks auth first, and does nothing for a deleted workspace. The workspace
can also go while `prepare` runs, after its purge was done: the second check purges
again what this run wrote. A worker that reacts late must ask whether what it reacts
to still holds.

## Immediate where it matters

Not everything about a new workspace waits. Its creator must be able to enter it the
moment the request answers, so `tenant.create` gives the admin access in the request
itself (that is the `writesTo: ['access']`, explained in [modules that
talk](./17-modules-talk)). Should that second save fail, a worker finishes it:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.workers.ts
// Its admin, in case the request that made it stopped before giving it.
tenants.events.created.subscribe(tenant => tenants.ensureAdmin(tenant), {
  strategy: 'handler',
  queue: 'tenant.ensureAdmin.on.tenant.created',
})
```

That is the question to ask for each piece: does the person need it to go on, right
now? The admin access, yes. The welcome board can come a moment later.

Deletion asks the same question. Once a workspace is deleted, nobody may enter it, its
admin neither, from the moment the request answers. So `tenant.delete` takes the
workspace's accesses away itself, right after saving the deletion, and its worker is
the fallback:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
@UseCase({ writesTo: ['access'], retryOnConflict: false })
async delete(tenantId: string): Promise<void> {
  await this.assertAdmin(tenantId)
  const tenant = await this.load(tenantId)
  tenant.delete()
  await this.repo.persist(tenant)
  await this.deps.access.revokeTenant(tenantId)
}
```

Its boards, its invitations, its activity log: nobody needs those gone right now, and
they go from workers, a moment later ([sagas](./16-sagas) follows that deletion).

## What the client sees, and how to design for it

With eventual consistency the client gets a workspace that has no board yet. cooper's
end-to-end test shows it, through boards' HTTP API:

```ts
// cooper/backend/cooper.test.ts
const created = await call<Workspace>(as, 'POST', '/workspaces', { name: 'Acme' })
expect(created).toMatchObject({ status: 201, body: { name: 'Acme', adminId: id, isAdmin: true } })
const acme = created.body
expect((await call(as, 'GET', '/workspaces')).body).toEqual([acme])
expect((await call(as, 'GET', `/workspaces/${acme.id}/boards`)).body).toMatchObject({ total: 0 })

await settled()
const welcome = await welcomeOf(as, acme.id)
expect(welcome.board.name).toBe('Welcome')
expect(welcome.columns.map(column => column.name)).toEqual(['To do', 'Doing', 'Done'])
```

The API is honest about it: the workspace is there, its admin is there, its boards are
not yet. Whoever builds a client on it has to count on that intermediate state:

- **Show it as it is.** An empty workspace for a moment is not an error.
- **Ask again** after a moment, or when the person comes back to the list. In cooper
  the board takes milliseconds.
- **Do not promise what has not happened yet.**

Deletion has its own short window. The workspace and its accesses are two saves, one
after the other. Between them, or if the second fails and its worker has not run yet,
an access still points at a workspace that is gone. Nobody gets in through it: being
a member asks for the access *and* for the tenant (chapter
[5](./05-who-and-where)). And the use case that lists someone's workspaces leaves
those out:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
// A workspace deleted while this read, or whose accesses its deletion failed to take away (its worker will), is left out.
return accesses.flatMap(access => {
  const tenant = tenants.get(access.tenantId ?? '')
  return tenant ? [workspaceOf(tenant, userId)] : []
})
```

Any data a worker keeps behaves like this. It is not a bug: it is eventual
consistency, and both the API and its clients are designed for it.

## What newt guarantees, and what it does not

| Guarantee | What it means |
|---|---|
| The job is saved with the change | If the workspace exists, its `workspace.prepare` job exists. Never one without the other. |
| It runs after the commit | A worker never sees a change that later rolled back. |
| It runs again if it fails | Waiting longer each time, until its attempts run out (5 by default). |
| It survives restarts | What was pending is still pending when the server is back. |
| At least once | A job can run **more than once**. |

The last row is the one that gives you work, and it has the next chapter to itself.

## What if the server stops?

Go through each moment of the journey:

- **It stops before auth commits the workspace.** There is no workspace and no job.
  The client gets an error and tries again.
- **It stops after the commit, before the worker runs.** When it is back, the pending
  job runs and the board is created.
- **It stops between the workspace and its admin access.** `tenant.ensureAdmin` was
  saved with the workspace, and gives the access when the server is back.
- **It stops halfway through `prepare`**, with the board created and one column. The
  job was not marked done, so it runs again, finds the board and the column, and adds
  only what is missing.
- **The workspace is deleted before the job runs**, or while it runs. `prepare` finds
  it gone and writes nothing, or purges what it wrote.

In no case is the workspace left without its board for good. The last case works only
because `prepare` is written to run again without harm.

## In short

- Eventual consistency: the request saves what it must and answers; a worker does the
  rest a moment later.
- Across contexts it is the only way: each context has its own store, and no
  transaction holds two.
- Give in the request only what the person needs to go on; everything else follows
  from an event.
- A worker runs late: it checks that what it reacts to still holds before writing.
- The API shows the intermediate state honestly, and the client is designed for it:
  show it, ask again, do not promise.
- newt guarantees the job is saved with the change and runs after the commit, again
  if it fails. It runs at least once, so maybe more.
