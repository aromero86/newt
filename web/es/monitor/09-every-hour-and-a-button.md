# Cada hora, y un botón

La estructura se lee cuando algo lo pide. Este capítulo decide quién: una
**programación**, cada hora en punto, para cada aplicación vigilada; un **botón**, una
ruta que lee una ahora; y los momentos en que hay algo nuevo que leer, cada uno un
**worker**: una aplicación registrada, restaurada, o movida a otra dirección o clave.

Al final tendrás estos ficheros:

```
packages/newt-monitor/src/contexts/monitor/modules/
  app/app.module.ts                  cambia: watchedIds
  structure/
    structure.schema.ts              cambia: `archived`, y en qué queda refrescarlas todas
    structure.module.ts              cambia: la programación, refreshAll, una archivada no se lee
    structure.routes.ts              cambia: POST …/structure/refresh
    structure.workers.ts             lo que la lee, y cuándo
    structure.test.ts                cambia: registrarla la lee la primera vez
    structure.workers.test.ts
```

## La programación

Una programación es un evento que un contexto cuenta según dice una expresión cron, en
UTC ([capítulo 19 de la guía](../guide/19-invitations-and-time)). El módulo de la
estructura la define, como uno de sus eventos:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.module.ts
    this.events = eventsOf(base.bus, { changed: Structure_Changed })
    this.hourly = base.schedules.define('structure.hourly', '0 * * * *')
```

Cada tic se cuenta una vez, por muchos procesos que ejecuten el monitor: el primero que
lo registra lo cuenta.

## Refrescarlas todas

El tic de cada hora refresca todas las aplicaciones vigiladas, una detrás de otra. Una
que no responde queda registrada así, y las demás siguen: `refresh` nunca lanza por
ella.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.module.ts
  @UseCase({ writesTo: ['connection'] })
  async refreshAll(): Promise<RefreshAllDTO> {
    const refreshed: RefreshDTO[] = []
    for (const appId of await this.deps.app.watchedIds()) refreshed.push(await this.refresh(appId))
    return { refreshed }
  }
```

`watchedIds` responde con todas, no con una página. La regla de newt es que ninguna
lista se devuelve entera salvo que el dominio la acote
([regla de oro 11](../guide/a-golden-rules)); las aplicaciones que vigila un monitor se
cuentan por decenas, a mano, y su comentario lo dice.

Una aplicación archivada no se vigila: refrescarla no lee nada, y lo dice.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.module.ts
    const app = await this.deps.app.get(appId)
    const previous = await this.repo.latest(appId)
    if (app.archivedAt !== null) return { appId, outcome: 'archived', version: previous?.summary() ?? null }
```

## Los workers

Cada uno es un `handler`: un job escrito con el cambio que lo cuenta, en su transacción,
y ejecutado hasta que sale bien ([capítulo 11 de la guía](../guide/11-reacting)). Cada
uno llama a un caso de uso de su propio módulo, y su cola dice a cuál, ante qué evento.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.workers.ts
export function registerStructureWorkers(structures: Structure_Module, deps: Structure_Deps): void {
  structures.hourly.subscribe(() => structures.refreshAll(), {
    strategy: 'handler',
    queue: 'structure.refreshAll.on.structure.hourly',
  })
  deps.app.events.registered.subscribe(app => structures.refresh(app.id), {
    strategy: 'handler',
    queue: 'structure.refresh.on.app.registered',
  })
  deps.app.events.restored.subscribe(app => structures.refresh(app.id), {
    strategy: 'handler',
    queue: 'structure.refresh.on.app.restored',
  })
  deps.app.events.updated.subscribe(({ dto }) => structures.refresh(dto.id), {
    strategy: 'handler',
    queue: 'structure.refresh.on.app.updated',
    when: ({ changed }) => changed.includes('url') || changed.includes('key'),
  })
}
```

`when` evita que un nombre nuevo llegue siquiera a escribir un job: solo una dirección
o una clave nuevas son motivo para volver a leer.

Un refresco puede ejecutarse dos veces (un job puede): el segundo encuentra el mismo
hash, y responde `unchanged`. Eso es lo que lo hace seguro como job.

## El botón

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.routes.ts
  // The button: read it now.
  base.http.post('/apps/:id/structure/refresh', async request => Response.json(await structures.refresh(request.params.id)))
```

Responde en qué ha quedado el refresco: `changed`, `unchanged`, `unreachable` (y por
qué) o `archived`.

## Tests

El bucle propio de la programación se para, una vez hecha su primera mirada, y el test
mueve el reloj y hace el tic a mano, como hacen los tests de cooper:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/structure/structure.workers.test.ts
    time += HOUR_MS
    await monitor.monitor.base.schedules.tick()
    await settled()

    expect([await versions(shop.id), await versions(nuke.id), await versions(old.id)]).toEqual([2, 2, 1])
```

`settled` espera a los jobs (`base.jobs.idle()`): nunca un sleep.

Registrar ahora lee la estructura la primera vez, desde un worker, así que los tests del
capítulo anterior la esperan antes de mirar.

## Compruébalo

```sh
bun test packages/newt-monitor
```

```sh
curl -s -b cookies.txt -X POST localhost:4800/api/apps/<id>/structure/refresh
```

```json
{"appId":"…","outcome":"unchanged","version":{"id":"…","hash":"…","takenAt":"…"}}
```

## Lo que hay que recordar

- Una programación es un evento: la define un módulo, y se suscribe uno a ella como a
  cualquier otro.
- Lo que debe pasar después de que algo pase es un `handler`, con su cola nombrada por
  quién reacciona, con qué, ante qué evento; `when` evita escribir un job para nada.
- Un job puede ejecutarse dos veces: haz que la segunda vez no encuentre nada que hacer.

Siguiente: [el catálogo](./10-the-catalog).
