# El catálogo

Una versión es la estructura entera en un momento. Para preguntar *cuándo apareció
`card.archive`*, o *qué casos de uso se han ido*, el monitor guarda cada parte por
separado: el **catálogo**. Cada contexto, módulo, caso de uso y evento que tuvo alguna
versión, con cuándo apareció por primera vez, cuándo estuvo por última vez y cuándo se
fue. Nada sale de él: una parte que se ha ido se archiva, y una que vuelve está otra
vez, con su primera aparición guardada.

Al final tendrás estos ficheros:

```
packages/newt-monitor/src/contexts/monitor/
  initialize-modules.ts             cambia: el módulo del catálogo
  migrations/sqlite/
    00006_catalog_item_up.sql
    00006_catalog_item_down.sql
  modules/catalog/
    catalog.schema.ts               un elemento, sus tipos, el filtro de la lista
    catalog.ts                      la entidad: appear, seen, archive
    services/items-of.ts            los elementos que tiene una descripción
    catalog.repository.ts
    catalog.deps.ts                 los módulos app y structure
    catalog.module.ts               record, list, get
    catalog.routes.ts
    catalog.workers.ts              una versión nueva: el catálogo puesto al día con ella
    errors/catalog-item-not-found.ts
    catalog.test.ts
```

## Un elemento

Qué es, por su tipo y su id (el de newt-graph: `boards/card.create`), dónde está, qué
decía de él la descripción, y sus tres momentos:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.schema.ts
  /** When the first version that had it was taken. */
  firstSeenAt: z.iso.datetime(),
  /** When the last version that had it was taken: for one still there, the last version's. */
  lastSeenAt: z.iso.datetime(),
  /** When the first version without it was taken; null while it is there. */
  archivedAt: z.iso.datetime().nullable().default(null),
```

Los momentos son los de las versiones (`takenAt`), no cuándo dio la casualidad de que se
ejecutara el catálogo: lo que cuenta es la historia de la aplicación, no la del
monitor.

```sql
-- packages/newt-monitor/src/contexts/monitor/migrations/sqlite/00006_catalog_item_up.sql
-- One item of each kind and id per application.
CREATE UNIQUE INDEX catalog_item_key ON catalog_item (app_id, kind, item_id);
```

## Su vida, en la entidad

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.ts
  /** There, in the version taken `at`, as it describes it: back, if it had gone. */
  seen(item: DescribedItem, at: string): void {
    const details = JSON.stringify(item.details) === JSON.stringify(this.data.details) ? {} : { details: item.details }
    const back = this.isArchived ? { archivedAt: null } : {}
    if (this.data.lastSeenAt === at && !Object.keys(details).length && !Object.keys(back).length) return
    this.change({ lastSeenAt: at, ...details, ...back })
  }

  /** Not in the version taken `at`: gone, and kept. */
  archive(at: string): void {
    if (this.isArchived) return
    this.change({ archivedAt: at })
  }
```

Visto otra vez en la misma versión, con los mismos detalles, no cambia nada.

## Los elementos de una descripción

Una función sin más, en los `services/` del módulo ([apéndice B de la
guía](../guide/b-module-anatomy)): entra una descripción, salen sus elementos.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/services/items-of.ts
/** Every context, module, use case and event a description has, each as the catalog keeps it. */
export function itemsOf(description: ApplicationDescription): DescribedItem[] {
```

## Registrar una versión

El worker oye `structure.changed`, y llama a `record` solo con la aplicación. `record`
lee la **última** versión, sea lo que sea lo que le dijo que se ejecutara: un job puede
ejecutarse dos veces, o después del siguiente, y llega a lo mismo cada vez. Los
elementos nuevos aparecen, los conocidos se ven, los que faltan se archivan, y solo se
guardan los que han cambiado, juntos, bajo un guard sobre la aplicación.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.module.ts
  @UseCase()
  async record(appId: string): Promise<void> {
    const version = await this.deps.structure.latest(appId)
    const known = new Map((await this.repo.allOf(appId)).map(item => [item.key, item]))
    const changed: CatalogItem[] = []
    for (const described of itemsOf(version.description)) {
      const key = `${described.kind}:${described.itemId}`
      const item = known.get(key)
      known.delete(key)
      if (!item) changed.push(CatalogItem.appear(appId, described, version.takenAt))
      else {
        item.seen(described, version.takenAt)
        if (item.hasPendingChanges) changed.push(item)
      }
    }
    for (const gone of known.values()) {
      gone.archive(version.takenAt)
      if (gone.hasPendingChanges) changed.push(gone)
    }
    await this.repo.persistAll(appId, changed)
  }
```

Varias entidades de un módulo en un guardado son una transacción: se guardan todas, o
ninguna ([capítulo 7 de la guía](../guide/07-cards-and-a-counter)).

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.workers.ts
export function registerCatalogWorkers(catalog: Catalog_Module, deps: Catalog_Deps): void {
  deps.structure.events.changed.subscribe(({ appId }) => catalog.record(appId), {
    strategy: 'handler',
    queue: 'catalog.record.on.structure.changed',
  })
}
```

## Listarlos

Por tipo, contexto y módulo; los que están ahora, salvo que la petición pida los
archivados, o todos:

```
GET /api/apps/:id/catalog?kind=useCase&context=boards&module=card&status=all
```

## Tests

Un despliegue es la aplicación de prueba cambiada, el reloj una hora después, y la
estructura leída otra vez. Una parte que se va, y vuelve:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/catalog/catalog.test.ts
  test('brings back what comes back, from when it first appeared', async () => {
    await deployed(() => app.add('billing', { invoice: { useCases: ['open'] } }))
    await deployed(() => app.remove('billing'))
    await deployed(() => app.add('billing', { invoice: { useCases: ['open'] } }))

    expect((await items('?context=billing'))[0]).toMatchObject({ firstSeenAt: '2026-01-01T10:00:00.000Z', lastSeenAt: '2026-01-01T12:00:00.000Z', archivedAt: null })
  })
```

Y `record` ejecutado dos veces sobre la misma versión: cada fila como estaba.

## Compruébalo

```sh
bun test packages/newt-monitor
```

```sh
curl -s -b cookies.txt 'localhost:4800/api/apps/<id>/catalog?kind=useCase&context=boards'
```

## Lo que hay que recordar

- Guarda la historia como estados con sus momentos: apareció, visto, archivado. No se
  quita nada.
- Un worker que reacciona a "algo ha cambiado" lee cómo están las cosas ahora, no lo
  que dijo el evento: dos veces, o tarde, llega a lo mismo.
- Varias entidades de un módulo cambian juntas en un guardado.

Siguiente: [borrar de verdad](./11-deleting-for-real).
