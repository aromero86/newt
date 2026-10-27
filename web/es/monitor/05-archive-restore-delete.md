# Archivar, restaurar, borrar

Una aplicación que vigila el monitor puede dejar de vigilarse, y volver. Cuando deja
de vigilarse no se pierde nada de lo que se sabía de ella: se **archiva**, se guarda con
todo lo suyo, y solo se muestra cuando se pide. Solo se **borra** una vez archivada, y
entonces para siempre, con todo lo que el monitor sabía de ella.

Esa es la vida de la aplicación, y la guarda la entidad: cada paso es un método, y cada
uno un evento que escuchan los capítulos siguientes.

```
registered ──archive──▶ archived ──delete──▶ gone
     ▲                     │
     └──────restore────────┘
```

Al final tendrás estos ficheros:

```
packages/newt-monitor/src/contexts/monitor/
  migrations/sqlite/
    00003_app_archived_up.sql     archived_at
    00003_app_archived_down.sql
  modules/app/
    app.schema.ts                 cambia: archivedAt, el filtro de la lista, lo que dice app.deleted
    app.ts                        cambia: archive, restore, delete
    app.module.ts                 cambia: los casos de uso, y la lista filtrada
    app.routes.ts                 cambia: POST …/archive, …/restore, DELETE
    events/app-archived.ts
    events/app-restored.ts
    events/app-deleted.ts
    errors/app-not-archived.ts
    app.test.ts                   cambia
```

## Una columna, con una migración

Un cambio de forma es una migración nueva, nunca la edición de una ya aplicada
([capítulo 27 de la guía](../guide/27-postgres)):

```sql
-- packages/newt-monitor/src/contexts/monitor/migrations/sqlite/00003_app_archived_up.sql
-- An application archived: the monitor stops watching it, and keeps all it knows of it
-- until it is deleted, which only an archived one can be.
ALTER TABLE app ADD COLUMN archived_at TEXT;
```

## Por qué no `softDelete`

Los repositorios de newt saben hacer un borrado lógico: ponen `deletedAt`, y ninguna
búsqueda devuelve la fila. Eso es para algo que ya no está y a lo que otros aún
apuntan. Una aplicación archivada no se ha ido: se lista cuando se pide, se muestra, se
restaura. Así que es un campo de la entidad, `archivedAt`, y la lista filtra por él.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.schema.ts
  /** When it was archived: it is not watched, and all it was is kept. Null while it is. */
  archivedAt: z.iso.datetime().nullable().default(null),
```

## Los pasos, en la entidad

Archivar una ya archivada es archivarla una vez, y no dice nada: un evento dice que algo
ha pasado. Borrar pide que esté archivada antes.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.ts
  /** No longer watched, all it was kept. Archiving one archived is archiving it once. */
  archive(): void {
    if (this.isArchived) return
    this.change({ archivedAt: now().toISOString() })
    this.trackEvent(new App_Archived(this.toDTO()))
  }

  /** Watched again. */
  restore(): void {
    if (!this.isArchived) return
    this.change({ archivedAt: null })
    this.trackEvent(new App_Restored(this.toDTO()))
  }

  /** Gone for good, with all the monitor knows of it: only once it is archived. */
  delete(): void {
    if (!this.isArchived) throw new AppNotArchived(this.name)
    this.markAsDeleted()
    this.trackEvent(new App_Deleted({ id: this.id, name: this.name }))
  }
```

`app.deleted` solo dice qué aplicación era: no queda nada más de ella. Los módulos que
guardan algo de una aplicación lo oirán, y borrarán lo suyo
([capítulo 11](./11-deleting-for-real)).

## La lista, filtrada

Las vigiladas, salvo que la petición diga `?status=archived`, o `all`. El filtro es lo
que envía un cliente, así que se valida como todo lo que envía un cliente:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.module.ts
  @UseCase()
  async list(filter: unknown, page: PageRequest): Promise<Page<AppDTO>> {
    const { status } = AppListSchema.parse(filter)
    const criteria = status === 'active' ? { archivedAt: null } : status === 'archived' ? { archivedAt: { ne: null } } : {}
    return mapPage(await this.repo.page(criteria, page, { newestFirst: true }), app => app.toDTO())
  }
```

## Las rutas

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.routes.ts
  base.http.post('/apps/:id/archive', async request => Response.json(await apps.archive(request.params.id)))

  base.http.post('/apps/:id/restore', async request => Response.json(await apps.restore(request.params.id)))

  base.http.delete('/apps/:id', async request => {
    await apps.delete(request.params.id)
    return new Response(null, { status: 204 })
  })
```

Borrar una que no está archivada es un 409, `app.not_archived`.

## Tests

La vida entera, y lo que dice: un paso en el que ya estaba no dice nada.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.test.ts
    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    await as(`/api/apps/${id}/restore`, { method: 'POST' })
    await as(`/api/apps/${id}/archive`, { method: 'POST' })
    await as(`/api/apps/${id}`, { method: 'DELETE' })

    expect(told).toEqual(['registered', 'archived', 'restored', 'archived', 'deleted'])
```

## Compruébalo

```sh
bun test packages/newt-monitor
```

## Qué recordar

- Algo que se detiene pero se guarda es un estado de la entidad, no un borrado lógico.
- Cada paso de una vida es un método de la entidad, y un evento; un paso en el que ya
  está no es un cambio, y no dice nada.
- Un paso que no se puede deshacer pide el anterior: archivar, y luego borrar.

Siguiente: [hablar con una aplicación](./06-talking-to-an-application).
