# Failing halfway: deleting a workspace

Deleting a workspace touches everything. In auth: the workspace, its members'
accesses, its pending invitations. In boards: every board, column and card it has.
Two contexts, two databases. No transaction can hold all of it, and any step can
fail. This chapter shows how cooper deletes a workspace so that, whatever fails and
wherever, it always ends deleted.

## Several transactions, gaps between them

Deleting a workspace is a flow of steps, each in its own transaction:

1. auth marks the workspace deleted.
2. auth takes away every access to it.
3. auth revokes its pending invitations.
4. boards removes its cards, columns and boards.

Between any two steps, the server can stop, a step can fail, a conflict can come.
For a while the data does not add up: a deleted workspace whose members still have
access, or whose boards are still there. You cannot put the steps in one transaction:
they are in two databases, and even within one, it would tie the modules together
([modules that talk](./17-modules-talk)). What you do is make sure the flow always
reaches its end.

A flow of steps across modules, each in its own transaction, is a **saga**.

## The first step: the request

The request does only the first step. The admin deletes the workspace through
boards' route, which calls auth's use case:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.routes.ts
workspace.delete('', async request => {
  await tenant.delete(request.params.workspaceId)
  return noContent()
})
```

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
/**
 * Only its admin deletes it. The rest follows from `tenant.deleted`, each part from
 * a worker: its accesses and invitations here, its boards in boards.
 */
@UseCase()
async delete(tenantId: string): Promise<void> {
  await this.assertAdmin(tenantId)
  const tenant = await this.load(tenantId)
  tenant.delete()
  await this.repo.persist(tenant)
}
```

The workspace is deleted softly: its row stays, marked, and no use case finds it any
more. The event says what it starts:

```ts
// cooper/backend/contexts/auth/modules/tenant/events/tenant-deleted.ts
/**
 * A workspace was deleted: the start of a saga. auth takes every access to it away
 * and revokes its invitations; boards deletes its boards. Each from a worker.
 */
export class Tenant_Deleted implements DomainEvent<TenantDTO> {
  static readonly eventName = 'tenant.deleted'
  // …
}
```

The request writes in one module, the tenant's, and answers `204`. Everything else
starts from that event.

## The other steps: workers

Three modules subscribe to `tenant.deleted`. Their three jobs are saved in the same
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

Each one calls a use case that is safe to run again.

In auth, the accesses go:

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.module.ts
/** A deleted workspace's accesses go: a step of its deletion, from a worker. Safe to run again. */
@UseCase()
async removeAccesses(tenantId: string): Promise<void> {
  await this.deps.access.revokeTenant(tenantId)
}
```

```ts
// cooper/backend/contexts/auth/modules/access/access.module.ts
/**
 * A tenant is gone: nobody enters it any more, its admin neither. What a worker
 * calls, a step of the tenant's deletion; safe to run again.
 */
@UseCase()
async revokeTenant(tenantId: string): Promise<void> {
  const accesses = await this.repo.find({ tenantId })
  for (const access of accesses) access.revoke()
  await this.repo.persist(...accesses)
}
```

And so do the pending invitations:

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
 * step of that deletion (ch. 18): it cannot be undone, nor needs to be; a worker
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
/** Removes every card of a workspace for good: auth deleted it (see `Board_Repository.purgeWorkspace`). */
async purgeWorkspace(workspaceId: string): Promise<void> {
  await this.saveRows(async () => {
    await this.base.db.deleteFrom('card').where('workspaceId', '=', workspaceId).execute()
  })
}
```

These rows go for good, with `saveRows`: they tell nothing. Nobody needs a
`card.deleted` for each card of a workspace that no longer exists. The workspace is
named, not taken from the scope: nobody is in it any more.

And one step leads to another. Each access revoked tells `access.revoked`, and boards
reacts to it as it does when someone leaves a workspace: `card.unassignMember` runs
for each member. Here it usually finds nothing, because the cards are gone or about to
go. Whichever runs first, the end is the same.

```text
tenant.delete (request) ── tenant.deleted ─┬─▶ tenant.removeAccesses ── access.revoked (each) ──▶ card.unassignMember
                                           ├─▶ invitation.revokeForTenant
                                           └─▶ workspace.purge (boards: cards, columns, boards)
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

Take either away and the flow can stay halfway forever. A step done from the request
would be lost if it failed, because nothing runs it again. A step that is not safe to
repeat would break on its retry.

And if the attempts run out? The job dies, and that means something concrete: **a
flow stuck halfway**, a deleted workspace whose boards are still in boards. That is
why `workspace.purge` gets 10 attempts, and why someone has to watch dead jobs, fix
the cause and call `outbox.retry(id)`.

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

While a saga runs, requests keep coming. Each case below is a request that lands in a
gap, and what cooper does about it:

| What happens | How it ends |
|---|---|
| Someone lists their workspaces after the deletion, before their access is removed. | The access still points at the workspace, but the workspace is gone: `workspace.mine` (and auth's `tenant.listForUser`) leave it out. |
| An invitation's email job runs after the workspace was deleted. | `invitation.send` finds no workspace and returns: no email leaves. |
| `card.unassignMember` runs before or after `workspace.purge`. | Before: it unassigns cards that are then removed. After: it finds no card. Either way the cards are gone. |
| The admin deletes the workspace twice (a retried request, two tabs). | The second time, the workspace is not found: `tenant.delete` answers 404, and no second saga starts. |

::: warning
There is a window cooper leaves open. Until `tenant.removeAccesses` runs, a member
still has an access, so boards still lets them in (`member.enter` asks auth for the
access, not for the workspace). A board or card created in that window, after
`workspace.purge` ran, would stay in boards. The window is short, a few milliseconds
in normal operation, but a saga's steps run in any order. To close it, the check that
lets someone in has to fail for a deleted workspace too.
:::

## The four rules

When a flow crosses modules or contexts:

1. **Each step can be repeated without harm.** It writes a result, or finds by a
   reference what an earlier run did.
2. **The steps go forward from workers**, which repeat them until they are done. From
   a request, a failure halfway would stay halfway.
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
  expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done', 'done'])
  expect((await t.modules.board.listOf('globex', { size: 10 })).total).toBe(1)
})
```

auth's tests check its side: no access left, every member told, and nobody sees the
workspace any more:

```ts
// cooper/backend/contexts/auth/auth.test.ts
await as(ana, () => modules().tenant.delete(acme.id))
await expect(modules().tenant.get(acme.id)).rejects.toMatchObject({ code: 'tenant.not_found' })
await settled()

expect((await modules().access.listForTenant(acme.id, page)).total).toBe(0)
expect(told.sort()).toEqual([ana.id, bob.id].sort())
expect((await modules().tenant.listForUser(ana.id, page)).items).toEqual([])
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
- The request does the first step and tells an event; workers do the rest.
- It converges when each step is safe to repeat and is repeated until done.
- What only goes forward needs no compensation; what another path can stop needs one
  for each step.
- Look for the races: a request can land in any gap between two steps.
- A dead job is a flow stuck halfway.
