# Borrar de verdad

Borrar una aplicación archivada quita su fila ([capítulo 5](./05-archive-restore-delete)).
Pero el monitor sabe más de ella, en otros módulos: si respondía, cada versión de su
estructura, su catálogo. Este capítulo hace que borrar se lo lleve todo: cada módulo oye
`app.deleted` y olvida lo que tiene de la aplicación, desde un worker. Cuando los jobs
terminan, no queda nada de ella. Archivada, todo lo suyo se queda.

Al final tendrás estos ficheros:

```
packages/newt-monitor/src/contexts/monitor/
  deleting.test.ts                     cada tabla, después de borrar
  modules/app/app.module.ts            cambia: find, para un worker
  modules/connection/
    connection.repository.ts           cambia: purgeApp
    connection.module.ts               cambia: forget
    connection.workers.ts              app.deleted: forget
  modules/structure/
    structure.schema.ts                cambia: `gone`
    structure.repository.ts            cambia: purgeApp
    structure.module.ts                cambia: forget; el refresco de una que ya no está
    structure.workers.ts               cambia: app.deleted: forget
  modules/catalog/
    catalog.repository.ts              cambia: purgeApp
    catalog.module.ts                  cambia: forget; registrar una que ya no está
    catalog.workers.ts                 cambia: app.deleted: forget
```

## Cada módulo olvida lo suyo

Ningún módulo borra las filas de otro: cada uno oye el evento, y borra las suyas
(el [capítulo 14 de la guía](../guide/14-sagas) lo hace para un workspace). El
repositorio las quita para siempre con `purge`, al que solo puede llamar un
repositorio:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.repository.ts
  /** Everything of an application, for good: it was deleted. */
  async purgeApp(appId: string): Promise<void> {
    await this.purge({ appId })
  }
```

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.module.ts
  /** Forgets everything of an application deleted: forgetting it twice is forgetting it once. */
  @UseCase()
  async forget(appId: string): Promise<void> {
    await this.repo.purgeApp(appId)
  }
```

```ts
// packages/newt-monitor/src/contexts/monitor/modules/connection/connection.workers.ts
/** An application deleted: whether it answered goes with it. */
export function registerConnectionWorkers(connection: Connection_Module, deps: Connection_Deps): void {
  deps.app.events.deleted.subscribe(app => connection.forget(app.id), {
    strategy: 'handler',
    queue: 'connection.forget.on.app.deleted',
  })
}
```

Cada uno es un `handler`: escrito con el borrado, en su transacción, así que la
aplicación nunca se borra sin sus jobs para olvidarla. Un job que se ejecuta dos veces
no purga nada la segunda vez.

## Un job que llega tarde

Los jobs de un módulo no esperan a los de otro. Un `catalog.record` escrito justo antes
del borrado puede ejecutarse después de él; un refresco pedido al registrar, después de
un archivado y un borrado. Cada uno fallaría ante una aplicación que no está, cinco
veces, y moriría: un job muerto para nada. La regla de newt es que, en cambio, un job no
encuentre nada que hacer ([regla de oro 8](../guide/a-golden-rules)).

Así que el módulo app responde si una aplicación está, sin un 404, para un worker:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.module.ts
  /** One, or null if there is none: for a worker, whose application may be deleted since it was told. */
  @UseCase()
  async find(id: string): Promise<AppDTO | null> {
    return (await this.repo.first({ id }))?.toDTO() ?? null
  }
```

y los jobs que pueden llegar tarde lo preguntan primero:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.module.ts
  @UseCase()
  async record(appId: string): Promise<void> {
    // Told late, its application may be deleted since: there is nothing to bring.
    if (!await this.deps.app.find(appId)) return
```

El refresco de una aplicación borrada lo dice, `gone`, como dice `archived` para una
archivada.

## Tests

Cada tabla, contada para una aplicación, antes y después:

```ts
// packages/newt-monitor/src/contexts/monitor/deleting.test.ts
    await as(`/api/apps/${shop}/archive`, { method: 'POST' })
    await as(`/api/apps/${shop}`, { method: 'DELETE' })
    await settled()

    expect(await rowsOf(shop)).toEqual({ app: 0, connection: 0, structure: 0, catalog: 0 })
    expect(await rowsOf(other)).toEqual({ app: 1, connection: 1, structure: 2, catalog: 7 })
```

Y cada job ejecutado otra vez, o tarde, después: no cambia nada, y ningún job está
muerto.

```ts
// packages/newt-monitor/src/contexts/monitor/deleting.test.ts
    expect(await rowsOf(shop)).toEqual({ app: 0, connection: 0, structure: 0, catalog: 0 })
    expect(await monitor.monitor.base.store.outbox.list({ status: 'dead' })).toEqual([])
```

## Compruébalo

```sh
bun test packages/newt-monitor
```

## Lo que hay que recordar

- Borrar a través de varios módulos es una saga: un evento, y cada módulo borra lo
  suyo, desde un worker.
- `purge` quita filas para siempre, solo desde el repositorio.
- Un job puede llegar tarde: pregunta si todavía queda algo que hacer, y no hace nada,
  en lugar de fallar.

Siguiente: [contra cooper](./12-against-cooper).
