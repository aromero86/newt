# De ficheros a SQLite

`boards` guarda cada tablero como un fichero JSON. Bastaba para aprender módulos,
casos de uso y ámbitos, pero una carpeta de ficheros no es una base de datos: cada
listado lee la carpeta entera, y las reglas de los próximos capítulos (un nombre de
tablero único en su espacio de trabajo, diez columnas como máximo) necesitan una base
de datos que también pueda decirlas.

En este capítulo `boards` pasa a SQLite. Fíjate en lo que cambia: el contexto abre un
store distinto, y las tablas se escriben ahora como migraciones SQL. Fíjate también en
lo que no cambia: ningún módulo, ningún repositorio, ningún caso de uso, ninguna ruta.
Los tests se ejecutan exactamente igual que antes.

## El store es un puerto

Todos los repositorios que has escrito hablan con `base.store.table<Row>(name)`, el
puerto de tablas de newt, nunca con una base de datos. Un `FileStore` y un
`SqliteStore` lo responden los dos: los mismos `find`, `count`, `page` y guardados,
los mismos criterios (`{ name: { ieq: … } }`, `{ id: { ne: … } }`), las mismas
transacciones, las mismas versiones. El capítulo 27 añade Postgres y MySQL detrás del
mismo puerto.

Así que la elección del store se hace en un solo sitio, el `open` del contexto, y el
tipo del store en otro, `CooperBase`. Los módulos nunca llegan a saber sobre cuál se
ejecutan.

## Migraciones

Una base de datos tiene una forma, y la forma cambia con la aplicación: una tabla para
un módulo nuevo, una columna para un campo nuevo, un índice para una regla nueva. Las
**migraciones** son esos cambios, aplicados en orden y recordados por el store.

Para SQLite, una migración es una pareja de ficheros SQL en una carpeta:
`000NN_<name>_up.sql`, el cambio, y `000NN_<name>_down.sql`, cómo deshacerlo. Los
cinco dígitos los ordenan. Cada contexto tiene su propia carpeta, junto a su fichero de
contexto; cooper las guarda en `migrations/sqlite`, porque el capítulo 27 añade una
carpeta por base de datos.

La primera migración de `boards` crea la tabla `board`:

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00001_board_up.sql
-- Each workspace's boards. Like every row of boards', it says its workspace (an auth
-- tenant), by id and without a foreign key: the workspace is another context's, and
-- the repositories see only the rows of the current one.

-- An archived board keeps its row (`deleted_at` set): its name is free again.
CREATE TABLE board (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL
);
-- A name is a workspace's once, whatever its case (A to Z, as `lower` and `ieq` compare).
CREATE UNIQUE INDEX board_name ON board (workspace_id, lower(name)) WHERE deleted_at IS NULL;
```

La tabla es la fila que el repositorio ya escribe: `BoardRow`, el DTO del tablero más
`version` y `deletedAt`. Cada campo es una columna con nombre en snake case
(`workspaceId` es `workspace_id`). La tabla de una entidad siempre tiene
`id TEXT PRIMARY KEY` y `version INTEGER NOT NULL`, que cada guardado comprueba y
avanza. Las fechas son texto ISO.

`workspace_id` no tiene clave foránea: el espacio de trabajo es de `auth`, en otra
base de datos. El ámbito del repositorio (capítulo 4) es lo que mantiene separadas las
filas de cada espacio de trabajo.

La última línea es un índice único sobre el nombre, sea cual sea su capitalización,
entre los tableros no archivados. Todavía nada usa esa regla; el próximo capítulo lo
hace. Está aquí desde el principio porque una migración aplicada no debe cambiar nunca,
como verás más abajo.

El fichero down la deshace:

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00001_board_down.sql
DROP TABLE board;
```

## Abrir SQLite

`SqliteStore.open`, de `newt/adapter-sqlite`, recibe la ruta de la base de datos
(`path`) y la carpeta de `migrations`. Antes de devolver, aplica las migraciones que
aún no ha ejecutado, en orden, todas o ninguna, y después las propias de newt (las
tablas de sus jobs, que usan capítulos posteriores). Un contexto nunca arranca sobre
una forma antigua, y un test obtiene las mismas tablas que producción.

```ts
// cooper/backend/contexts/boards/boards.context.ts
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import { ServedContext } from '../../shared/served-context'
import { BoardsBase } from './boards-base'
import type { Boards_Config } from './boards-config'
import { initializeModules, type Boards_ModuleDeps, type Boards_Modules } from './initialize-modules'

/**
 * The SaaS: each workspace's boards, their columns and cards. Its people belong to
 * workspaces that `auth` keeps: `boards` asks it through ports it is handed when it opens.
 */
export class Boards_Context extends ServedContext {

  private constructor(base: BoardsBase, readonly modules: Boards_Modules, readonly config: Boards_Config) {
    super('boards', base, config)
  }

  static async open(config: Boards_Config, deps: Boards_ModuleDeps): Promise<Boards_Context> {
    // Brought up to date as it opens: the migrations it has not run yet, in order.
    const store = await SqliteStore.open({ path: config.database, migrations: join(import.meta.dir, 'migrations', 'sqlite') })
    const base = new BoardsBase({ name: 'boards', store })
    const modules = initializeModules(base, config, deps)
    return new Boards_Context(base, modules, config)
  }
}
```

Lo que te da SQLite, en palabras de newt:

- **Las transacciones se ejecutan de una en una**, en el orden en que lo piden, sobre
  una conexión que escribe. Las lecturas fuera de ellas van a una segunda conexión, de
  solo lectura, que ve solo lo confirmado.
- **`:memory:`** es una base de datos que vive lo que vive el store: un fichero
  temporal, que se borra al cerrar. Los tests la usan, con exactamente la semántica de
  un fichero en disco.

`CooperBase` dice qué store tiene su base, así que `base.store` está tipado como
`SqliteStore` en todas partes:

```ts
// cooper/backend/shared/cooper-base.ts
import type { SqliteStore } from 'newt/adapter-sqlite'
import { Base } from 'newt/runtime'
import { HttpRouter } from 'newt/http'
import './actor'

/**
 * What every module of cooper receives: newt's base, on SQLite, with the
 * router its context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class CooperBase extends Base<SqliteStore> {
  readonly http = new HttpRouter()
}
```

## La configuración

El ajuste de la carpeta pasa a ser `database`, leído de `COOPER_BOARDS_DATABASE`, un
fichero SQLite bajo `data/` por defecto. `fromRoot` deja `:memory:` tal cual, así que
un test puede pasarlo por el mismo ajuste:

```ts
// cooper/backend/config.ts
import { isAbsolute, join } from 'node:path'

const root = join(import.meta.dir, '../..')

/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) || path === ':memory:' ? path : join(root, path))

const env = process.env

/**
 * cooper's settings, from environment variables, with what development needs by
 * default. Each context has its own: where it listens and where its database lives.
 */
export const config = {
  /** The SaaS: workspaces' boards, columns and cards. */
  boards: {
    /** `COOPER_BOARDS_PORT`: where it listens. */
    port: Number(env.COOPER_BOARDS_PORT ?? 3002),
    /** `COOPER_BOARDS_DATABASE`: its database, a SQLite file. */
    database: fromRoot(env.COOPER_BOARDS_DATABASE ?? 'data/cooper-boards.db'),
  },
}

export type Config = typeof config
```

`Boards_Config` es `Config['boards']`, así que se actualiza solo.

## Tests en memoria

`openTestBoards` ya no crea una carpeta ni la borra: cada test abre su propia base de
datos en memoria, y desaparece cuando el contexto se detiene.

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
import { runAsActor } from 'newt/core'
import { config } from '../../../config'
import type { ActorVia } from '../../../shared/actor'
import { Boards_Context } from '../boards.context'
import { inWorkspace } from '../workspace-scope'
import { FakeAuth } from './fake-auth'

/**
 * `boards` for a test: its database in memory, a fake auth behind its ports, and who
 * sends a request told by an `x-user` header.
 */
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const boards = await Boards_Context.open({ ...config.boards, database: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
  })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId, via: 'web' as const } : null
  })
  return {
    auth,
    boards,
    modules: boards.modules,
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` does. */
    as<T>(userId: string, workspaceId: string, fn: () => Promise<T>, via: ActorVia = 'web'): Promise<T> {
      return runAsActor({ userId, via }, () => inWorkspace(boards.modules.member, workspaceId, fn))
    },
    async close(): Promise<void> {
      await boards.stop()
    },
  }
}

export type TestBoards = Awaited<ReturnType<typeof openTestBoards>>
```

`board.test.ts` no cambia en absoluto. En `boards.context.test.ts`, un test miraba el
fichero del tablero. Ahora no hay fichero, así que esa línea se va, y el nombre del
test dice menos:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
  test('keeps a board, and gives it back', async () => {
    const board = await call<{ id: string, name: string }>('POST', '/acme/boards', { name: 'Roadmap' })
    expect(board).toMatchObject({ status: 201, body: { name: 'Roadmap', description: '' } })
    const id = board.body.id

    expect((await call('PATCH', `/acme/boards/${id}`, { name: 'Plans' })).body).toMatchObject({ name: 'Plans' })
// …
```

## Una migración aplicada no cambia nunca

El store recuerda cada migración que aplicó, con un **checksum** (suma de
comprobación) de su fichero up. Al abrir, las vuelve a comprobar, y se niega a abrir si
alguna aplicada ha cambiado desde entonces. Una migración cambiada dejaría dos bases de
datos con formas distintas bajo el mismo número: la tuya, migrada con el fichero
antiguo, y una nueva, migrada con el fichero nuevo.

Así que un cambio en la forma es siempre una migración **nueva** (`00002_…`). Antes de
compartir una migración con nadie, también puedes deshacerla (`down`), cambiarla y
aplicarla de nuevo; el capítulo 27 enseña los comandos.

Un test mantiene esa promesa a la vista. Añade los imports que necesita al principio de
`boards.context.test.ts`:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
import { serve } from 'newt/http'
// …
```

Y añade este `describe` al final del fichero. Copia las migraciones a una carpeta
temporal, abre una base de datos con ellas, añade un índice a la migración aplicada, y
la abre otra vez:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
// …
describe('boards\' migrations', () => {
  test('are checked as the store opens: one changed after it was applied is refused', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'cooper-migrations-'))
    try {
      const migrations = join(folder, 'sqlite')
      await cp(join(import.meta.dir, 'migrations', 'sqlite'), migrations, { recursive: true })
      const path = join(folder, 'boards.db')
      await (await SqliteStore.open({ path, migrations })).close()

      const board = join(migrations, '00001_board_up.sql')
      await Bun.write(board, `${await Bun.file(board).text()}\nCREATE INDEX board_description ON board (description);\n`)

      await expect(SqliteStore.open({ path, migrations })).rejects.toThrow('Migration 00001_board was changed after it was applied')
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})
```

## Lo que no cambió

No se tocó nada bajo `modules/`. Pregúntaselo a git, comparando el punto de control de
este capítulo con el anterior:

```sh
git diff --stat tutorial/04 tutorial/05 -- cooper/backend/contexts/boards/modules
```

No imprime nada. `Board_Repository` sigue diciendo `base.store.table<BoardRow>('board')`,
y el ámbito, el borrado lógico, las páginas y las versiones se comportan como lo
hacían con ficheros. Eso es lo que compra un puerto: el store es una decisión del
contexto, tomada en una línea, y los módulos se escriben una sola vez.

## Compruébalo

```sh
bun install && bun check && bun test cooper && bun run lint
```

Los tests que pasaban con ficheros pasan con SQLite, sin cambios. Ahora mira cómo se
niega el checksum, a mano. Arranca el servidor, crea un tablero y páralo:

```sh
bun cooper/backend/index.ts
curl -X POST -H 'x-user: ana' -H 'content-type: application/json' -d '{"name":"Roadmap"}' localhost:3002/api/workspaces/acme/boards
# {"id":"01a1…","workspaceId":"acme","name":"Roadmap",…}
```

La base de datos es `data/cooper-boards.db`. Añade una línea a la migración que se
aplicó:

```sh
echo 'CREATE INDEX board_description ON board (description);' >> cooper/backend/contexts/boards/migrations/sqlite/00001_board_up.sql
bun cooper/backend/index.ts
# error: Migration 00001_board was changed after it was applied: put its up file back as it was, and make the change a new migration
```

El store se niega a abrir, y el servidor nunca arranca. Quita la línea que añadiste,
arráncalo otra vez, y el tablero sigue ahí:

```sh
bun cooper/backend/index.ts
curl -H 'x-user: ana' localhost:3002/api/workspaces/acme/boards
# {"items":[{"id":"01a1…","workspaceId":"acme","name":"Roadmap",…}],"hasMore":false,"total":1}
```

## Qué recordar

- El store es un puerto. El contexto lo elige en su `open`, `CooperBase` nombra su
  tipo, y ningún módulo, repositorio o caso de uso cambia cuando lo haces.
- La forma de SQLite son migraciones SQL, `000NN_<name>_up.sql` y `_down.sql`, una
  carpeta por contexto. Abrir el store aplica las pendientes, así que un contexto nunca
  arranca sobre una forma antigua.
- Una migración aplicada no cambia nunca: el store guarda su checksum y se niega a
  abrir. Un cambio es una migración nueva.
- Los tests abren `:memory:`: una base de datos propia, con la misma semántica, que
  desaparece cuando el contexto se detiene.

Siguiente: [Reglas sobre filas](./06-rules-over-rows).
