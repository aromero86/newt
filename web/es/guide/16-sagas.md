# Fallar a mitad: borrar un workspace

Borrar un workspace lo toca todo. En auth: el workspace, los accesos de sus miembros y
sus invitaciones pendientes. En boards: todos sus tableros, columnas y tarjetas. Dos
contextos, dos bases de datos. Ninguna transacción puede abarcarlo todo, y cualquier
paso puede fallar. Este capítulo enseña cómo borra cooper un workspace para que, falle
lo que falle y donde falle, siempre acabe borrado.

## Varias transacciones, huecos entre ellas

Borrar un workspace es un flujo de pasos, cada uno en su propia transacción:

1. auth marca el workspace como borrado.
2. auth retira todos los accesos a él.
3. auth revoca sus invitaciones pendientes.
4. boards borra sus tarjetas, columnas y tableros.

Entre dos pasos cualesquiera, el servidor puede pararse, un paso puede fallar, puede
llegar un conflicto. Durante un rato los datos no cuadran: un workspace borrado cuyos
miembros aún tienen acceso, o cuyos tableros siguen ahí. No puedes meter los pasos en
una transacción: están en dos bases de datos, e incluso en una ataría los módulos
entre sí ([módulos que hablan](./17-modules-talk)). Lo que se hace es asegurarse de que
el flujo siempre llega al final.

Un flujo de pasos entre módulos, cada uno en su propia transacción, es una **saga**.

## El primer paso: la petición

La petición hace solo el primer paso. El admin borra el workspace a través de la ruta
de boards, que llama al caso de uso de auth:

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

El workspace se borra de forma suave: su fila se queda, marcada, y ningún caso de uso
la encuentra ya. El evento dice lo que pone en marcha:

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

La petición escribe en un solo módulo, el de tenants, y responde `204`. Todo lo demás
sale de ese evento.

## Los demás pasos: workers

Tres módulos se suscriben a `tenant.deleted`. Sus tres jobs se guardan en la misma
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

Cada uno llama a un caso de uso que se puede repetir sin daño.

En auth, se van los accesos:

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

Y las invitaciones pendientes:

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

Estas filas se van para siempre, con `saveRows`: no cuentan nada. Nadie necesita un
`card.deleted` por cada tarjeta de un workspace que ya no existe. El workspace se
nombra, no se toma del scope: ya no hay nadie dentro.

Y un paso lleva a otro. Cada acceso retirado cuenta `access.revoked`, y boards
reacciona como cuando alguien deja un workspace: `card.unassignMember` se ejecuta por
cada miembro. Aquí normalmente no encuentra nada, porque las tarjetas ya no están o
están a punto de irse. Se ejecute primero el que sea, el final es el mismo.

```text
tenant.delete (petición) ── tenant.deleted ─┬─▶ tenant.removeAccesses ── access.revoked (cada uno) ──▶ card.unassignMember
                                            ├─▶ invitation.revokeForTenant
                                            └─▶ workspace.purge (boards: tarjetas, columnas, tableros)
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
desde la petición se perdería si fallara, porque nada lo vuelve a ejecutar. Un paso
que no se puede repetir se rompería en su reintento.

¿Y si se agotan los intentos? El job muere, y eso significa algo concreto: **un flujo
atascado a mitad**, un workspace borrado cuyos tableros siguen en boards. Por eso
`workspace.purge` tiene 10 intentos, y por eso alguien tiene que vigilar los jobs
muertos, arreglar la causa y llamar a `outbox.retry(id)`.

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

Mientras corre una saga, siguen llegando peticiones. Cada caso de abajo es una
petición que cae en un hueco, y lo que hace cooper con ella:

| Qué pasa | Cómo acaba |
|---|---|
| Alguien lista sus workspaces tras el borrado, antes de que se retire su acceso. | El acceso sigue apuntando al workspace, pero el workspace ya no existe: `workspace.mine` (y el `tenant.listForUser` de auth) lo dejan fuera. |
| El job del email de una invitación se ejecuta después de borrar el workspace. | `invitation.send` no encuentra el workspace y hace return: no sale ningún email. |
| `card.unassignMember` se ejecuta antes o después de `workspace.purge`. | Antes: desasigna tarjetas que después se borran. Después: no encuentra tarjetas. En los dos casos las tarjetas desaparecen. |
| El admin borra el workspace dos veces (una petición reintentada, dos pestañas). | La segunda vez el workspace no se encuentra: `tenant.delete` responde 404, y no empieza una segunda saga. |

::: warning Cuidado
Hay una ventana que cooper deja abierta. Hasta que corre `tenant.removeAccesses`, un
miembro aún tiene acceso, así que boards le sigue dejando entrar (`member.enter` le
pregunta a auth por el acceso, no por el workspace). Un tablero o una tarjeta creados
en esa ventana, después de que corriera `workspace.purge`, se quedarían en boards. La
ventana es corta, unos milisegundos en condiciones normales, pero los pasos de una
saga se ejecutan en cualquier orden. Para cerrarla, la comprobación que deja entrar
tiene que fallar también para un workspace borrado.
:::

## Las cuatro reglas

Cuando un flujo cruza módulos o contextos:

1. **Cada paso se puede repetir sin daño.** Escribe un resultado, o encuentra por una
   referencia lo que hizo una ejecución anterior.
2. **Los pasos avanzan desde workers**, que los repiten hasta completarlos. Desde una
   petición, un fallo a mitad se quedaría a mitad.
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
  expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done', 'done'])
  expect((await t.modules.board.listOf('globex', { size: 10 })).total).toBe(1)
})
```

Los tests de auth comprueban su parte: no queda ningún acceso, se avisó a cada miembro
y nadie ve ya el workspace:

```ts
// cooper/backend/contexts/auth/auth.test.ts
await as(ana, () => modules().tenant.delete(acme.id))
await expect(modules().tenant.get(acme.id)).rejects.toMatchObject({ code: 'tenant.not_found' })
await settled()

expect((await modules().access.listForTenant(acme.id, page)).total).toBe(0)
expect(told.sort()).toEqual([ana.id, bob.id].sort())
expect((await modules().tenant.listForUser(ana.id, page)).items).toEqual([])
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
- La petición hace el primer paso y cuenta un evento; los workers hacen el resto.
- Converge cuando cada paso se puede repetir sin daño y se repite hasta completarse.
- Lo que solo va hacia delante no necesita compensación; lo que otro camino puede
  detener necesita una por paso.
- Busca las carreras: una petición puede caer en cualquier hueco entre dos pasos.
- Un job muerto es un flujo atascado a mitad.
