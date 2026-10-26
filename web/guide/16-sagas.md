# Failing halfway: deleting a workspace

Deleting a workspace touches everything. In auth: the workspace, its members'
accesses, its pending invitations. In boards: every board, column and card it has,
and each card's activity. Two contexts, two databases. No transaction can hold all of
it, and any step can fail. This chapter shows how cooper deletes a workspace so that,
whatever fails and wherever, it always ends deleted.

## Several transactions, gaps between them

Deleting a workspace is a flow of steps, each in its own transaction:

1. auth marks the workspace deleted.
2. auth takes away every access to it.
3. auth revokes its pending invitations.
4. boards removes its cards, columns and boards.
5. boards removes its cards' activity.

Between any two steps, the server can stop, a step can fail, a conflict can come.
For a while the data does not add up: a deleted workspace whose boards are still
there, or whose invitations are still pending. You cannot put the steps in one
transaction: they are in two databases, and even within one, it would tie the modules
together ([modules that talk](./17-modules-talk)). What you do is make sure the flow
always reaches its end.

A flow of steps across modules, each in its own transaction, is a **saga**.

## The first two steps: the request

The admin deletes the workspace through boards' route, which calls auth's use case:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.routes.ts
workspace.delete('', async request => {
  await tenant.delete(request.params.workspaceId)
  return noContent()
})
```

The request does the first step, and the second one right after it:

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

The workspace is deleted softly: its row stays, marked, and no use case finds it any
more. That save tells `tenant.deleted`, and with it go the jobs of every step that
follows.

Then the request takes the accesses away itself, in a second transaction. Why not
leave that to a worker too? Ask the question of [eventual
consistency](./12-eventual-consistency): does the person need it now? Here the answer
is yes, the other way round: from the moment the admin sees "deleted", nobody may
enter the workspace, its admin neither, and no access to it should be left. So the
accesses go in the request, and the worker is only the fallback. A use case that
writes to another module outside a worker says so with `writesTo`, and `retryOnConflict: false` stops it from running again on a conflict:
the second run would find the workspace deleted and answer 404 to a deletion that
worked.

The second save can still fail after the first one committed, and between the two
saves, for a few milliseconds, the accesses are still there. They let nobody in:
boards lets someone into a workspace only if auth has an access for them *and* the
workspace is still there ([several contexts](./19-several-contexts)):

```ts
// cooper/backend/open-contexts.ts
// A deleted tenant is not among them.
const exists = async (workspaceId: string) => (await tenant.getMany([workspaceId])).length > 0
// An access and a tenant still there: a deleted workspace's accesses go a moment
// after it (or, should that fail, from its worker), and nobody enters it meanwhile.
const isMember = async (workspaceId: string, userId: string) => {
  const [granted, alive] = await Promise.all([access.check(userId, WORKSPACES_PRODUCT, workspaceId), exists(workspaceId)])
  return granted !== null && alive
}
```

So the step keeps its worker too, as a fallback for a second save that failed. The
event says what it starts:

```ts
// cooper/backend/contexts/auth/modules/tenant/events/tenant-deleted.ts
/**
 * A workspace was deleted: the start of a saga. auth revokes its invitations, and
 * takes every access to it away once more (`delete` already did, in the request);
 * boards deletes its boards. Each from a worker.
 */
export class Tenant_Deleted implements DomainEvent<TenantDTO> {
  static readonly eventName = 'tenant.deleted'
  // …
}
```

## The other steps: workers

Four modules subscribe to `tenant.deleted`. Their four jobs are saved in the same
transaction as the deletion, in auth's store:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.workers.ts
// A step of its deletion: nobody enters it any more.
tenants.events.deleted.subscribe(tenant => tenants.removeAccesses(tenant.id), {
  strategy: 'handler',
  queue: 'tenant.removeAccesses.on.tenant.deleted',
})
```

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.workers.ts
deps.tenant.events.deleted.subscribe(tenant => invitations.revokeForTenant(tenant.id), {
  strategy: 'handler',
  queue: 'invitation.revokeForTenant.on.tenant.deleted',
})
```

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.workers.ts
deps.tenants.deleted.subscribe(tenant => workspace.purge(tenant.id), {
  strategy: 'handler',
  queue: 'workspace.purge.on.tenant.deleted',
  // The workspace is gone in auth already: a purge that keeps failing must not die soon.
  attempts: 10,
})
```

```ts
// cooper/backend/contexts/boards/modules/activity/activity.workers.ts
// auth deleted a workspace: its log goes, like its boards (a job of auth's outbox).
deps.tenants.deleted.subscribe(tenant => activity.purgeWorkspace(tenant.id), {
  strategy: 'handler',
  queue: 'activity.purgeWorkspace.on.tenant.deleted',
})
```

Each one calls a use case that is safe to run again.

In auth, the accesses go once more. Usually the request took them all and this run
finds none; it matters when the request stopped before its second save:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
/**
 * A deleted workspace's accesses go: a step of its deletion, from a worker, in case
 * `delete` stopped halfway or someone entered it meanwhile. Safe to run again.
 */
@UseCase()
async removeAccesses(tenantId: string): Promise<void> {
  await this.deps.access.revokeTenant(tenantId)
}
```

```ts
// cooper/backend/contexts/auth/modules/access/access.module.ts
/**
 * A tenant is gone: nobody enters it any more, its admin neither. What its deletion
 * calls, and its worker after it; safe to run again.
 */
@UseCase()
async revokeTenant(tenantId: string): Promise<void> {
  const accesses = await this.repo.find({ tenantId })
  for (const access of accesses) access.revoke()
  await this.repo.persist(...accesses)
}
```

The pending invitations are revoked:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.module.ts
/** A deleted workspace's invitations open nothing: a step of its deletion, from a worker. Safe to run again. */
@UseCase()
async revokeForTenant(tenantId: string): Promise<void> {
  const pending = await this.repo.find({ tenantId, status: 'pending' })
  for (const invitation of pending) invitation.revoke()
  await this.repo.persist(...pending)
}
```

In boards, everything of the workspace goes, children first:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.module.ts
/**
 * auth deleted a workspace: its cards, columns and boards go, in that order. boards'
 * step of that deletion: it cannot be undone, nor needs to be; a worker
 * runs it until it completes, and each part removes what is left, so running it
 * again after a failure halfway converges on a workspace with nothing.
 */
@UseCase()
async purge(workspaceId: string): Promise<void> {
  await this.deps.card.purgeWorkspace(workspaceId)
  await this.deps.column.purgeWorkspace(workspaceId)
  await this.deps.board.purgeWorkspace(workspaceId)
}
```

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/** Removes every card of a workspace, and its boards' counters, for good: auth deleted it (see `Board_Repository.purgeWorkspace`). */
async purgeWorkspace(workspaceId: string): Promise<void> {
  await this.saveRows(async () => {
    await this.base.db.deleteFrom('card').where('workspaceId', '=', workspaceId).execute()
    await this.base.db.deleteFrom('card_counter').where('workspaceId', '=', workspaceId).execute()
  })
}
```

These rows go for good, with `saveRows`: they tell nothing. Nobody needs a
`card.deleted` for each card of a workspace that no longer exists. The workspace is
named, not taken from the scope: nobody is in it any more. The activity log goes the
same way, in its own step.

And one step leads to another. Each access revoked tells `access.revoked`, and boards
reacts to it as it does when someone leaves a workspace: `card.unassignMember` runs
for each member. Here it usually finds nothing, because the cards are gone or about to
go. Whichever runs first, the end is the same.

```text
tenant.delete (request) ─┬─ saves the deletion ── tenant.deleted ─┬─▶ tenant.removeAccesses (fallback)
                         │                                         ├─▶ invitation.revokeForTenant
                         │                                         ├─▶ workspace.purge (boards: cards, columns, boards)
                         │                                         └─▶ activity.purgeWorkspace (boards)
                         └─ access.revokeTenant ── access.revoked (each) ──▶ card.unassignMember
```

## Converging: repeating until done

Picture `workspace.purge` failing after removing the cards, before the columns. The
cards are gone; the columns and boards are still there. Its job runs again:

- `card.purgeWorkspace` deletes every card of the workspace. There are none. Fine.
- `column.purgeWorkspace` deletes the columns.
- `board.purgeWorkspace` deletes the boards.

The gap closes by itself. This is called **converging**: wherever it fails, running
the work again always leads to the same end. It works because of two things at once:

- **Each step can be repeated without harm.** Each one writes a result ("this
  workspace has no cards"), not a change ([workers that can run
  again](./13-repeatable-workers)).
- **The work is repeated until it is done.** Each step is a job, saved with the
  deletion, and retried when it fails ([when something fails](./15-failures)).

Take either away and the flow can stay halfway forever. A step done only from the
request would be lost if it failed, because nothing runs it again. That is why the
accesses, taken in the request, still have their worker. A step that is not safe to
repeat would break on its retry.

And if the attempts run out? The job dies, and that means something concrete: **a
flow stuck halfway**, a deleted workspace whose boards are still in boards. That is
why `workspace.purge` gets 10 attempts, and why someone has to watch dead jobs, fix
the cause and retry them, from the backoffice's Jobs page.

## Compensations: when another path stops the flow

Deleting a workspace only goes forward. Once auth marks it deleted, nothing brings it
back, so no step ever needs undoing: each one only has to complete.

Other flows can be stopped halfway by something else. Picture an order that reserves
stock and then gets cancelled by the customer: the stock has to come back. Undoing a
step that was already saved is not a rollback, since its transaction committed long
ago. It is another step that does the opposite: a **compensation**. It runs from a
worker, on the event that stops the flow, and like any step it must be safe to
repeat, and safe to run even if the step it undoes never happened.

cooper has no flow that needs one. If yours does, give each step its compensation,
and make both find each other by a reference that identifies the operation (the
order's id, for instance).

## The races

While a saga runs, requests and other jobs keep coming. Each case below lands in a
gap, and this is what cooper does about it:

| What happens | How it ends |
|---|---|
| Someone lists their workspaces right after the deletion. | Their access went with the request. Should that second save have failed, the workspace is gone anyway: `workspace.mine` (and auth's `tenant.listForUser`) leave it out until the worker takes the access. |
| A member opens a board, or creates a card, between the two saves of the request. | boards asks auth for the access and for the workspace: the workspace is already deleted, so they are not a member, and nothing is created after `workspace.purge`. |
| Someone accepts an invitation to the workspace before `invitation.revokeForTenant` runs. | `invitation.accept` checks the workspace first: a deleted one makes the invitation not open (`invitation.not_open`), and no access is given. |
| An invitation's email job runs after the workspace was deleted. | `invitation.send` finds no workspace and returns: no email leaves. |
| The welcome board's job (`workspace.prepare`) runs after the workspace was deleted, or while it is. | It asks auth whether the workspace exists: if not, it writes nothing; if it went while it ran, it purges what it wrote. |
| `card.unassignMember` runs before or after `workspace.purge`. | Before: it unassigns cards that are then removed. After: it finds no card. Either way the cards are gone. |
| The admin deletes the workspace twice (a retried request, two tabs). | The second time, the workspace is not found: `tenant.delete` answers 404, and no second saga starts. |

The invitation row is a check made at the right place. Revoking the invitations is a
worker's step, so for a moment a deleted workspace still has pending ones. Instead of
hoping nobody accepts one in that moment, `accept` asks for the workspace:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.module.ts
@UseCase({ writesTo: ['access'] })
async accept(token: string): Promise<InvitationDTO> {
  const invitation = await this.byToken(token)
  // Its workspace deleted, it is not open any more, whatever its worker did yet.
  const [tenant] = await this.deps.tenant.getMany([invitation.tenantId])
  if (!invitation.isOpen() || !tenant) throw new InvitationNotOpen()
  // …
}
```

::: tip
The check that lets someone in is where a gap between two saves closes. Had boards
asked only for the access, a member could still enter between the deletion and the
accesses (longer, if the second save failed and its worker had not run yet), and a
board created then, after `workspace.purge`, would stay in boards for good. Asking
for the workspace too costs one more read, and leaves no such gap.
:::

## The four rules

When a flow crosses modules or contexts:

1. **Each step can be repeated without harm.** It writes a result, or finds by a
   reference what an earlier run did.
2. **The steps go forward from workers**, which repeat them until they are done. A
   step the person needs at once may run in the request too, but keeps its worker: from
   a request alone, a failure halfway would stay halfway.
3. **If another path can stop the flow, each step has its compensation**: another
   step, from a worker, on the event that stops it. It can be repeated, and it can
   run even if the step it undoes never happened.
4. **A dead job is a stuck flow.** Watch them: someone has to look at them.

## Check it

boards' tests delete a workspace, check that everything of it is gone and nothing of
another one, and then run the whole deletion again, as after a failure halfway:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
test('removes all a workspace has once auth deletes it, and nothing of any other', async () => {
  await t.auth.createWorkspace('acme', 'ana')
  await t.auth.createWorkspace('globex', 'bea')
  await t.settled()

  await t.auth.deleteWorkspace('acme')
  await t.settled()

  expect(await t.modules.board.listOf('acme', { size: 10 })).toMatchObject({ items: [], total: 0 })
  expect(await t.modules.card.countByWorkspace(['acme', 'globex'])).toEqual([{ workspaceId: 'acme', cards: 0 }, { workspaceId: 'globex', cards: 1 }])
  expect((await t.modules.board.listOf('globex', { size: 10 })).total).toBe(1)

  // Its work run again, as after a failure halfway: nothing left to remove, nothing fails.
  await t.auth.deleteWorkspace('acme')
  await t.settled()
  // Each deletion is heard twice: the workspace's purge, and its activity's.
  expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done'])
  expect((await t.modules.board.listOf('globex', { size: 10 })).total).toBe(1)
})
```

auth's tests check its side. With its worker stopped, nobody is let in the moment
the deletion answers, and an invitation cannot be accepted:

```ts
// cooper/backend/contexts/auth/auth.test.ts
test('lets nobody in once deleted, before its workers run', async () => {
  const [ana, bob] = [await signUp('Ana'), await signUp('Bob')]
  const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
  await as(ana, () => modules().access.grant({ userId: bob.id, productId: 'cooper', tenantId: acme.id }))
  await settled()
  await auth.base.jobs.stop()

  await as(ana, () => modules().tenant.delete(acme.id))
  expect(await modules().access.check(bob.id, 'cooper', acme.id)).toBeNull()
  expect(await modules().access.check(ana.id, 'cooper', acme.id)).toBeNull()
  // …
})
```

```ts
// cooper/backend/contexts/auth/auth.test.ts
test('cannot be accepted once their workspace is deleted, before its workers run', async () => {
  // …
  await auth.base.jobs.stop()

  await as(ana, () => modules().tenant.delete(acme.id))
  await expect(as(bob, () => modules().invitation.accept(token))).rejects.toMatchObject({ code: 'invitation.not_open' })
  await settled()
  expect(await modules().access.check(bob.id, 'cooper', acme.id)).toBeNull()
})
```

And cooper's end-to-end test does it all through HTTP, with both contexts:

```ts
// cooper/backend/cooper.test.ts
expect((await call(ana.as, 'DELETE', `/workspaces/${acme.id}`)).status).toBe(204)
await settled()

expect(await contexts.boards.modules.board.listOf(acme.id, { size: 10 })).toMatchObject({ items: [], total: 0 })
expect(await contexts.boards.modules.card.countByWorkspace([acme.id])).toEqual([{ workspaceId: acme.id, cards: 0 }])
expect((await call(ana.as, 'GET', '/workspaces')).body).toEqual([])
expect((await call(bob.as, 'GET', `/workspaces/${acme.id}/boards`)).status).toBe(404)
```

## In short

- A flow across modules or contexts is a saga: steps, each in its own transaction.
- The request does the first step and tells an event; workers do the rest. A step
  the person needs at once can run in the request too, with a worker behind it.
- It converges when each step is safe to repeat and is repeated until done.
- What only goes forward needs no compensation; what another path can stop needs one
  for each step.
- Look for the races: a request or a late job can land in any gap between two steps.
  Close them with a check where it matters, not with hope.
- A dead job is a flow stuck halfway.
