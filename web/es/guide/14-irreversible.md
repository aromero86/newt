# Lo irreversible sale de un worker

Un email no se puede "desenviar". Un cobro no se deshace con un rollback. cooper envía
dos tipos de email: la invitación a unirse a un workspace y el aviso de que una
tarjeta es tuya. Los dos salen de la misma forma, y este capítulo cuenta por qué.

## La regla

> Lo que no se puede deshacer sale de un worker, después del evento de aquello de lo
> que trata. Nunca desde el caso de uso que hace el cambio.

Imagina que `invitation.create` enviara el email él mismo, y después fallara al
guardar la invitación (un conflicto, un disco lleno, un bug dos líneas más abajo). La
transacción se deshace: no hay invitación. Pero el email ya ha salido, con un enlace
que no abre nada. Desde un worker, el email solo sale cuando la invitación ya está
guardada, porque el job se guarda con ella.

## El email de asignación

Ya lo has visto. `card.assign` guarda la asignación, que cuenta `card.assigned`. El job
de `card.notifyAssignee.on.card.assigned` se guardó en la misma transacción. Después,
el worker llama a `notifyAssignee`, que envía el email:

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

El caso de uso `assign` no sabe nada de emails. El worker que lo envía no sabe nada de
asignar. Y el mailer llega como opción del módulo: la consola en desarrollo, una lista
en los tests, un servicio de email en producción. Su tipo también dice la regla:

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

## El email de invitación

Una invitación es más delicada, porque su email lleva un secreto: el token de su
enlace. Quien tenga el enlace puede aceptar la invitación (tras entrar con el email
invitado).

El admin invita; `invitation.create` comprueba y guarda la invitación, y responde. No
envía nada:

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

Lo envía su worker:

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

### El token se crea cuando sale el email

Fíjate en lo que pasa el callback: el id de la invitación, no un token. La invitación
no tiene token cuando se crea:

```ts
// cooper/backend/contexts/auth/modules/invitation/invitation.ts
/** The invitation as it is kept: what anyone sees, and the hash of its link's token. */
const InvitationEntitySchema = InvitationSchema.extend({
  /** Null until its email leaves: the token is made when it is sent, and only its hash kept. */
  tokenHash: z.string().nullable(),
})
```

¿Por qué no crear el token en `create` y meterlo en el evento? Porque el job guarda el
evento tal como se publicó, en el outbox, en la base de datos. Un token en el evento
sería un secreto guardado en claro, legible por cualquiera que pueda leer los jobs, y
que se quedaría ahí una semana después de terminar el job. newt lo dice en la
documentación de la suscripción:

```ts
// packages/newt/core/events/subscribe-options.ts
/**
 * …
 *   The payload is stored: an event that carries a secret cannot use it. The handler
 *   may run more than once, so it must be idempotent.
 */
```

Así que el token lo crea el worker, en el momento de enviar, y el store solo guarda su
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

Lee `send` en orden, y pregúntate qué pasa si se para en cada línea:

- **La invitación ya no está abierta** (revocada, aceptada, caducada) o su workspace
  ya no existe: no hay nada que enviar. Hace return; no lanza ningún error.
- **Se para tras guardar el hash, antes de que salga el email.** El job se repite,
  crea otro token, guarda su hash y envía ese. El primer token nunca salió del proceso.
- **Falla el mailer.** Lanza un error, y el job se repite más tarde, con un token nuevo.
- **El email salió, pero el job no se marcó como hecho.** Se repite, y la persona
  recibe un segundo email con un enlace nuevo. El primer enlace deja de funcionar,
  porque solo se guarda el último hash.

El hash se guarda antes de que salga el email, nunca después. Al revés, podría salir
un email con un enlace cuyo hash nunca se guardó: un enlace que no abre nada.

## Dos veces se acepta; ninguna, no

Un email puede llegar dos veces, rara vez: cuando el servidor se para justo después
de enviarlo. Para los dos emails de cooper es aceptable. Un segundo "la tarjeta #12 es
tuya" no hace daño; una segunda invitación sustituye al primer enlace, y funciona el
email más reciente.

Si no fuera aceptable (un cobro), el worker apuntaría lo que hizo, con una referencia
que identifica la operación, antes de repetirlo: la segunda técnica del [capítulo
anterior](./13-repeatable-workers). Muchos servicios de pago aceptan esa referencia
(una clave de idempotencia) justo por esto.

## Compruébalo

Los tests de auth comprueban que no sale ningún email antes de que corra el worker, y
que sale uno después:

```ts
// cooper/backend/contexts/auth/auth.test.ts
const invitation = await as(ana, () => modules().invitation.create(acme.id, { email: 'BOB@cooper.test' }))
expect(invitation).toMatchObject({ email: 'bob@cooper.test', status: 'pending' })
expect(mails).toEqual([])
await settled()
expect(mails.map(mail => [mail.to, mail.subject])).toEqual([['bob@cooper.test', 'Ana invited you to Acme on Cooper']])
```

Y repiten el job a propósito, como si se hubiera parado después de salir el email:

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

En desarrollo, invita a alguien desde la aplicación y mira la consola del servidor: el
mailer de consola imprime el email, con su enlace.

## En resumen

- Lo que no se puede deshacer (un email, un cobro) sale de un worker, después del
  evento de aquello de lo que trata. Nunca desde el caso de uso que hace el cambio.
- El caso de uso guarda; el worker envía. Ninguno sabe del otro.
- Un job guarda su evento en la base de datos: nunca metas un secreto en un evento.
  Créalo en el worker, cuando se usa, y guarda solo su hash.
- Guarda antes de enviar: un enlace nunca debe salir antes de que se guarde lo que
  abre.
- Un email puede llegar dos veces. Si dos veces no es aceptable, apunta la operación
  con una referencia antes de repetirla.
