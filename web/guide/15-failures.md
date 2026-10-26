# When something fails

A worker calls a use case, and the use case throws: the mail server is down, the
database is locked, a bug. This chapter shows what newt does then: how it retries,
when it gives up, what a dead job is and how to bring it back. And what is not a
failure at all.

## Retries, waiting longer each time

If the use case a `'handler'` calls throws, its job goes back to the queue and runs
again later. Each time it waits twice as long: 10 seconds, 20, 40, 80… up to 15
minutes between two runs. These are the worker's defaults:

```ts
// packages/newt/runtime/jobs/job-queue.ts
const DEFAULTS: JobQueueOptions = {
  concurrency: 10,
  pollMs: 5_000,
  leaseMs: 60_000,
  backoffMs: 10_000,
  maxBackoffMs: 15 * 60_000,
  keepDoneMs: 7 * 24 * 60 * 60_000,
  seenEveryMs: 60_000,
}

const DEFAULT_ATTEMPTS = 5
```

```ts
// packages/newt/runtime/jobs/job-queue.ts
private backoff(attempts: number): number {
  return Math.min(this.options.backoffMs * 2 ** (attempts - 1), this.options.maxBackoffMs)
}
```

By default a job has 5 attempts. One that always fails waits 10 + 20 + 40 + 80
seconds between them, and dies about two and a half minutes after its first failure.
A short outage of a mail server already kills it.

For a job that must survive longer, raise its `attempts`. cooper does it for one job:
the step of a workspace's deletion that clears boards:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.workers.ts
deps.tenants.deleted.subscribe(tenant => workspace.purge(tenant.id), {
  strategy: 'handler',
  queue: 'workspace.purge.on.tenant.deleted',
  // The workspace is gone in auth already: a purge that keeps failing must not die soon.
  attempts: 10,
})
```

With 10 attempts the waits are 10 s, 20 s, 40 s, 80 s, 160 s, 320 s, 640 s and then
15 minutes twice: it keeps trying for about 50 minutes. The reason is in the comment.
By the time this job runs, the workspace is already gone in auth. If it dies, boards
keeps rows of a workspace nobody can see, and nothing else will ever remove them.

For a whole context, the base takes the worker's options, `jobs.backoffMs` and
`jobs.maxBackoffMs` among them:

```ts
// packages/newt/runtime/base-options.ts
/** How its worker runs the jobs of `handler` subscriptions. */
jobs?: Partial<JobQueueOptions>
```

cooper keeps the defaults.

## A worker that dies mid-job

While it runs, a job belongs to its worker for a lease of one minute, which the
worker renews every twenty seconds. If the worker dies (the process is killed, the
machine stops), nobody renews it. A minute later the job is free, and another worker,
or the same process once it is back, takes it.

Each claim counts as an attempt. A job whose worker died on every attempt it had is
not run again: it dies, with a message that says why.

```ts
// packages/newt/runtime/jobs/job-queue.ts
// Its worker stopped mid-run on every attempt it had: running it again would not help.
if (claimed.attempts > registration.attempts) return this.close(claimed, { status: 'dead', lastError: claimed.lastError ?? 'Its worker stopped before it finished, on every attempt' })
```

## Dead jobs

A job that runs out of attempts is **dead**, with its last error noted. It is not
deleted: someone has to look at it.

```ts
// packages/newt/runtime/jobs/job-queue.ts
try {
  await detached(() => inWorker.run(true, () => registration.handler(JSON.parse(claimed.event) as DomainEvent)))
  await this.close(claimed, { status: 'done', lastError: null })
} catch (error) {
  const lastError = error instanceof Error ? error.stack ?? error.message : String(error)
  await (claimed.attempts >= registration.attempts
    ? this.close(claimed, { status: 'dead', lastError })
    : this.close(claimed, { status: 'pending', lastError, runAfter: this.later(this.backoff(claimed.attempts)) }))
}
```

Jobs done are history: they are kept a week and then purged. Dead ones stay until
someone deals with them.

The store's outbox gives you what you need to look after them:

```ts
// packages/newt/port-outbox/outbox.ts
/**
 * Puts a dead job back to wait, as new: no attempts, due now. For whoever fixed
 * what killed it. Whether it was dead and is now waiting: a job in any other state,
 * or none with that id, is left as it is.
 */
retry(id: string): Promise<boolean>
// …
/** Every job it keeps, oldest first: for whoever looks after them (an admin page, a test). */
list(): Promise<Job[]>
```

Each job says its `queue`, its `status` (`pending`, `running`, `done` or `dead`),
how many `attempts` it made, its `lastError`, and the `event` it reacts to, as JSON.
You reach them through a context's base: `auth.base.store.outbox`. boards' tests use
`list` to check that every job finished:

```ts
// cooper/backend/contexts/boards/testing/fake-auth.ts
/** The jobs of its events, as they stand: to see one that failed. */
jobs() {
  return this.base.store.outbox.list()
}
```

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done', 'done'])
```

A dead job is not one more log line. It means something concrete: a reaction that did
not happen. A welcome board that was not created, an email that did not leave, a
workspace whose boards were not removed. The way out is always the same: find what
killed it in `lastError`, fix the cause, and call `retry(id)`. The job runs again from
scratch, which is safe because it is [idempotent](./13-repeatable-workers).

::: tip
cooper has no screen for dead jobs yet. In an application of yours, the staff's
console is a good place for one: a list of the dead jobs of each context, with their
error and a button that calls `retry`.
:::

## An event's shape only grows

A job keeps its event exactly as it was published, and it may run after a deploy,
with the new code. So the use case that runs it has to understand events written by
the old code:

> An event's shape only grows: you may add optional fields, but never remove,
> rename or change the meaning of one.

`card.assigned` carries `{ dto, previousAssigneeId }`. You may add a field, if the
code that reads it copes with its absence. You may not rename `previousAssigneeId`:
the jobs pending at the moment of the deploy would carry the old name. If you truly
need to break the shape, the same deploy brings a migration that rewrites the
pending jobs of that event.

The same goes for queue names: the [reacting chapter](./11-reacting) showed what
happens to the jobs of a renamed queue.

## What is not an error

Not everything that does not go ahead is a failure. Look at how cooper's workers end
when there is nothing to do:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.module.ts
const invitation = await this.repo.first({ id: invitationId })
if (!invitation?.isOpen()) return
const [tenant] = await this.deps.tenant.getMany([invitation.tenantId])
if (!tenant) return
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
const member = await this.deps.member.find(card.workspaceId, card.assigneeId)
if (!member) return
```

An invitation that was revoked before its email left, a workspace deleted meanwhile,
an assignee who left: none of these is a failure of the system. They are answers.
The job did its work, which was to find there is nothing to do, and it ends `done`.

If `send` threw `InvitationNotOpen` instead, the job would run five times to get the
same answer five times, and then die, and someone would have to look at a dead job
that means nothing. So:

- **Return** when the world says there is nothing to do: a business "no".
- **Throw** when something failed and trying again later could work: the mail server,
  the database, a bug you will fix. Do not catch those in the worker: let newt retry.

That is why a worker uses `first` and returns, where a use case called by a person
uses `resolve` and throws `CardNotFound`: the person needs the 404; the worker does
not.

## In short

- A job that fails runs again: 5 attempts by default, waiting 10 s, 20 s, 40 s…
  up to 15 minutes. Raise `attempts` for what must not die soon.
- A job is its worker's for a one-minute lease, renewed while it runs. A dead worker's
  jobs are taken by another a minute later.
- A job out of attempts is dead, with its last error. Dead jobs stay until someone
  fixes the cause and calls `outbox.retry(id)`.
- A dead job is a reaction that did not happen. Watch them.
- An event's shape only grows: pending jobs carry the old one.
- Return on a business "no"; throw on a failure, and let newt retry it.
