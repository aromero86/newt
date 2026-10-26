# El proyecto y un contexto

Antes del primer tablero tiene que haber un sitio donde ponerlo. Este capítulo hace del
backend de cooper un proyecto del repositorio, con su propia configuración de
TypeScript y el lint de newt, y construye su primer **contexto**, `boards`: una parte de
la aplicación con sus propios datos, sus propios módulos y su propio servidor. Todavía
no tiene ningún módulo. Abre su store, se sirve en el puerto 3002 y contesta una
pregunta: ¿está en marcha?

Al final tendrás estos ficheros:

```
tsconfig.json              changed: it references the backend's project
tsconfig.backend.json      the backend's TypeScript project
eslint.config.js           changed: newt's lint on the backend
cooper/backend/
  config.ts                the settings, from environment variables
  index.ts                 opens boards and serves it
  shared/
    cooper-base.ts         what every module of cooper receives
    served-context.ts      a context that serves itself on its port
  contexts/boards/
    boards-base.ts         what every module of boards receives
    boards-config.ts       its settings
    boards.context.ts      the context: opens its store, its modules, its server
    initialize-modules.ts  its modules: none yet
    boards.context.test.ts its first test
```

## Un proyecto TypeScript para el backend

El repositorio se compone de proyectos TypeScript. En `tutorial/00` hay uno, el de
newt. El backend de cooper tiene el suyo: TypeScript plano para Bun, estricto, sin el
DOM. Crea `tsconfig.backend.json` en la raíz:

```json
{
  // cooper's backend, on Bun, with the framework it imports. No DOM. Apart from newt's
  // own project (tsconfig.newt.json), as an application has newt apart: what cooper
  // adds to newt's types (its Actor, shared/actor.ts) is cooper's only.
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true
  },
  "include": ["cooper/backend/**/*.ts"],
  "exclude": ["**/node_modules"]
}
```

Y haz que el `tsconfig.json` de la raíz lo referencie, junto al de newt:

```json
{
  // The whole repository, as its projects: the framework (newt) and what runs on the
  // server (cooper's backend). `bunx tsc -b` follows the references. newt is not among
  // any paths: it is a workspace package, reached through its `exports` as any
  // application reaches it.
  "files": [],
  "references": [
    { "path": "./tsconfig.newt.json" },
    { "path": "./tsconfig.backend.json" }
  ]
}
```

¿Por qué dos proyectos y no uno? Porque una aplicación amplía los tipos de newt. En el
capítulo [4](./04-who-and-where) cooper dice, una sola vez, qué más sabe de quien actúa
(si llegó por la web o por MCP), con un `declare module
'newt/core'`. Un `declare module` llega a todos los ficheros del proyecto en el que
está. En un solo proyecto con cooper, los tests del propio newt se comprobarían contra
las ampliaciones de cooper y fallarían por motivos que no son de newt. Comprobados por
separado, newt se comprueba tal como se distribuye, y cooper tal como lo usa.

Tampoco hay `paths`. newt es un paquete del workspace, y cooper llega a él por sus
`exports`, como una aplicación que lo hubiera instalado desde npm.

::: warning Aviso
newt usa los decoradores estándar de TypeScript (`@UseCase()`, en el capítulo
siguiente). **No** actives `experimentalDecorators`: cambia TypeScript a los
decoradores antiguos, no estándar, que no son aquellos para los que está escrito newt.
:::

## Lint: newt-eslint

El compilador comprueba tipos. No puede comprobar que un módulo esté montado como todos
los demás, ni que un contexto no se meta en otro. Para eso está `newt-eslint`. Sustituye
el `eslint.config.js` de la raíz:

```js
import { newt } from 'newt-eslint'

// cooper is an application built with newt: its backend keeps newt's lint. The
// framework's own code is not an application, so it is left out.

const BACKEND = newt({
  files: ['cooper/backend/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { boards: [] } },
})

export default [
  { ignores: ['packages/**', 'web/**', '**/dist/**'] },
  ...BACKEND,
]
```

`newt(options)` es el preset: sus reglas, el parser de TypeScript y los ficheros que
miran. `files` lo limita al backend. `contexts` dice dónde viven los contextos y cuáles
usa cada uno: por ahora hay uno, `boards`, y no usa ninguno. Un contexto que no figure,
o un ciclo, es un error en cuanto arranca el lint.

Estas son sus reglas. Conocerás cada una la primera vez que la rompas:

| Regla | Qué dice |
|---|---|
| `newt/module-anatomy` | Un módulo se compone de los ficheros que tiene todo módulo, con su nombre. |
| `newt/module-boundaries` | Un módulo llega a otro solo por sus casos de uso, su esquema, sus eventos, sus errores y sus value objects. |
| `newt/queue-name` | La cola de un worker lleva el nombre del caso de uso al que llama y del evento que escucha. |
| `newt/context-boundaries` | Un contexto importa solo los contextos que le da `uses`. |

El preset también rechaza una promesa sin `await`, y una `transaction` llamada dentro de
un módulo (un módulo guarda a través de su repositorio).

## Su configuración

Un contexto necesita saber dónde escuchar y dónde guardar sus datos. cooper lo lee todo
de variables de entorno, en un solo fichero, con lo que necesita el desarrollo por
defecto:

```ts
// cooper/backend/config.ts
import { isAbsolute, join } from 'node:path'

const root = join(import.meta.dir, '../..')

/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) ? path : join(root, path))

const env = process.env

/**
 * cooper's settings, from environment variables, with what development needs by
 * default. Each context has its own: where it listens and where its data lives.
 */
export const config = {
  /** The SaaS: workspaces' boards, columns and cards. */
  boards: {
    /** `COOPER_BOARDS_PORT`: where it listens. */
    port: Number(env.COOPER_BOARDS_PORT ?? 3002),
    /** `COOPER_BOARDS_FOLDER`: the folder of its files, for now (chapter 5 moves it to SQLite). */
    folder: fromRoot(env.COOPER_BOARDS_FOLDER ?? 'data/boards'),
  },
}

export type Config = typeof config
```

Bun carga `.env` por su cuenta, así que un fichero `.env` en la raíz basta para cambiar
cualquiera de ellos en tu máquina. `data/` ya está en el `.gitignore` del repositorio.

Cada contexto toma su parte, y nada más:

```ts
// cooper/backend/contexts/boards/boards-config.ts
import type { Config } from '../../config'

/** The settings of `boards`, from `config.ts`. */
export type Boards_Config = Config['boards']
```

Un contexto nunca lee `process.env` por sí mismo: recibe su configuración. Eso es lo
que permite a un test abrirlo en una carpeta propia y en cualquier puerto libre.

## La base: lo que recibe cada módulo

Cada módulo, al crearse, recibe la **base** de su contexto. newt te da `Base`, de
`newt/runtime`. En ella un módulo encuentra todo con lo que el framework lo ejecuta: el
`store` donde se guardan sus datos, las `invocations` de sus casos de uso, el `bus` de
eventos y los `jobs` de sus workers. Sus opciones son un `name` y un `store` (y alguna
más, que usarán capítulos posteriores).

Tu aplicación la amplía con lo que quiera darles a sus módulos. cooper les da un router,
donde cada módulo registra sus rutas:

```ts
// cooper/backend/shared/cooper-base.ts
import type { FileStore } from 'newt/adapter-files'
import { Base } from 'newt/runtime'
import { HttpRouter } from 'newt/http'

/**
 * What every module of cooper receives: newt's base, on plain files for now, with the
 * router its context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class CooperBase extends Base<FileStore> {
  readonly http = new HttpRouter()
}
```

- **`Base<FileStore>`** dice sobre qué store funcionan los módulos de cooper. Una base
  también puede ser `Base<Store>`, que dice que los módulos funcionan con **cualquier**
  store. Por ahora cooper guarda ficheros planos; el capítulo [5](./05-sqlite) cambia
  esta línea a SQLite.
- **`HttpRouter`**, de `newt/http`, guarda las rutas. Cada ruta que recibe cuelga de
  `/api`, y necesita a alguien con la sesión iniciada salvo que diga lo contrario (el
  capítulo siguiente).

Cada contexto puede ampliar la base compartida con lo que solo necesitan sus módulos.
`boards` todavía no necesita nada más, pero tiene su propia clase desde el principio,
para que sus módulos puedan decir que son módulos de `boards`:

```ts
// cooper/backend/contexts/boards/boards-base.ts
import { CooperBase } from '../../shared/cooper-base'

/** What every module of `boards` receives: cooper's base. */
export class BoardsBase extends CooperBase {
}
```

## Un contexto que se sirve a sí mismo

El `BoundedContext` de newt es un nombre y una base, con `start()` y `stop()`:
`start()` arranca el worker de sus trabajos, `stop()` espera a los trabajos en curso y
cierra su store. Cómo se sirve es cosa de la aplicación. Cada contexto de cooper se
sirve a sí mismo en un puerto propio, y esa parte es igual para todos, así que vive en
`shared/`:

```ts
// cooper/backend/shared/served-context.ts
import { BoundedContext } from 'newt/runtime'
import type { ServeOptions } from 'newt/http'
import type { CooperBase } from './cooper-base'

export type ServedContextConfig = {
  /** Where its server listens: 0 for any free port (tests). */
  port: number
}

/**
 * A context of cooper's: its own server, on its own port and, in production, its own
 * domain. It answers `GET /api/health` without a session, for whoever watches it is up.
 */
export abstract class ServedContext extends BoundedContext<CooperBase> {

  protected constructor(name: string, base: CooperBase, private readonly served: ServedContextConfig) {
    super(name, base)
  }

  /** How it is served (`serve`): its modules' API and its health. */
  serving(): ServeOptions {
    return { port: this.served.port, router: this.base.http, health: true }
  }
}
```

`serving()` no arranca un servidor: dice cómo se arranca uno. `serve(options)`, de
`newt/http`, convierte esas opciones en un `Bun.serve`: todas las rutas del router y,
con `health: true`, `GET /api/health`, que responde `{ "status": "ok" }` sin nadie con
la sesión iniciada (y un 503 cuando el servidor se está parando, para que un balanceador
deje de enviarle peticiones). Todo lo que lanza una ruta se convierte también ahí en una
respuesta, como enseña el capítulo [3](./03-pages-and-errors).

## El contexto

Un contexto abre su store, crea su base, inicializa sus módulos y sabe servirse. Primero,
la lista de sus módulos. Todavía no hay ninguno:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'

/** Every module of `boards`, each one after the modules it uses: none yet. */
export function initializeModules(base: BoardsBase, config: Boards_Config) {
  return {}
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

Lo que devuelve son los `modules` del contexto. Desde el capítulo siguiente,
`boards.modules.board.create(…)` es como un test, un script u otro contexto llama a un
caso de uso. `Boards_Modules` es su tipo, tomado de la función, así que crece con ella.

Después, el contexto en sí:

```ts
// cooper/backend/contexts/boards/boards.context.ts
import { FileStore } from 'newt/adapter-files'
import { ServedContext } from '../../shared/served-context'
import { BoardsBase } from './boards-base'
import type { Boards_Config } from './boards-config'
import { initializeModules, type Boards_Modules } from './initialize-modules'

/** The SaaS: each workspace's boards, their columns and cards. */
export class Boards_Context extends ServedContext {

  private constructor(base: BoardsBase, readonly modules: Boards_Modules, readonly config: Boards_Config) {
    super('boards', base, config)
  }

  static async open(config: Boards_Config): Promise<Boards_Context> {
    const store = await FileStore.open({ folder: config.folder })
    const base = new BoardsBase({ name: 'boards', store })
    const modules = initializeModules(base, config)
    return new Boards_Context(base, modules, config)
  }
}
```

- **El constructor es privado.** La única entrada es `open`, que es `async` porque
  abrir un store lo es.
- **`FileStore.open`**, de `newt/adapter-files`, es el más sencillo de los stores de
  newt: una carpeta por tabla, un fichero JSON por registro
  (`data/boards/board/<id>.json`), y transacciones mediante un fichero de diario, de
  una en una. Nada que instalar, y puedes leer lo que guarda con `cat`. Basta para los
  primeros capítulos; el capítulo [5](./05-sqlite) pasa `boards` a SQLite sin cambiar
  ningún módulo.
- **`config` se pasa a `super`** como el `ServedContextConfig`: tiene un `port`, que es
  todo lo que pide `ServedContext`.

## Arrancarlo

El programa que ejecuta el backend abre el contexto, arranca su worker y lo sirve:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. For now one context, boards, served on its port.
import { serve } from 'newt/http'
import { config } from './config'
import { Boards_Context } from './contexts/boards/boards.context'

const boards = await Boards_Context.open(config.boards)
boards.start()
const server = serve(boards.serving())
console.log(`boards listening on ${server.url}`)
```

Por ahora Ctrl+C lo para tal cual. Cuando cooper tenga tres contextos, el capítulo
[17](./17-auth) le pasará este fichero a `runContexts`, que además los para en orden.

## Su primer test

Los tests de cooper abren el contexto de verdad y lo usan como lo haría un cliente, sin
mocks del framework. Este abre `boards` en una carpeta temporal, lo sirve en un puerto
libre (`port: 0`), pide su salud y limpia:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from 'newt/http'
import { config } from '../../config'
import { Boards_Context } from './boards.context'

describe('boards, through its API', () => {
  let folder: string
  let boards: Boards_Context
  let server: Server<undefined>

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'cooper-boards-'))
    boards = await Boards_Context.open({ ...config.boards, folder, port: 0 })
    server = serve(boards.serving())
  })

  afterEach(async () => {
    await server.stop()
    await boards.stop()
    await rm(folder, { recursive: true, force: true })
  })

  test('answers its health without a session', async () => {
    const response = await fetch(new URL('/api/health', server.url))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})
```

El orden de `afterEach` importa: primero el servidor deja de aceptar peticiones, después
`boards.stop()` cierra el store y por último desaparece la carpeta.

## Compruébalo

Ejecuta la puerta:

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint
```

```
 1 pass
 0 fail
```

Después arranca el backend:

```sh
bun cooper/backend/index.ts
```

```
boards listening on http://localhost:3002/
```

Y, desde otra terminal, pregúntale si está en marcha:

```sh
curl -s localhost:3002/api/health
```

```json
{"status":"ok"}
```

## Qué recordar

- El backend de cooper es un proyecto TypeScript propio, aparte del de newt, e importa
  newt por su nombre, a través de los `exports` del paquete. Decoradores estándar:
  nunca `experimentalDecorators`.
- El preset de newt-eslint hace el lint del backend; `contexts.uses` es la forma de la
  aplicación, y crece con cada contexto.
- La base es lo que recibe cada módulo. Amplía la `Base` de newt con lo que necesiten
  tus módulos (cooper: un router), tipada con el store sobre el que funcionan.
- Un contexto abre su store, crea su base e inicializa sus módulos. Recibe su
  configuración; nunca lee el entorno.
- `serve(context.serving())` lo sirve; `health: true` contesta `GET /api/health` sin
  sesión.

Siguiente: [el primer módulo, boards](./02-first-module).
