# Versiones de la estructura

El monitor puede preguntar a una aplicación de qué está hecha. Este capítulo guarda la
respuesta: el módulo `structure` la lee, y la guarda como una **versión** solo cuando no
es igual que la última. Una aplicación desplegada diez veces con el mismo código tiene
una versión; el despliegue que añadió un caso de uso tiene la siguiente. El historial
dice qué era cada aplicación, y cuándo cambió.

Al final tendrás estos ficheros:

```
packages/newt/
  core/description/application-description.ts   movido desde runtime: los tipos de la descripción
  contract/index.ts                             cambia: esos tipos, también para un navegador
packages/newt-monitor/src/contexts/monitor/
  initialize-modules.ts                         cambia: el módulo structure
  migrations/sqlite/
    00005_structure_version_up.sql
    00005_structure_version_down.sql
  modules/structure/
    structure.schema.ts            una versión, un resumen, en qué acaba un refresco
    structure.ts                   la entidad, y el hash de una descripción
    structure.repository.ts        la última versión, y una tomada cada vez
    structure.deps.ts              los módulos app y connection
    structure.module.ts            refresh, latest, history, get
    structure.routes.ts
    events/structure-changed.ts
    errors/structure-not-read.ts
    errors/structure-version-not-found.ts
    structure.test.ts
```

## La descripción es un contrato

Una versión guarda la descripción que da una aplicación: `ApplicationDescription`. Su
esquema necesita el tipo, y el lint de newt lo rechazó: un `.schema.ts` es lo que carga
también un frontend, así que de newt toma solo `newt/contract` (`newt/schema-imports`).
El lint tenía razón, y el esquema también: lo que una aplicación dice que es, es un
contrato, entre la aplicación, el monitor y las páginas del monitor que vendrán.

Así que newt movió esos tipos a su core (son solo tipos, funcionan en cualquier sitio),
y `newt/contract` los exporta, como exporta `Page` o `ErrorBody`. `newt/runtime` los
sigue exportando, junto a `describeApplication`.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.schema.ts
/** What an application was made of at some time, as its endpoint described it (`describeApplication`). */
export const StructureVersionSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  /** SHA-256 of the description: the same one twice is the same structure. */
  hash: z.string().length(64),
  description: z.custom<ApplicationDescription>(value => typeof value === 'object' && value !== null),
  takenAt: z.iso.datetime(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})
```

La descripción se guarda entera, como JSON. Su hash dice si dos son iguales: una
aplicación se describe igual cada vez que su código es el mismo.

## Una versión, tomada una vez

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.ts
  /** A new version of `appId`'s structure, after `previous`, if there was one. */
  static take(appId: string, description: ApplicationDescription, hash: string, previous: StructureVersion | undefined): StructureVersion {
    const version = new StructureVersion({ appId, hash, description, takenAt: now().toISOString() }, true)
    version.trackEvent(new Structure_Changed({ appId, versionId: version.id, previousVersionId: previous?.id ?? null }))
    return version
  }
```

Una versión nunca cambia. `structure.changed` dice cuál es la nueva, y detrás de cuál
viene: lo escucha el catálogo de los capítulos siguientes.

## Refrescar

Leer; si la aplicación no responde, quedarse con la última versión y decir por qué; si
el hash es el de la última, nada ha cambiado; si no, una versión nueva.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.module.ts
  // Asking the application records, in `connection`, whether it answered: a note of the
  // call, which every call makes, not a change of the connection this use case decides.
  @UseCase({ writesTo: ['connection'] })
  async refresh(appId: string): Promise<RefreshDTO> {
    const read = await this.deps.connection.fetchStructure(appId)
    const previous = await this.repo.latest(appId)
    if (!read.answered) return { appId, outcome: 'unreachable', version: previous?.summary() ?? null, failure: read.failure }

    const hash = hashOf(read.value)
    if (previous?.hash === hash) return { appId, outcome: 'unchanged', version: previous.summary() }
    const version = StructureVersion.take(appId, read.value, hash, previous)
    await this.repo.persistAfter(version, previous)
    return { appId, outcome: 'changed', version: version.summary() }
  }
```

`writesTo: ['connection']` es la regla de escritura de newt en acción ([capítulo 11 de
la guía](../guide/11-reacting)): un caso de uso que guarda en otro módulo fuera de un
worker lo dice, con el motivo encima. Aquí, registrar si la aplicación respondió es
parte de preguntarle.

## Dos refrescos a la vez

El refresco de cada hora y el botón pueden ejecutarse juntos. Los dos leen la misma
última versión, los dos encuentran la estructura nueva: solo uno puede tomar la versión
siguiente. El repositorio la guarda bajo un guard sobre la aplicación, y vuelve a
contar después de escribir: si la versión anterior ya no es la que leyó, es un
conflicto, y el caso de uso se ejecuta otra vez
([capítulo 8 de la guía](../guide/08-two-people-one-card)). Al ejecutarse otra vez,
encuentra su estructura ya tomada, y responde `unchanged`.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.repository.ts
  async persistAfter(version: StructureVersion, previous: StructureVersion | undefined): Promise<void> {
    await this.save([version], each => this.write(each), {
      guard: [`structure:${version.appId}`],
      after: async () => {
        const [last, before] = await this.find({ appId: version.appId }, { orderBy: [{ field: 'id', direction: 'desc' }], limit: 2 })
        if (last?.id !== version.id || before?.id !== previous?.id) this.conflict()
      },
    })
  }
```

## Leerlas

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.routes.ts
export function registerStructureRoutes(base: MonitorBase, structures: Structure_Module): void {
  base.http.get('/apps/:id/structure', async request => Response.json(await structures.latest(request.params.id)))

  base.http.get('/apps/:id/structure/versions', async request => Response.json(await structures.history(request.params.id, pageRequestFrom(request))))

  base.http.get('/apps/:id/structure/versions/:versionId', async request => Response.json(await structures.get(request.params.id, request.params.versionId)))
}
```

El historial lista las versiones sin sus descripciones: así una página de ellas sigue
siendo pequeña.

## Tests

Un despliegue, como lo hace `serveTestApp`: se añade un contexto, y luego se quita.
Volver a lo que era también es una versión: el historial dice que cambió dos veces.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.test.ts
  test('keeps a new version each time it changes, back to one it was too', async () => {
    const first = await refresh()
    app.add('billing', { invoice: { useCases: ['open'] } })
    const second = await refresh()
    app.remove('billing')
    const third = await refresh()
```

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.test.ts
  test('takes one version however many refreshes run at once', async () => {
    const refreshed = await Promise.all(Array.from({ length: 5 }, refresh))

    expect(refreshed.filter(each => each.outcome === 'changed')).toHaveLength(1)
    expect(await versions()).toHaveLength(1)
  })
```

## Compruébalo

```sh
bun test packages/newt-monitor
```

## Qué recordar

- Guarda lo que cambia, no cada vez que se lee: un hash distingue lo mismo de lo nuevo.
- Una versión se toma una vez y nunca cambia; un evento dice cuál vino detrás de cuál.
- Una escritura en otro módulo fuera de un worker lo dice, `writesTo`, y por qué.
- Lo que comparten los dos lados de un cable es un contrato: `newt/contract`, también
  para un navegador.

Siguiente: [cada hora, y un botón](./09-every-hour-and-a-button).
