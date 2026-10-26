# The irreversible leaves from a worker

An email cannot be unsent. A payment is not undone by a rollback. cooper sends two
kinds of email: the invitation to join a workspace, and the notice that a card is
yours. Both leave the same way, and this chapter shows why.

## The rule

> What cannot be undone leaves from a worker, after the event of what it is about.
> Never from the use case that makes the change.

Picture `invitation.create` sending the email itself, and then failing to save the
invitation (a conflict, a full disk, a bug two lines further down). The transaction
rolls back: there is no invitation. But the email has left, with a link that opens
nothing. From a worker, the email leaves only once the invitation is saved, because
the job is saved with it.

## The assignment email

You have seen it already. `card.assign` saves the assignment, which tells
`card.assigned`. The job of `card.notifyAssignee.on.card.assigned` was saved in the
same transaction. Then the worker calls `notifyAssignee`, which sends the email:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
@UseCase()
async notifyAssignee(card: CardDTO): Promise<void> {
  if (card.assigneeId === null) return
  const current = await runInWorkspace(card.workspaceId, () => this.repo.first({ id: card.id }))
  if (current?.assigneeId !== card.assigneeId) return
  const member = await this.deps.member.find(card.workspaceId, card.assigneeId)
  if (!member) return
  const link = new URL(`/workspaces/${card.workspaceId}/boards/${card.boardId}?card=${card.number}`, this.options.publicUrl)
  await this.options.mailer.send({
    to: member.email,
    subject: `#${card.number} ${card.title} is yours`,
    text: [`Hi ${member.name},`, '', `Card #${card.number}, "${card.title}", is assigned to you.`, '', link.toString()].join('\n'),
  })
}
```

The use case `assign` knows nothing about email. The worker that sends it knows
nothing about assigning. And the mailer comes as an option of the module: the console
in development, a list in tests, an email service in production. Its type says the
rule too:

```ts
// cooper/backend/shared/mail/mailer.ts
/**
 * Whatever sends an email: the console in development, a list in a test, an SMTP
 * server or an email API in production. A module sends one only from a worker, once
 * what it tells is saved: an email cannot be taken back.
 */
export type Mailer = {
  send(mail: Mail): Promise<void>
}
```

## The invitation email

An invitation is more delicate, because its email carries a secret: the token in its
link. Whoever has the link can accept the invitation (after signing in with the
invited email).

The admin invites; `invitation.create` checks and saves the invitation, and returns.
It sends nothing:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.module.ts
/** The workspace's admin invites an email, which is not a member nor invited already. Its email leaves from a worker. */
@UseCase()
async create(tenantId: string, input: InvitationCreateDTO): Promise<InvitationDTO> {
  const email = Email.from(InvitationCreateSchema.parse(input).email)
  await this.assertAdmin(tenantId)
  const invited = await this.deps.user.findByEmail(email)
  const member = invited ? await this.deps.access.check(invited.id, this.options.productId, tenantId) : null
  if (member || await this.repo.count({ tenantId, email, status: 'pending' }) > 0) throw new AlreadyInvited(email)

  const invitation = Invitation.create({ tenantId, email, invitedBy: currentActor().userId, days: this.options.days })
  await this.repo.persist(invitation)
  return invitation.contract()
}
```

Its worker sends it:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.workers.ts
/**
 * An invitation's email leaves once it is saved, from a job: an email cannot be taken
 * back, so it never leaves for an invitation that rolled back. And a deleted
 * workspace's invitations stop opening it.
 */
export function registerInvitationWorkers(invitations: Invitation_Module, deps: Invitation_Deps): void {
  invitations.events.created.subscribe(invitation => invitations.send(invitation.id), {
    strategy: 'handler',
    queue: 'invitation.send.on.invitation.created',
  })
  // …
}
```

### The token is made when the email leaves

Notice what the callback passes: the invitation's id, not a token. The invitation has
no token yet when it is created:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.ts
/** The invitation as it is kept: what anyone sees, and the hash of its link's token. */
const InvitationEntitySchema = InvitationSchema.extend({
  /** Null until its email leaves: the token is made when it is sent, and only its hash kept. */
  tokenHash: z.string().nullable(),
})
```

Why not make the token in `create` and put it in the event? Because the job keeps the
event as it was published, in the outbox, in the database. A token in the event would
be a secret stored in plain text, readable by anyone who can read the jobs, and kept
there for a week after the job is done. newt says it in the subscription's
documentation:

```ts
// packages/newt/core/events/subscribe-options.ts
/**
 * …
 *   The payload is stored: an event that carries a secret cannot use it. The handler
 *   may run more than once, so it must be idempotent.
 */
```

So the worker makes the token, at the moment of sending, and the store keeps only its
hash:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.module.ts
/**
 * Sends its email, with a new token for its link: what its worker calls once it is
 * saved, since an email cannot be taken back. The token is made here, not when it
 * was created, so it is never kept in a job: the store only ever has its hash. Run
 * again, it sends a new link, and the one before stops working.
 */
@UseCase()
async send(invitationId: string): Promise<void> {
  const invitation = await this.repo.first({ id: invitationId })
  if (!invitation?.isOpen()) return
  const [tenant] = await this.deps.tenant.getMany([invitation.tenantId])
  if (!tenant) return
  const inviter = await this.deps.user.get(invitation.invitedBy)

  const token = invitation.issueToken()
  await this.repo.persist(invitation)
  await this.options.mailer.send({
    to: invitation.email,
    subject: `${inviter.name} invited you to ${tenant.name} on Cooper`,
    text: [
      `${inviter.name} invited you to join the workspace ${tenant.name} on Cooper.`,
      '',
      `Accept the invitation: ${this.options.acceptUrl(token)}`,
      '',
      `Sign in, or sign up, with ${invitation.email} to accept it. It expires on ${invitation.expiresAt.slice(0, 10)}.`,
    ].join('\n'),
  })
}
```

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.ts
/**
 * A new token for its link, which only the email will carry: the one before, if
 * any, stops working. The store keeps its hash.
 */
issueToken(): SecretToken {
  const token = SecretToken.generate()
  this.change({ tokenHash: SecretToken.hash(token) })
  return token
}
```

Read `send` in order, and ask what happens if it stops at each line:

- **The invitation is not open any more** (revoked, accepted, expired) or its
  workspace is gone: there is nothing to send. It returns; it does not throw.
- **It stops after saving the hash, before the email leaves.** The job runs again,
  makes another token, saves its hash, and sends that one. The first token never left
  the process.
- **The mailer fails.** It throws, the job runs again later, with a new token.
- **The email left, but the job was not marked done.** It runs again, and the person
  gets a second email with a new link. The first link stops working, because only the
  last hash is kept.

The hash is saved before the email leaves, never after. The other way round, an
email could leave with a link whose hash was never saved: a link that opens nothing.

## Twice is acceptable; never is not

An email can arrive twice, rarely: when the server stops right after sending it. For
both of cooper's emails that is acceptable. A second "card #12 is yours" does no harm;
a second invitation replaces the first link, and the newest email works.

If it were not acceptable (a payment), the worker would note what it did, with a
reference that identifies the operation, before doing it again: the second technique
of the [previous chapter](./13-repeatable-workers). Many payment services take such a
reference (an idempotency key) for this reason.

## Check it

The auth tests check that no email leaves before the worker runs, and that one leaves
after:

```ts
// cooper/backend/contexts/auth/auth.test.ts
const invitation = await as(ana, () => modules().invitation.create(acme.id, { email: 'BOB@cooper.test' }))
expect(invitation).toMatchObject({ email: 'bob@cooper.test', status: 'pending' })
expect(mails).toEqual([])
await settled()
expect(mails.map(mail => [mail.to, mail.subject])).toEqual([['bob@cooper.test', 'Ana invited you to Acme on Cooper']])
```

And they run the job again on purpose, as if it had stopped after the email left:

```ts
// cooper/backend/contexts/auth/auth.test.ts
test('send a new link when their email is sent again, and the one before stops working', async () => {
  const ana = await signUp('Ana')
  const acme = await as(ana, () => modules().tenant.create({ name: 'Acme' }))
  const invitation = await as(ana, () => modules().invitation.create(acme.id, { email: 'bob@cooper.test' }))
  await settled()
  const first = linkToken()

  // As its job run again after the email left: a new link, which is the only one that works.
  await modules().invitation.send(invitation.id)
  const second = linkToken()
  expect(second).not.toBe(first)
  await expect(modules().invitation.review(first)).rejects.toMatchObject({ code: 'invitation.not_found' })
  expect(await modules().invitation.review(second)).toMatchObject({ open: true })
})
```

In development, invite someone from the app and look at the server's console: the
console mailer prints the email, link included.

## In short

- What cannot be undone (an email, a payment) leaves from a worker, after the event of
  what it is about. Never from the use case that makes the change.
- The use case saves; the worker sends. Neither knows about the other.
- A job keeps its event in the database: never put a secret in an event. Make it in
  the worker, when it is used, and keep only its hash.
- Save before you send: a link must never leave before what it opens is saved.
- An email may arrive twice. If twice is not acceptable, note the operation with a
  reference before repeating it.
