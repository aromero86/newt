# Un monitor hecho con newt

El monitor es un paquete del repositorio, junto a newt-graph y newt-eslint, y una
aplicación hecha con newt, como lo es cooper. Este capítulo crea el paquete, su único
contexto, `monitor`, con su propia base de datos SQLite, su configuración leída del
entorno, y el comando que lo arranca. Todavía no tiene ningún módulo: responde a una
sola pregunta, si está en marcha.

Al final tendrás estos ficheros:

```
package.json                     cambia: `bun run monitor`
tsconfig.json                    cambia: hace referencia al proyecto del monitor
tsconfig.newt-monitor.json       el proyecto TypeScript del monitor
eslint.config.js                 cambia: el lint de newt sobre el monitor
packages/newt-monitor/
  package.json                   el paquete, y su comando
  bin/newt-monitor.ts            el comando: `bunx newt-monitor`
  src/
    config.ts                    su configuración, del entorno
    main.ts                      abre su contexto y lo sirve
    monitor-base.ts              lo que recibe cada uno de sus módulos
    monitor.test.ts              sus primeros tests
    contexts/monitor/
      monitor.context.ts         el contexto: su store, sus módulos, su servidor
      initialize-modules.ts      sus módulos: ninguno todavía
    testing/
      open-test-monitor.ts       el monitor, para un test
```

## El paquete

Un paquete propio, con un comando. Depende de newt como cualquier aplicación, por su
nombre, a través de los `exports` del paquete:

```json
// packages/newt-monitor/package.json
{
  "name": "newt-monitor",
  "version": "0.0.0",
  "description": "Watches newt applications: what each one is made of, read from it as it runs, never from its data. A newt application itself.",
  "type": "module",
  "bin": {
    "newt-monitor": "./bin/newt-monitor.ts"
  },
  "engines": {
    "bun": ">=1.4.0"
  },
  "dependencies": {
    "newt": "workspace:*",
    "zod": "4.3.6"
  }
}
```

El `package.json` del repositorio toma cada carpeta de `packages/` como un workspace,
así que `bun install` lo enlaza. El comando ejecuta `main`, y convierte lo que lo
detiene en una línea y un código de salida:

```ts
// packages/newt-monitor/bin/newt-monitor.ts
#!/usr/bin/env bun
import { main } from '../src/main'

try {
  await main(process.env)
} catch (error) {
  console.error(`newt-monitor: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
```

Su proyecto TypeScript es el de un backend, como el de cooper ([capítulo 1 del
tutorial](../guide/01-project-and-context)): `tsconfig.newt-monitor.json`, con `lib:
["ES2023"]`, `types: ["bun"]` y `strict`, incluido por el `tsconfig.json` de la raíz
entre sus `references`.

## El lint de newt

El monitor es una aplicación, así que el lint de newt lo mantiene en orden, con un
contexto que no usa ninguno:

```js
// newt-monitor is an application built with newt too, so it keeps the same lint.
const MONITOR = newt({
  files: ['packages/newt-monitor/**/*.ts'],
  contexts: { folder: 'packages/newt-monitor/src/contexts', uses: { monitor: [] } },
})
```

Los paquetes del propio framework se quedan fuera (`ignores`); este está dentro.

## Su configuración

El monitor lee su entorno una vez, al arrancar, y nada más lo lee: el contexto recibe
su config. Cada variable tiene un esquema; cualquiera que esté mal lo detiene antes de
que abra nada, nombrándolas todas:

```ts
// packages/newt-monitor/src/config.ts
import { z } from 'zod'

/** What the monitor is told by its environment, each variable with what it is for. */
const EnvSchema = z.object({
  /** Where it listens. */
  NEWT_MONITOR_PORT: z.coerce.number().int().min(0).max(65_535).default(4800),
  /** Its SQLite database: a file, made with its folder if missing, or `:memory:`. */
  NEWT_MONITOR_DATA: z.string().trim().min(1).default('data/newt-monitor.db'),
})
```

```ts
// packages/newt-monitor/src/config.ts
export function readConfig(env: Record<string, string | undefined>): MonitorConfig {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`it cannot start:\n  ${problems.join('\n  ')}`)
  }
  return { port: parsed.data.NEWT_MONITOR_PORT, database: parsed.data.NEWT_MONITOR_DATA }
}
```

Los capítulos siguientes añaden el usuario, la contraseña y el secreto: tres variables
sin valor por defecto, así que un monitor que nadie ha configurado no arranca.

## La base y el contexto

Cada módulo recibe la base. La del monitor funciona sobre SQLite, y lleva el router en
el que sus módulos registran sus rutas:

```ts
// packages/newt-monitor/src/monitor-base.ts
import type { SqliteStore } from 'newt/adapter-sqlite'
import { HttpRouter } from 'newt/http'
import { Base } from 'newt/runtime'

/**
 * What every module of the monitor receives: newt's base, on SQLite, with the router
 * its context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class MonitorBase extends Base<SqliteStore> {
  readonly http = new HttpRouter()
}
```

El contexto abre su store (creando la carpeta de la base de datos la primera vez), crea
su base e inicializa sus módulos. Dice cómo se sirve: la API de sus módulos bajo
`/api`, y `GET /api/health` sin sesión.

```ts
// packages/newt-monitor/src/contexts/monitor/monitor.context.ts
export class Monitor_Context extends BoundedContext<MonitorBase> {

  private constructor(base: MonitorBase, readonly modules: Monitor_Modules, private readonly config: MonitorConfig) {
    super('monitor', base)
  }

  static async open(config: MonitorConfig, clock?: Clock): Promise<Monitor_Context> {
    if (config.database !== ':memory:') await mkdir(dirname(config.database), { recursive: true })
    const store = await SqliteStore.open({ path: config.database })
    const base = new MonitorBase({ name: 'monitor', store, clock })
    return new Monitor_Context(base, initializeModules(base), config)
  }

  /** How it is served (`runContexts`): its modules' API under `/api`, and `GET /api/health` for whoever watches it is up. */
  serving(): ServeOptions {
    return { port: this.config.port, router: this.base.http, health: true }
  }
}
```

`initializeModules` todavía no tiene nada que inicializar: devuelve `{}`.

## Arrancarlo

`main` lo junta todo: la configuración, el contexto, y `runContexts`, que lo sirve,
arranca su worker, y detiene los dos ante un SIGINT o un SIGTERM:

```ts
// packages/newt-monitor/src/main.ts
export async function main(env: Record<string, string | undefined>): Promise<RunningContexts> {
  const config = readConfig(env)
  const monitor = await Monitor_Context.open(config)
  const app = runContexts([{ context: monitor, serve: monitor.serving() }])
  console.log(`newt-monitor listening on ${app.servers.monitor!.url}`)
  return app
}
```

## Tests

Todos los tests abren el monitor igual: su base de datos en memoria, en un puerto
libre. `openTestMonitor` lo hace una vez para todos, y crece con los capítulos:

```ts
// packages/newt-monitor/src/testing/open-test-monitor.ts
export async function openTestMonitor(options: TestMonitorOptions = {}) {
  const monitor = await Monitor_Context.open({ port: 0, database: ':memory:', ...options })
  const app = runContexts([{ context: monitor, serve: monitor.serving() }], { signals: false })
```

```ts
// packages/newt-monitor/src/monitor.test.ts
describe('its settings', () => {
  test('have what development needs by default', () => {
    expect(readConfig({})).toEqual({ port: 4800, database: 'data/newt-monitor.db' })
  })

  test('stop it before it starts, naming every variable that is wrong', () => {
    expect(() => readConfig({ NEWT_MONITOR_PORT: 'eighty', NEWT_MONITOR_DATA: ' ' })).toThrow(/NEWT_MONITOR_PORT[\s\S]*NEWT_MONITOR_DATA/)
  })
})
```

## Compruébalo

```sh
bun check
bun test packages/newt-monitor
bun run lint
bun run monitor
```

```
newt-monitor listening on http://localhost:4800/
```

```sh
curl -s localhost:4800/api/health
```

```json
{"status":"ok"}
```

## Qué recordar

- El monitor es una aplicación hecha con newt: un paquete propio, su proyecto
  TypeScript, el lint de newt, un contexto.
- El entorno se lee una vez, en `readConfig`; una variable que está mal lo detiene,
  nombrándolas todas. El contexto recibe su config.
- El contexto abre su store, su base y sus módulos, y dice cómo se sirve.

Siguiente: [iniciar sesión](./02-signing-in).
