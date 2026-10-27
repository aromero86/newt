# Las aplicaciones

El monitor vigila aplicaciones: este capítulo las guarda. El módulo `app` registra una
con un nombre, la dirección de su endpoint de monitor y su clave; las lista; muestra
una; y cambia cualquiera de las tres cosas. La clave se sella con el `KeyCipher` del
capítulo anterior, y ninguna respuesta la muestra nunca.

Al final tendrás estos ficheros:

```
packages/newt-monitor/src/contexts/monitor/
  initialize-modules.ts         cambia: el módulo app, con el cifrador
  migrations/sqlite/
    00002_app_up.sql            la tabla app
    00002_app_down.sql
  modules/app/
    app.schema.ts               la aplicación, lo que muestra, lo que envía un cliente
    app.ts                      la entidad: sella su clave, y la abre
    app.repository.ts           un nombre es de una sola aplicación
    app-options.ts              el cifrador
    app.module.ts               registrar, listar, obtener, actualizar
    app.routes.ts               /api/apps
    events/app-registered.ts
    events/app-updated.ts
    errors/app-not-found.ts
    errors/app-name-taken.ts
    app.test.ts
```

## La tabla

```sql
-- packages/newt-monitor/src/contexts/monitor/migrations/sqlite/00002_app_up.sql
-- The applications the monitor watches: where their monitor endpoint is, and their key,
-- sealed with the monitor's secret (never the key itself).
CREATE TABLE app (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  sealed_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
-- A name is one application's, whatever its case (A to Z, as `lower` and `ieq` compare).
CREATE UNIQUE INDEX app_name ON app (lower(name));
```

## Sus esquemas: lo que guarda, lo que muestra

La entidad guarda la clave sellada; los demás lo ven todo menos eso. newt lo llama un
esquema público: `toDTO` da solo sus campos, el repositorio los guarda todos
([el capítulo 17 del tutorial](../guide/17-auth) lo hace con el hash de una contraseña).

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.schema.ts
/** An application the monitor watches, as it keeps it: its key sealed (`KeyCipher`), never the key. */
export const AppSchema = z.object({
  id: z.uuidv7(),
  name: z.string().trim().min(1).max(100),
  /** Where its monitor endpoint is (`serveMonitor`): `http://cooper:3010`. */
  url: z.url({ protocol: /^https?$/ }),
  sealedKey: z.string().min(1),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** What anyone sees of it: everything but its key. */
export const AppPublicSchema = AppSchema.omit({ sealedKey: true })
```

Lo que envía un cliente lo comprueban los esquemas de entrada, derivados del de la
entidad: una dirección sin query, guardada sin su `/` final, y una clave tan larga como
pide `serveMonitor`:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.schema.ts
/** What a client sends to register one. */
export const AppRegisterSchema = z.object({
  name: AppSchema.shape.name,
  url: EndpointUrlSchema,
  key: AppKeySchema,
})

/** What a client sends to change one: any of them, at least one. */
export const AppUpdateSchema = AppRegisterSchema.partial()
  .refine(change => Object.values(change).some(value => value !== undefined), 'Say what changes: name, url or key')
```

## La entidad sella su propia clave

La clave se sella para el id de la aplicación ([capítulo 3](./03-a-secret-that-encrypts)),
así que la entidad crea su id antes de sellar. Solo la entidad la sella y la abre:

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.ts
  static register({ name, url, key }: Fields, cipher: KeyCipher): App {
    const id = Bun.randomUUIDv7()
    const app = new App({ id, name, url, sealedKey: cipher.seal(key, id) }, true)
    app.trackEvent(new App_Registered(app.toDTO()))
    return app
  }
```

Un cambio dice qué campos han cambiado, `key` entre ellos, nunca su valor:
`app.updated` le dice a quien escucha que la clave es otra, y nada más.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.ts
  /** Changes what is given and differs; tells which fields did, if any. */
  update(change: Partial<Fields>, cipher: KeyCipher): void {
    const changed: ('name' | 'url' | 'key')[] = []
    if (change.name !== undefined && change.name !== this.data.name) changed.push('name')
    if (change.url !== undefined && change.url !== this.data.url) changed.push('url')
    if (change.key !== undefined && change.key !== this.key(cipher)) changed.push('key')
    if (changed.length === 0) return
```

## Un nombre es de una sola aplicación

La regla del [capítulo 6 del tutorial](../guide/06-rules-over-rows), para un nombre: el
caso de uso comprueba primero, para dar la respuesta clara; el guardado vuelve a contar
bajo un guard, en su transacción; el índice único tiene la última palabra. Dos registros
de `cooper` y `COOPER` a la vez: uno recibe un 201, el otro un 409 `app.name_taken`.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.module.ts
  @UseCase()
  async register(input: unknown): Promise<AppDTO> {
    const fields = AppRegisterSchema.parse(input)
    if (await this.repo.isNameTaken(fields.name)) throw new AppNameTaken(fields.name)
    const app = App.register(fields, this.options.cipher)
    await this.repo.persistWithNameFree(app)
    return app.toDTO()
  }
```

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.repository.ts
  async persistWithNameFree(app: App): Promise<void> {
    const { name } = app
    await this.save([app], each => this.write(each), {
      guard: [`appName:${name.replace(/[A-Z]/g, letter => letter.toLowerCase())}`],
      after: async () => {
        if (await this.count({ name: { ieq: name } }) > 1) throw new AppNameTaken(name)
      },
    })
  }
```

## Las rutas

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.routes.ts
export function registerAppRoutes(base: MonitorBase, apps: App_Module): void {
  base.http.get('/apps', async request => Response.json(await apps.list(pageRequestFrom(request))))

  base.http.post('/apps', async request => Response.json(await apps.register(await request.json()), { status: 201 }))

  base.http.get('/apps/:id', async request => Response.json(await apps.get(request.params.id)))

  base.http.patch('/apps/:id', async request => Response.json(await apps.update(request.params.id, await request.json())))
}
```

Ninguna es pública: la sesión del [capítulo 2](./02-signing-in) las protege todas.

## Tests

Lo que importa es la clave: ninguna respuesta la tiene, y su fila solo tiene el texto
sellado.

```ts
// packages/newt-monitor/src/contexts/monitor/modules/app/app.test.ts
  test('keeps the key sealed in its row, never as it was given', async () => {
    const { id } = await (await register(COOPER)).json() as { id: string }

    const [row] = await monitor.monitor.base.store.table<AppRow>('app').find({ id })
    expect(row!.sealedKey).toStartWith('v1.')
    expect(row!.sealedKey).not.toContain(COOPER.key)
  })
```

Y un nombre ocupado a la vez, una dirección que no es `http`, una clave demasiado corta,
un cambio que no dice nada, y nadie con sesión iniciada.

## Compruébalo

```sh
bun test packages/newt-monitor
```

Con el monitor en marcha y la sesión iniciada (la cookie del capítulo 2 en
`cookies.txt`):

```sh
curl -s -b cookies.txt localhost:4800/api/apps -H 'content-type: application/json' \
  -d '{"name":"cooper","url":"http://localhost:3010","key":"cooper'"'"'s monitor key, long enough to sign"}'
```

## Qué recordar

- Un secreto que guarda la entidad pasa por su esquema público: `toDTO` nunca lo tiene.
- La entidad sella y abre su propia clave, unida a su id.
- Un nombre único entre filas: comprueba primero, vuelve a contar bajo un guard, y un
  índice.
- Un evento sobre un secreto dice que ha cambiado, nunca cuál es.

Siguiente: [archivar, restaurar, borrar](./05-archive-restore-delete).
