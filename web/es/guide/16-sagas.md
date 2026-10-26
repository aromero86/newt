# Fallar a mitad: borrar un workspace

Borrar un workspace lo toca todo. En auth: el workspace, los accesos de sus miembros y
sus invitaciones pendientes. En boards: todos sus tableros, columnas y tarjetas, y la
actividad de cada tarjeta. Dos contextos, dos bases de datos. Ninguna transacción
puede abarcarlo todo, y cualquier paso puede fallar. Este capítulo enseña cómo borra
cooper un workspace para que, falle lo que falle y donde falle, siempre acabe borrado.

## Varias transacciones, huecos entre ellas

Borrar un workspace es un flujo de pasos, cada uno en su propia transacción:

1. auth marca el workspace como borrado.
2. auth retira todos los accesos a él.
3. auth revoca sus invitaciones pendientes.
4. boards borra sus tarjetas, columnas y tableros.
5. boards borra la actividad de sus tarjetas.

Entre dos pasos cualesquiera, el servidor puede pararse, un paso puede fallar, puede
llegar un conflicto. Durante un rato los datos no cuadran: un workspace borrado cuyos
tableros siguen ahí, o cuyas invitaciones siguen pendientes. No puedes meter los pasos
en una transacción: están en dos bases de datos, e incluso en una ataría los módulos
entre sí ([módulos que hablan](./17-modules-talk)). Lo que se hace es asegurarse de que
el flujo siempre llega al final.

Un flujo de pasos entre módulos, cada uno en su propia transacción, es una **saga**.

## Los dos primeros pasos: la petición

El admin borra el workspace a través de la ruta de boards, que llama al caso de uso de
auth:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.routes.ts
workspace.delete('', async request => {
  await tenant.delete(request.params.workspaceId)
  return noContent()
})
```

La petición hace el primer paso, y el segundo justo detrás:

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

El workspace se borra de forma suave: su fila se queda, marcada, y ningún caso de uso
la vuelve a encontrar. Ese guardado cuenta `tenant.deleted`, y con él van los jobs de
todos los pasos que siguen.

Después la petición retira ella misma los accesos, en una segunda transacción. ¿Por
qué no dejárselo también a un worker? Hazte la pregunta de la [consistencia
eventual](./12-eventual-consistency): ¿lo necesita la persona ya? Aquí la respuesta es
que sí, al revés: desde que el admin ve "borrado", nadie puede entrar en el workspace,
tampoco su admin, y no debe quedar ningún acceso a él. Así que los accesos se van en
la petición, y el worker es solo el respaldo. Un caso de uso que escribe en otro
módulo fuera de un worker lo dice con `writesTo`, y `retryOnConflict: false` evita que se repita ante un conflicto: la
segunda ejecución encontraría el workspace ya borrado y respondería 404 a un borrado
que sí funcionó.

El segundo guardado puede fallar después de confirmarse el primero, y entre los dos
guardados, unos milisegundos, los accesos siguen ahí. Aun así no dejan
entrar a nadie: boards deja entrar a alguien en un workspace solo si auth tiene un
acceso suyo *y* el workspace sigue ahí ([varios contextos](./19-several-contexts)):

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

Así que el paso conserva también su worker, de respaldo para un segundo guardado que
falló. El evento dice lo que pone en marcha:

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

## Los demás pasos: workers

Cuatro módulos se suscriben a `tenant.deleted`. Sus cuatro jobs se guardan en la misma
transacción que el borrado, en el store de auth:

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

Cada uno llama a un caso de uso que se puede repetir sin daño.

En auth, los accesos se retiran una vez más. Lo normal es que la petición ya los
quitara todos y esta ejecución no encuentre ninguno; importa cuando la petición se
paró antes de su segundo guardado:

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

Las invitaciones pendientes se revocan:

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

En boards se va todo lo del workspace, los hijos primero:

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

Estas filas se van para siempre, con `saveRows`: no cuentan nada. Nadie necesita un
`card.deleted` por cada tarjeta de un workspace que ya no existe. El workspace se pasa
por nombre, no se toma del scope: ya no hay nadie dentro. El registro de actividad se
va igual, en su propio paso.

Y un paso lleva a otro. Cada acceso retirado cuenta `access.revoked`, y boards
reacciona como cuando alguien deja un workspace: `card.unassignMember` se ejecuta para
cada miembro. Aquí lo normal es que no encuentre nada, porque las tarjetas ya no están
o están a punto de irse. Corra primero el que corra, el final es el mismo.

```text
tenant.delete (petición) ─┬─ guarda el borrado ── tenant.deleted ─┬─▶ tenant.removeAccesses (respaldo)
                          │                                        ├─▶ invitation.revokeForTenant
                          │                                        ├─▶ workspace.purge (boards: tarjetas, columnas, tableros)
                          │                                        └─▶ activity.purgeWorkspace (boards)
                          └─ access.revokeTenant ── access.revoked (cada uno) ──▶ card.unassignMember
```

## Converger: repetir hasta terminar

Imagina que `workspace.purge` falla tras borrar las tarjetas, antes de las columnas.
Las tarjetas ya no están; las columnas y los tableros, sí. Su job se repite:

- `card.purgeWorkspace` borra todas las tarjetas del workspace. No hay ninguna. Bien.
- `column.purgeWorkspace` borra las columnas.
- `board.purgeWorkspace` borra los tableros.

El hueco se cierra solo. A esto se le llama **converger**: falle donde falle, repetir
el trabajo lleva siempre al mismo final. Funciona por dos cosas a la vez:

- **Cada paso se puede repetir sin daño.** Cada uno escribe un resultado ("este
  workspace no tiene tarjetas"), no un cambio ([workers que se pueden
  repetir](./13-repeatable-workers)).
- **El trabajo se repite hasta completarse.** Cada paso es un job, guardado con el
  borrado, y reintentado cuando falla ([cuando algo falla](./15-failures)).

Quita una de las dos y el flujo se puede quedar a medias para siempre. Un paso hecho
solo desde la petición se perdería si fallara, porque nada lo vuelve a ejecutar. Por
eso los accesos, que se retiran en la petición, siguen teniendo su worker. Un paso que
no se puede repetir se rompería en su reintento.

¿Y si se agotan los intentos? El job muere, y eso significa algo concreto: **un flujo
atascado a mitad**, un workspace borrado cuyos tableros siguen en boards. Por eso
`workspace.purge` tiene 10 intentos, y por eso alguien tiene que vigilar los jobs
muertos, arreglar la causa y reintentarlos, desde la página Jobs del backoffice.

## Compensaciones: cuando otro camino detiene el flujo

Borrar un workspace solo va hacia delante. En cuanto auth lo marca como borrado, nada
lo recupera, así que ningún paso necesita deshacerse: cada uno solo tiene que
completarse.

Otros flujos se pueden detener a mitad por otra cosa. Imagina un pedido que reserva
stock y después el cliente lo cancela: el stock tiene que volver. Deshacer un paso que
ya se guardó no es un rollback, porque su transacción se confirmó hace rato. Es otro
paso que hace lo contrario: una **compensación**. Se ejecuta desde un worker, con el
evento que detiene el flujo, y como cualquier paso tiene que poder repetirse, y poder
ejecutarse aunque el paso que deshace no llegara a ocurrir.

cooper no tiene ningún flujo que la necesite. Si el tuyo la necesita, dale a cada paso
su compensación, y haz que se encuentren por una referencia que identifique la
operación (el id del pedido, por ejemplo).

## Las carreras

Mientras corre una saga, siguen llegando peticiones y otros jobs. Cada caso de abajo
cae en un hueco, y esto es lo que hace cooper con él:

| Qué pasa | Cómo acaba |
|---|---|
| Alguien lista sus workspaces justo después del borrado. | Su acceso se fue con la petición. Si ese segundo guardado hubiera fallado, el workspace ya no existe igualmente: `workspace.mine` (y el `tenant.listForUser` de auth) lo dejan fuera hasta que el worker retira el acceso. |
| Un miembro abre un tablero, o crea una tarjeta, entre los dos guardados de la petición. | boards le pregunta a auth por el acceso y por el workspace: el workspace ya está borrado, así que no es miembro, y nada se crea después de `workspace.purge`. |
| Alguien acepta una invitación al workspace antes de que corra `invitation.revokeForTenant`. | `invitation.accept` mira primero el workspace: uno borrado deja la invitación cerrada (`invitation.not_open`), y no se da ningún acceso. |
| El job del email de una invitación se ejecuta después de borrar el workspace. | `invitation.send` no encuentra el workspace y hace return: no sale ningún email. |
| El job del tablero de bienvenida (`workspace.prepare`) corre después de borrar el workspace, o mientras se borra. | Le pregunta a auth si el workspace existe: si no, no escribe nada; si se fue mientras corría, purga lo que escribió. |
| `card.unassignMember` se ejecuta antes o después de `workspace.purge`. | Antes: desasigna tarjetas que después se borran. Después: no encuentra tarjetas. En los dos casos las tarjetas desaparecen. |
| El admin borra el workspace dos veces (una petición reintentada, dos pestañas). | La segunda vez el workspace no se encuentra: `tenant.delete` responde 404, y no empieza una segunda saga. |

La fila de la invitación es una comprobación hecha en el sitio justo. Revocar las
invitaciones es un paso de un worker, así que durante un momento un workspace borrado
aún tiene invitaciones pendientes. En vez de confiar en que nadie acepte una en ese
momento, `accept` pregunta por el workspace:

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

::: tip Consejo
La comprobación que deja entrar es donde se cierra el hueco entre dos guardados. Si
boards preguntara solo por el acceso, un miembro aún podría entrar entre el borrado y
los accesos (más tiempo, si el segundo guardado falló y su worker no ha corrido), y un
tablero creado entonces, después de `workspace.purge`, se quedaría en boards para
siempre. Preguntar también por el workspace cuesta una lectura más, y no deja ese
hueco.
:::

## Las cuatro reglas

Cuando un flujo cruza módulos o contextos:

1. **Cada paso se puede repetir sin daño.** Escribe un resultado, o encuentra por una
   referencia lo que hizo una ejecución anterior.
2. **Los pasos avanzan desde workers**, que los repiten hasta completarlos. Un paso
   que la persona necesita ya puede ir también en la petición, pero conserva su
   worker: desde una petición sola, un fallo a mitad se quedaría a mitad.
3. **Si otro camino puede detener el flujo, cada paso tiene su compensación**: otro
   paso, desde un worker, con el evento que lo detiene. Se puede repetir, y se puede
   ejecutar aunque el paso que deshace no llegara a ocurrir.
4. **Un job muerto es un flujo atascado.** Vigílalos: alguien tiene que mirarlos.

## Compruébalo

Los tests de boards borran un workspace, comprueban que no queda nada suyo ni se ha
tocado nada de otro, y después repiten el borrado entero, como tras un fallo a mitad:

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

Los tests de auth comprueban su parte. Con su worker parado, nadie entra desde el
momento en que responde el borrado, y no se puede aceptar una invitación:

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

Y el test de extremo a extremo de cooper lo hace todo por HTTP, con los dos contextos:

```ts
// cooper/backend/cooper.test.ts
expect((await call(ana.as, 'DELETE', `/workspaces/${acme.id}`)).status).toBe(204)
await settled()

expect(await contexts.boards.modules.board.listOf(acme.id, { size: 10 })).toMatchObject({ items: [], total: 0 })
expect(await contexts.boards.modules.card.countByWorkspace([acme.id])).toEqual([{ workspaceId: acme.id, cards: 0 }])
expect((await call(ana.as, 'GET', '/workspaces')).body).toEqual([])
expect((await call(bob.as, 'GET', `/workspaces/${acme.id}/boards`)).status).toBe(404)
```

## En resumen

- Un flujo entre módulos o contextos es una saga: pasos, cada uno en su propia
  transacción.
- La petición hace el primer paso y cuenta un evento; los workers hacen el resto. Un
  paso que la persona necesita ya puede ir en la petición, con un worker detrás.
- Converge cuando cada paso se puede repetir sin daño y se repite hasta completarse.
- Lo que solo va hacia delante no necesita compensación; lo que otro camino puede
  detener necesita una por paso.
- Busca las carreras: una petición o un job que llega tarde puede caer en cualquier
  hueco entre dos pasos. Ciérralas con una comprobación donde importa, no con
  esperanza.
- Un job muerto es un flujo atascado a mitad.
