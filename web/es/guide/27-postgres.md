# Postgres, MySQL y migraciones en producción

cooper corre sobre SQLite: un fichero por contexto, nada que instalar, transacciones
de una en una. Eso lleva muy lejos a una sola máquina. Deja de bastar cuando quieres
dos servidores sobre los mismos datos, o una base de datos que otro ejecuta y respalda
por ti. Entonces cada contexto necesita un servidor de base de datos.

En este capítulo cada contexto aprende a abrir Postgres cuando su dirección lo dice, y
SQLite en caso contrario. Fíjate en lo que cambia: una función que abre un store, un
segundo juego de migraciones y un script que las ejecuta a mano. Fíjate también en lo
que no cambia: ningún módulo, ningún repositorio, ningún caso de uso, ninguna ruta,
ningún test de los capítulos anteriores.

Lo que añades:

```text
cooper/
  backend/
    config.ts                         changed: COOPER_<CTX>_DATABASE may be a Postgres address
    shared/
      open-store.ts                   new: openStore and connectStore
      cooper-base.ts                  changed: Base<CooperStore>
      analytics/sql-analytics.ts      changed: reads a JSON field on either database
      analytics/migrations/postgres/  new
      web-session/migrations/postgres/ new
    contexts/
      auth/auth.context.ts            changed: openStore
      auth/migrations/postgres/       new
      boards/boards.context.ts        changed: openStore
      boards/boards-base.ts           changed: its doc
      boards/migrations/postgres/     new
      backoffice/backoffice.context.ts changed: openStore
      backoffice/migrations/postgres/ new
    postgres.test.ts                  new: skipped without COOPER_TEST_POSTGRES_URL
  scripts/
    migrations.ts                     new: bun run cooper:migrations
package.json                          changed: cooper:migrations
```

## El store es un puerto, otra vez

El capítulo [5](./05-sqlite) pasó boards de ficheros a SQLite y no cambió ningún
módulo. Todos los repositorios hablan con `base.store.table<Row>(name)`, el puerto de
tablas de newt, y un `SqliteStore` lo responde igual que lo hacía un `FileStore`. Un
`PostgresStore`, de `newt/adapter-postgres`, también lo responde: los mismos `find`,
`count`, `page` y guardados, los mismos criterios, las mismas transacciones y
versiones. Kysely (capítulo [15](./15-kysely)) corre sobre él igual que sobre SQLite,
con `kyselyFor(store)`.

Así que la elección se sigue haciendo en un solo sitio, el `open` del contexto. Lo
nuevo es que cooper la hace en tiempo de ejecución, a partir de la dirección de la base
de datos del contexto. Eso es una función, en `shared/`:

```ts
// cooper/backend/shared/open-store.ts
import { join } from 'node:path'
import { PostgresStore } from 'newt/adapter-postgres'
import { SqliteStore } from 'newt/adapter-sqlite'

/** A store cooper runs on: SQLite, or Postgres. */
export type CooperStore = SqliteStore | PostgresStore

/** Whether a context's database is a Postgres server, by its address. */
const isPostgres = (database: string) => /^postgres(ql)?:\/\//.test(database)

/**
 * A context's store, by where its database is (`COOPER_<CONTEXT>_DATABASE`): a
 * `postgres://` address is Postgres, with the context's `migrations/postgres`; anything
 * else is a SQLite file (or `:memory:`), with its `migrations/sqlite`. Brought up to
 * date as it opens. MySQL would be one more line: `MySqlStore`, and its own folder.
 */
export function openStore(database: string, migrations: string): Promise<CooperStore> {
  return isPostgres(database)
    ? PostgresStore.open({ url: database, migrations: join(migrations, 'postgres') })
    : SqliteStore.open({ path: database, migrations: join(migrations, 'sqlite') })
}

/** The same store as it is, migrating nothing: for the script that migrates it. */
export function connectStore(database: string, migrations: string): Promise<CooperStore> {
  return isPostgres(database)
    ? PostgresStore.connect({ url: database, migrations: join(migrations, 'postgres') })
    : SqliteStore.connect({ path: database, migrations: join(migrations, 'sqlite') })
}
```

- **`openStore`** abre el store y lo pone al día: aplica las migraciones que aún no ha
  ejecutado, en orden, antes de que ningún módulo lo lea. Cada adaptador tiene su
  propio `open`: `SqliteStore.open({ path, migrations })`,
  `PostgresStore.open({ url, migrations })`.
- **`connectStore`** abre el mismo store tal como está, sin migrar nada. Solo lo usa el
  script de migraciones de más abajo.
- El contexto pasa su carpeta `migrations`; `openStore` añade la subcarpeta del dialecto
  de la base de datos. Por eso, desde el capítulo 5, cooper guarda las migraciones de
  SQLite bajo `migrations/sqlite`.

`PostgresStore` está construido sobre `Bun.SQL`: no hay ningún driver que instalar.
Mantiene un pool de conexiones (`connections`, 10 por defecto); cada transacción
retiene una hasta que termina.

`CooperStore` es el tipo que ahora lleva la base de cada módulo. Cambia `CooperBase`
para que lo use:

```ts
// cooper/backend/shared/cooper-base.ts
import { Base } from 'newt/runtime'
import { HttpRouter } from 'newt/http'
import type { CooperStore } from './open-store'
import './actor'

/**
 * What every module of cooper receives: newt's base, on SQLite or Postgres, with the
 * router its context serves, where each module registers its routes (`<m>.routes.ts`).
 */
export class CooperBase extends Base<CooperStore> {
  readonly http = new HttpRouter()
}
```

La base de boards dice por qué es un store SQL; su doc ahora nombra Postgres:

```ts
// cooper/backend/contexts/boards/boards-base.ts
/**
 * What every module of `boards` receives: cooper's base, and Kysely on its store, for
 * the queries a table cannot say (cards counted by workspace and by board). Kysely
 * needs a SQL store: `boards` opens on SQLite or Postgres, and would open on MySQL the
 * same way, never on files.
 */
```

### Cada contexto abre a través de ella

El `open` de cada contexto llamaba a `SqliteStore.open` con su carpeta
`migrations/sqlite`. Ahora llama a `openStore` con su carpeta `migrations`. En
`boards.context.ts`, sustituye el import de `SqliteStore` por el de `openStore`, y la
línea que abría el store (y el comentario de encima, que ahora lo dice el doc de
`openStore`):

```ts
// cooper/backend/contexts/boards/boards.context.ts
import { join } from 'node:path'
import type { Clock } from 'newt/core'
import { openStore } from '../../shared/open-store'
import { ServedContext } from '../../shared/served-context'
// …
  static async open(config: Boards_Config, deps: Boards_ModuleDeps, clock?: Clock): Promise<Boards_Context> {
    const store = await openStore(config.database, join(import.meta.dir, 'migrations'))
    const base = new BoardsBase({ name: 'boards', store, clock })
```

Lo mismo en auth:

```ts
// cooper/backend/contexts/auth/auth.context.ts
import { join } from 'node:path'
import type { Clock } from 'newt/core'
import { openStore } from '../../shared/open-store'
import { ServedContext } from '../../shared/served-context'
// …
  static async open(config: Auth_Config, deps: Auth_ModuleDeps, clock?: Clock): Promise<Auth_Context> {
    const store = await openStore(config.database, join(import.meta.dir, 'migrations'))
    const base = new AuthBase({ name: 'auth', store, clock })
```

Y en el backoffice:

```ts
// cooper/backend/contexts/backoffice/backoffice.context.ts
import { join } from 'node:path'
import type { Clock } from 'newt/core'
import { CooperBase } from '../../shared/cooper-base'
import { openStore } from '../../shared/open-store'
import { ServedContext } from '../../shared/served-context'
// …
  static async open(config: Backoffice_Config, deps: Backoffice_ModuleDeps, clock?: Clock): Promise<Backoffice_Context> {
    const store = await openStore(config.database, join(import.meta.dir, 'migrations'))
    const base = new CooperBase({ name: 'backoffice', store, clock })
```

### La dirección viene de la configuración

`COOPER_<CONTEXT>_DATABASE` era un fichero SQLite, relativo a la raíz del repositorio.
Ahora también puede ser una dirección de Postgres, que no debe convertirse en una ruta.
Añade el helper `database` a `config.ts`, después de `fromRoot`:

```ts
// cooper/backend/config.ts
/** A path from the environment: relative ones are relative to the repository root. */
const fromRoot = (path: string) => (isAbsolute(path) || path === ':memory:' ? path : join(root, path))

/**
 * A context's database from the environment: a Postgres address
 * (`postgres://user:password@host:5432/db`) as it is, or a SQLite file, relative to
 * the repository root.
 */
const database = (value: string) => (/^postgres(ql)?:\/\//.test(value) ? value : fromRoot(value))
```

y úsalo, con su doc, en cada uno de los tres contextos:

```ts
// cooper/backend/config.ts
// …
    /** `COOPER_AUTH_DATABASE`: its database, a SQLite file or a Postgres address. */
    database: database(env.COOPER_AUTH_DATABASE ?? 'data/cooper-auth.db'),
// …
    /** `COOPER_BOARDS_DATABASE`: its database, a SQLite file or a Postgres address. */
    database: database(env.COOPER_BOARDS_DATABASE ?? 'data/cooper-boards.db'),
// …
    /** `COOPER_BACKOFFICE_DATABASE`: its database, a SQLite file or a Postgres address. */
    database: database(env.COOPER_BACKOFFICE_DATABASE ?? 'data/cooper-backoffice.db'),
```

Cada contexto elige por su cuenta. auth puede correr sobre Postgres mientras boards
sigue en un fichero SQLite: no comparten base de datos, como nunca lo hicieron.

## Migraciones por dialecto

Una migración es SQL, y SQL es un dialecto. Así que cada base de datos tiene su propia
carpeta con las mismas parejas de ficheros, `000NN_<name>_up.sql` y
`000NN_<name>_down.sql`, con los mismos números y nombres:
`migrations/sqlite/00001_board_up.sql` y `migrations/postgres/00001_board_up.sql` son
el mismo cambio, cada uno en sus propias palabras. El store aplica las de su carpeta,
en orden, y las recuerda, como hacía el de SQLite.

En Postgres, un lote de migraciones se ejecuta en una sola transacción: se aplica
entero o no se aplica. Dos procesos que migran a la vez se turnan (un bloqueo
consultivo), y el segundo encuentra aplicadas las migraciones del primero.

### Qué difiere

La mayor parte de una gemela es el fichero de SQLite con tres tipos de cambios:

- **El texto es `TEXT COLLATE "C"`.** SQLite compara y ordena el texto por punto de
  código. Una base de datos Postgres suele comparar con las reglas de un idioma, donde
  `Ana`, `bea`, `Bob` es el orden. `COLLATE "C"` hace que cada columna de texto compare
  como en SQLite (y como los demás stores), y sus índices sirven ese orden. Sin él, la
  misma página de tableros volvería en un orden distinto en cada base de datos.
- **Los booleanos son `BOOLEAN`.** SQLite guarda un booleano como `INTEGER`, 0 o 1.
  Postgres tiene el tipo, y la tabla lo lee y lo escribe como `true` y `false`.
- **El JSON es `JSONB`.** SQLite guarda el JSON como `TEXT`. Postgres tiene un tipo
  JSON.

El resto es el mismo SQL: las tablas, los índices únicos parciales
(`WHERE deleted_at IS NULL`), `lower(name)` para un nombre único sea cual sea su
capitalización. Donde SQLite tiene una función que Postgres no tiene, la gemela usa la
estándar (`coalesce` por `ifnull`).

### Las migraciones de boards

La primera migración de boards, con cada columna de texto `COLLATE "C"`. El comentario
del índice dice por qué `lower` sigue plegando solo de la A a la Z, como `ieq`: es
`lower` de una columna `"C"`.

```sql
-- cooper/backend/contexts/boards/migrations/postgres/00001_board_up.sql
-- Each workspace's boards. Like every row of boards', it says its workspace (an auth
-- tenant), by id and without a foreign key: the workspace is another context's, and
-- the repositories see only the rows of the current one.

-- An archived board keeps its row (`deleted_at` set): its name is free again.
CREATE TABLE board (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  name TEXT COLLATE "C" NOT NULL,
  description TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  deleted_at TEXT COLLATE "C",
  version INTEGER NOT NULL
);
-- A name is a workspace's once, whatever its case (A to Z: `lower` of a "C" column, as `ieq` compares).
CREATE UNIQUE INDEX board_name ON board (workspace_id, lower(name)) WHERE deleted_at IS NULL;
```

Sus columnas, sus tarjetas y contadores, y las claves de idempotencia del capítulo
[9](./09-idempotent-posts) cambian solo en su collation:

```sql
-- cooper/backend/contexts/boards/migrations/postgres/00002_column_up.sql
-- Each board's columns, from the left.
-- "column" is a word of SQL's: quoted, it is a table's name like any other.
CREATE TABLE "column" (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  board_id TEXT COLLATE "C" NOT NULL,
  name TEXT COLLATE "C" NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX column_board ON "column" (workspace_id, board_id, position);
```

```sql
-- cooper/backend/contexts/boards/migrations/postgres/00003_card_up.sql
-- A card points at its board, its column and the member it is assigned to by id: the
-- column is another module's, the member another context's.
CREATE TABLE card (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  board_id TEXT COLLATE "C" NOT NULL,
  column_id TEXT COLLATE "C" NOT NULL,
  number INTEGER NOT NULL,
  title TEXT COLLATE "C" NOT NULL,
  description TEXT COLLATE "C" NOT NULL,
  assignee_id TEXT COLLATE "C",
  position INTEGER NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
-- #1, #2…: a number is its board's once.
CREATE UNIQUE INDEX card_number ON card (board_id, number);
CREATE INDEX card_column ON card (workspace_id, column_id, position);
CREATE INDEX card_assignee ON card (workspace_id, assignee_id);

-- The last number each board gave a card, so a deleted card's number is never given
-- again: cards are deleted for good, and the highest one left is not the last one
-- given. Its id is the board's.
CREATE TABLE card_counter (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  last_number INTEGER NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX card_counter_workspace ON card_counter (workspace_id);
```

```sql
-- cooper/backend/contexts/boards/migrations/postgres/00004_idempotency_key_up.sql
-- The first answer to each POST sent with an `Idempotency-Key`, as newt/http keeps it
-- (`KeptAnswer`): its id is the key's hash, with who sent it and where, and the
-- hash of the body it answered. The index is how the forgotten ones are removed.
CREATE TABLE idempotency_key (
  id TEXT COLLATE "C" PRIMARY KEY,
  version INTEGER NOT NULL,
  body_hash TEXT COLLATE "C" NOT NULL,
  status INTEGER NOT NULL,
  headers TEXT COLLATE "C" NOT NULL,
  body TEXT COLLATE "C" NOT NULL,
  expires_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX idempotency_key_expires_at ON idempotency_key (expires_at);
```

La actividad del capítulo [11](./11-reacting) guarda el `detail` de cada cambio como
JSON, así que en Postgres es `JSONB`:

```sql
-- cooper/backend/contexts/boards/migrations/postgres/00005_activity_up.sql
-- Each card's activity: one row for each thing that happened to it, by the id of the
-- event that told it. Rows are only ever added, never changed; a card deleted keeps
-- its history. Who did it is a user of auth's, by id; null when boards did it itself.
CREATE TABLE activity (
  id TEXT COLLATE "C" PRIMARY KEY,
  workspace_id TEXT COLLATE "C" NOT NULL,
  board_id TEXT COLLATE "C" NOT NULL,
  card_id TEXT COLLATE "C" NOT NULL,
  kind TEXT COLLATE "C" NOT NULL,
  actor_id TEXT COLLATE "C",
  via TEXT COLLATE "C",
  at TEXT COLLATE "C" NOT NULL,
  detail JSONB NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
-- A card's activity, the newest first (ids are v7: in the order they were told).
CREATE INDEX activity_card ON activity (workspace_id, card_id, id);
```

Y la tabla de las sesiones web, que boards copió de `shared/web-session` en el
capítulo [22](./22-web-session):

```sql
-- cooper/backend/contexts/boards/migrations/postgres/00006_session_up.sql
-- A context's web sessions (shared/web-session): each context that signs its people in
-- through auth copies this migration into its own, numbered after the ones it has.
-- Only the hash of each token: a copy of the database opens nothing.
CREATE TABLE session (
  id TEXT COLLATE "C" PRIMARY KEY,
  user_id TEXT COLLATE "C" NOT NULL,
  token_hash TEXT COLLATE "C" NOT NULL UNIQUE,
  expires_at TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX session_user_id ON session (user_id);
```

Cada fichero down es igual que el de SQLite, palabra por palabra: un `DROP TABLE` (dos,
en orden inverso, para `00003_card`). Cópialos:

```sh
for f in cooper/backend/contexts/boards/migrations/sqlite/*_down.sql; do
  cp "$f" cooper/backend/contexts/boards/migrations/postgres/
done
```

### Las migraciones de los otros contextos

Las nueve de auth, las dos del backoffice y las dos compartidas (sesiones web,
analytics) son el mismo trabajo, línea por línea: cópialas del punto de control.

```sh
git checkout tutorial/27 -- \
  cooper/backend/contexts/auth/migrations/postgres \
  cooper/backend/contexts/backoffice/migrations/postgres \
  cooper/backend/shared/web-session/migrations/postgres \
  cooper/backend/shared/analytics/migrations/postgres
```

Lee los tres sitios donde son algo más que una collation. Las redirect URIs de un
cliente OAuth son una lista JSON:

```sql
-- cooper/backend/contexts/auth/migrations/postgres/00007_oauth-client_up.sql
-- …
  redirect_uris JSONB NOT NULL,
-- …
```

Una concesión (grant) dice si su cliente es de primera parte:

```sql
-- cooper/backend/contexts/auth/migrations/postgres/00008_oauth-grant_up.sql
-- …
  first_party BOOLEAN NOT NULL,
-- …
```

Y un acceso es único por persona, producto e inquilino, con un inquilino nulo contado
como un valor:

```sql
-- cooper/backend/contexts/auth/migrations/postgres/00005_access-once_up.sql
-- One access per person, product and tenant: two saves giving the same one at once
-- cannot both succeed. A null tenant (the whole product) counts as a value, so the
-- staff's access is kept once too.
CREATE UNIQUE INDEX access_once ON access (user_id, product_id, coalesce(tenant_id, ''));
```

### Checksums, en las dos

El capítulo [5](./05-sqlite) lo dijo: una migración aplicada no cambia nunca. Postgres
lo mantiene igual. El store registra un checksum de cada fichero up que aplicó, y se
niega a abrir en cuanto uno de ellos ha cambiado. Cambia `00001_board_up.sql` después
de que se ejecutara, y abrir boards falla con:

```text
Error: Migration 00001_board was changed after it was applied: put its up file back as it was, and make the change a new migration
```

`status`, en el script de más abajo, nombra esa migración en vez de fallar.

Las gemelas no son una excepción. Una corrección a una migración de Postgres que ya se
ejecutó en algún sitio es una migración nueva, en las dos carpetas, con el mismo
número.

## Analytics en cualquiera de las dos bases de datos

`SqlAnalytics` (capítulo [26](./26-dead-jobs-and-analytics)) guarda las filas de cada
dataset como texto JSON en `analytics_row`, y las cuenta por un campo con Kysely.
Kysely escribe la misma consulta en las dos bases de datos, salvo en una cosa: cómo
leer un campo del JSON. SQLite dice `json_extract(data, '$.field')`, Postgres
`data::jsonb ->> 'field'`.

Importa ahora `SqliteStore` como valor (se comprueba con `instanceof`), y el tipo de
`PostgresStore`:

```ts
// cooper/backend/shared/analytics/sql-analytics.ts
import { sql, type RawBuilder } from 'kysely'
import { SqliteStore } from 'newt/adapter-sqlite'
import type { PostgresStore } from 'newt/adapter-postgres'
import { kyselyFor } from 'newt/kysely'
```

El doc de la clase nombra las dos bases de datos y la carpeta de cada una:

```ts
// cooper/backend/shared/analytics/sql-analytics.ts
/**
 * newt's analytics port on the context's own SQL database, SQLite or Postgres, for an
 * application whose numbers are small enough for it: newt brings no adapter yet
 * (ClickHouse and DuckDB will come). Every dataset is in one table, `analytics_row`,
 * each row whole as JSON, in the database of the context that reads it: it copies
 * `migrations/<sqlite|postgres>/00001_analytics_up.sql` into its own. Its queries are
 * Kysely's, the same on both, but for reading a field of the JSON.
```

El constructor acepta cualquiera de los dos stores:

```ts
// cooper/backend/shared/analytics/sql-analytics.ts
  constructor(private readonly store: SqliteStore | PostgresStore) {
    this.db = kyselyFor<AnalyticsDatabase>(store)
  }
```

Y `fieldOf` pregunta cuál es:

```ts
// cooper/backend/shared/analytics/sql-analytics.ts
  /**
   * A field of the JSON, as text: each database says it its own way (DuckDB or
   * ClickHouse would read a column). The field's name is written in the query, not
   * sent apart: Postgres groups by an expression only if it is written the same. It is
   * a name, checked above, never a piece of SQL.
   */
  private fieldOf(field: string): RawBuilder<string> {
    return this.store instanceof SqliteStore
      ? sql<string>`json_extract(data, ${sql.lit(`$.${field}`)})`
      : sql<string>`(data::jsonb ->> ${sql.lit(field)})`
  }
```

`sql.lit` escribe el nombre en la consulta en lugar de enviarlo como parámetro.
`countBy` selecciona, filtra y agrupa por la misma expresión; con un parámetro,
Postgres vería tres `$1`, `$2`, `$3` distintos y se negaría a agrupar. El nombre es
seguro de escribir: `countBy` lo comprobó antes contra `FIELD`.

Este es el único sitio de cooper que sabe sobre qué base de datos corre, y no es un
módulo: es un adaptador de un puerto.

## MySQL

newt tiene un tercer store SQL, `MySqlStore` de `newt/adapter-mysql`, que se abre igual
(`MySqlStore.open({ url: 'mysql://…?sslmode=require', migrations })`). Para cooper
sería una línea más en `openStore`, para las direcciones `mysql://`, y una tercera
carpeta de gemelas: ids `VARCHAR(36)`, texto `utf8mb4_0900_bin`, booleanos 0 y 1, JSON
`JSON`, y un valor único entre las filas no borradas como índice funcional sobre
`(IF(deleted_at IS NULL, col, NULL))`. MySQL además confirma cada cambio de estructura
al instante, así que un lote de migraciones que falla a medias no se deshace. cooper no
lo incluye. La [referencia de stores](../reference/stores) tiene todas las diferencias.

## Los guards se ganan el sueldo aquí

En SQLite, cada guardado espera su turno: una transacción cada vez, en toda la base de
datos. En Postgres y MySQL, las transacciones corren en paralelo, en `READ COMMITTED`.
Esa es la diferencia sobre la que avisó el capítulo [6](./06-rules-over-rows):

| Store | Sin `guard` | Con `guard` |
|---|---|---|
| Ficheros, SQLite | Los guardados se ejecutan de uno en uno. | Lo mismo. |
| Postgres, MySQL | Los guardados se ejecutan en paralelo: dos `after` pueden contar antes de que ninguno confirme. | Los guardados que comparten una clave se turnan. |

En Postgres, cada clave que un guardado protege es un bloqueo en la base de datos
durante su transacción (`pg_advisory_xact_lock`, con el nombre de la base de datos y la
clave). Dos guardados de las columnas del mismo tablero (`columns:<board id>`) se
turnan; los guardados de tableros distintos no esperan unos a otros. Un deadlock o un
fallo de serialización es un `ConcurrencyConflict`, y el caso de uso se ejecuta otra
vez, como con una versión caducada.

Así que cada regla sobre filas que escribiste bajo un guard se cumple aquí igual que en
SQLite, sin cambios: diez columnas por tablero, las 500 tarjetas, un nombre de tablero
una vez por espacio de trabajo, los números de tarjeta. Si un guardado se hubiera
olvidado de su guard, SQLite se lo habría perdonado, y Postgres no. Por eso la regla
del guard rechaza, en todos los stores y desde el primer día, un guardado que lee filas
y no protege nada: cuando un contexto pasa a Postgres, ya no queda nada por encontrar.

## Migrar a mano

El servidor migra cada contexto al abrirlo. Eso es lo correcto en desarrollo. En
producción muchas veces lo quieres aparte: para ver qué aplicará una versión nueva,
para aplicarlo antes de que arranquen los servidores (así una migración que falla
falla en un comando que estás mirando, no en el arranque de un servidor), o para
revertir la última.

Ese es el script, `cooper/scripts/migrations.ts`:

```ts
// cooper/scripts/migrations.ts
// bun run cooper:migrations <status|up|down> [--context auth|boards|backoffice]: each
// context's database migrated by hand. The server migrates on its own as it
// opens each context; this is for looking at what is pending, applying it before a
// deploy, or reverting the last one. `status` and `up` go through every context unless
// one is named; `down` reverts one context's last migration, so it needs its name.
// `status` also names the migrations applied whose up file was changed since, which
// `up` and the server's start refuse.
// Each context's database is the one it opens (`COOPER_<CONTEXT>_DATABASE`): a SQLite
// file, or a Postgres address, migrated with that database's own folder of migrations.
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { config } from '../backend/config'
import { connectStore } from '../backend/shared/open-store'

const CONTEXTS = ['auth', 'boards', 'backoffice'] as const
type ContextName = (typeof CONTEXTS)[number]
const COMMANDS = ['status', 'up', 'down'] as const

const { positionals, values } = parseArgs({ allowPositionals: true, options: { context: { type: 'string' } } })
const [command] = positionals
const named = values.context

if (!COMMANDS.includes(command as (typeof COMMANDS)[number]) || (named !== undefined && !CONTEXTS.includes(named as ContextName))) {
  console.error('Usage: bun run cooper:migrations <status|up|down> [--context auth|boards|backoffice]')
  process.exit(1)
}
if (command === 'down' && named === undefined) {
  console.error('down reverts one context\'s last migration: say which, with --context')
  process.exit(1)
}

const contexts = named === undefined ? CONTEXTS : [named as ContextName]

for (const context of contexts) {
  // `connect` opens the database as it is: `open` would migrate it first.
  const store = await connectStore(config[context].database, join(import.meta.dir, `../backend/contexts/${context}/migrations`))
  try {
    if (command === 'status') {
      const { applied, pending, changed } = await store.migrations.status()
      console.log(`${context}: ${applied.length} applied${applied.length ? ` (last ${applied.at(-1)})` : ''}, ${pending.length} pending${pending.length ? `: ${pending.join(', ')}` : ''}`)
      // One changed after it was applied stops `up` and the server's start: say which, and what to do.
      if (changed.length) console.log(`${context}: changed after they were applied: ${changed.join(', ')}; put their up files back as they were, and make the change a new migration`)
    } else if (command === 'up') {
      const applied = await store.migrations.up()
      console.log(`${context}: ${applied.length ? `applied ${applied.join(', ')}` : 'up to date'}`)
    } else {
      const reverted = await store.migrations.down()
      console.log(`${context}: ${reverted ? `reverted ${reverted}` : 'nothing to revert'}`)
    }
  } finally {
    await store.close()
  }
}
```

Abre la base de datos de cada contexto con `connectStore`, que no migra, y llama a
`migrations` del store:

- **`status()`**: un `MigrationStatus`, `{ applied, pending, changed }`, los nombres de
  cada grupo. `changed` son las aplicadas cuyo fichero up ya no coincide con su
  checksum. `status` no las rechaza, como hacen `open` y `up`: es adonde vas a averiguar
  qué falla, así que las nombra y dice qué hacer.
- **`up()`**: aplica lo pendiente y devuelve los nombres que aplicó. Con `connect`,
  también aplica las tablas propias del framework después de las del contexto (el
  outbox: `job`, `job_queue`, `schedule_tick`), como hace `open`.
- **`down()`**: revierte la última aplicada y devuelve su nombre, o `null`.

`down` necesita `--context`: revertir de golpe la última migración de todos los
contextos nunca es lo que querías.

El script lee la misma configuración que el servidor, así que migra las bases de datos
que el servidor abriría. Añádelo al `package.json` de la raíz, después de
`cooper:seed`:

```json
"cooper:migrations": "bun run cooper/scripts/migrations.ts",
```

## Un test sobre Postgres

Todos los tests hasta ahora corren sobre SQLite en memoria. Uno más ejecuta cooper
sobre un Postgres de verdad, cuando le das uno: `COOPER_TEST_POSTGRES_URL`, la
dirección de un usuario con permiso para crear bases de datos en ese servidor (un rol
con `CREATEDB`). Sin ella, el fichero no
define ningún test, y `bun test cooper/` lo salta.

```ts
// cooper/backend/postgres.test.ts
import { afterAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { join } from 'node:path'
import { runAsActor } from 'newt/core'
import { PostgresStore } from 'newt/adapter-postgres'
import { describeAnalyticsContract } from 'newt/port-analytics/contract'
import { config, type Config } from './config'
import { PRODUCTS } from './contexts/auth/modules/product/product.schema'
import { inWorkspace } from './contexts/boards/workspace-scope'
import { openContexts, stopContexts } from './open-contexts'
import { SqlAnalytics } from './shared/analytics/sql-analytics'
import { connectStore } from './shared/open-store'

/**
 * cooper on Postgres, when there is one to test against: `COOPER_TEST_POSTGRES_URL`,
 * the address of a user with the right to create databases (`CREATE DATABASE`, a
 * role with `CREATEDB`) on that server. Without it, these tests are skipped. Each context gets a database of its own, `cooper_test_<context>`, dropped
 * and made again: never one that matters.
 */
const url = process.env.COOPER_TEST_POSTGRES_URL

const CONTEXTS = ['auth', 'boards', 'backoffice', 'analytics'] as const

/** The address of a fresh, empty database of that name, on the same server. */
async function fresh(name: (typeof CONTEXTS)[number]): Promise<string> {
  const database = `cooper_test_${name}`
  const admin = new SQL(url!)
  await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE ${database}`)
  await admin.close()
  const address = new URL(url!)
  address.pathname = `/${database}`
  return address.toString()
}

/** cooper's settings, every context on a fresh Postgres database. */
async function postgresConfig(): Promise<Config> {
  return {
    ...config,
    auth: { ...config.auth, database: await fresh('auth'), port: 0 },
    boards: { ...config.boards, database: await fresh('boards'), port: 0 },
    backoffice: { ...config.backoffice, database: await fresh('backoffice'), port: 0 },
  }
}

if (url) {
  describe('cooper on Postgres', () => {
    test('opens every context migrated, and works across them as on SQLite', async () => {
      const settings = await postgresConfig()
      const contexts = await openContexts(settings, { mailer: { send: async () => {} } })
      const settled = async () => {
        for (let round = 0; round < 2; round++) for (const context of contexts.all) await context.base.jobs.idle()
      }
      try {
        const { user, tenant, access } = contexts.auth.modules
        const ana = await user.signUp({ email: 'ana@cooper.test', name: 'Ana', password: 'a long password' })
        await access.admit({ userId: ana.id, productId: PRODUCTS.backoffice, tenantId: null, role: 'member' })
        const asAna = <T>(fn: () => Promise<T>) => runAsActor({ userId: ana.id, via: 'web' }, fn)
        const acme = await asAna(() => tenant.create({ name: 'Acme' }))
        await settled()

        const { board, column, card, member } = contexts.boards.modules
        const found = await asAna(() => inWorkspace(member, acme.id, async () => {
          const roadmap = await board.create({ name: 'Roadmap' })
          await expect(board.create({ name: 'ROADMAP' })).rejects.toMatchObject({ code: 'board.name_taken' })
          const todo = await column.add(roadmap.id, { name: 'To do' })
          const cards = await Promise.all(['Plan', 'Design', 'Plan again'].map(title => card.create(roadmap.id, { columnId: todo.id, title })))
          expect(cards.map(each => each.number).toSorted()).toEqual([1, 2, 3])
          await settled()
          return card.search({ text: 'PLAN' }, { size: 10 })
        }))
        expect(found.items.map(each => each.title).toSorted()).toEqual(['Plan', 'Plan again'])
        // The welcome board's card, and the three above.
        expect(await card.countByWorkspace([acme.id])).toEqual([{ workspaceId: acme.id, cards: 4 }])

        const overview = await asAna(() => contexts.backoffice.modules.metric.overview())
        expect(overview.totals).toEqual({ cards: 4, workspaces: 1, signUps: 1 })
        expect(overview.cardsPerDay.at(-1)!.count).toBe(4)
      } finally {
        await stopContexts(contexts)
      }

      // The migrations script sees each database up to date.
      for (const context of ['auth', 'boards', 'backoffice'] as const) {
        const store = await connectStore(settings[context].database, join(import.meta.dir, 'contexts', context, 'migrations'))
        try {
          expect((await store.migrations.status()).pending).toEqual([])
        } finally {
          await store.close()
        }
      }
    }, 30_000)
  })

  const stores: PostgresStore[] = []
  afterAll(async () => {
    for (const store of stores.splice(0)) await store.close()
  })
  describeAnalyticsContract('SqlAnalytics on Postgres', {
    async open() {
      for (const store of stores.splice(0)) await store.close()
      const store = await PostgresStore.open({ url: await fresh('analytics'), migrations: join(import.meta.dir, 'shared/analytics/migrations/postgres') })
      stores.push(store)
      return new SqlAnalytics(store)
    },
    rows: (analytics, dataset) => analytics.rows(dataset),
  })
}
```

- **Una base de datos nueva por contexto**, `cooper_test_<context>`, borrada y creada
  de nuevo, así que el test se ejecuta tantas veces como quieras. No lo apuntes nunca
  a un servidor cuyas bases `cooper_test_*` importen.
- **El primer test es todo cooper sobre Postgres**, abierto por `openContexts` como lo
  abre el servidor: cada contexto migrado al abrirse, un registro en auth, un espacio
  de trabajo cuyo tablero de bienvenida crea boards a partir del evento de auth, un
  nombre de tablero rechazado con otra capitalización, tres tarjetas creadas a la vez
  (numeradas 1, 2 y 3: el guard sobre el contador del tablero en acción, ahora que los
  guardados corren en paralelo), la búsqueda, los recuentos con Kysely, y el resumen del
  backoffice sobre todo ello.
- **Después, la vista del script de migraciones**: `connectStore` ve cada base de datos
  sin nada pendiente.
- **`describeAnalyticsContract`** ejecuta el contrato del puerto de analytics (capítulo
  [26](./26-dead-jobs-and-analytics)) contra `SqlAnalytics` sobre Postgres: las mismas
  promesas que en SQLite.

## Compruébalo

La comprobación, como al final de cada capítulo:

```sh
bun install && bun check && bun test cooper/ && bun run lint && bun run cooper:build
```

Sin `COOPER_TEST_POSTGRES_URL`, `postgres.test.ts` no tiene nada que ejecutar:

```sh
bun test cooper/backend/postgres.test.ts
```

```text
 0 pass
 0 fail
Ran 0 tests across 1 file.
```

Para ejecutarlo de verdad, arranca un Postgres 17 en Docker, en un puerto que elijas:

```sh
docker run -d --rm --name cooper-pg -e POSTGRES_PASSWORD=pw -p 55437:5432 postgres:17
COOPER_TEST_POSTGRES_URL=postgres://postgres:pw@localhost:55437/postgres bun test cooper/backend/postgres.test.ts
```

```text
 5 pass
 0 fail
 14 expect() calls
Ran 5 tests across 1 file.
```

Un test es de cooper; los otros cuatro son del contrato de analytics.

Ahora el script, a mano, contra una base de datos propia de boards en el mismo
servidor:

```sh
docker exec cooper-pg psql -U postgres -c 'CREATE DATABASE cooper_boards'
export COOPER_BOARDS_DATABASE=postgres://postgres:pw@localhost:55437/cooper_boards
bun run cooper:migrations status --context boards
```

```text
boards: 0 applied, 6 pending: 00001_board, 00002_column, 00003_card, 00004_idempotency_key, 00005_activity, 00006_session
```

```sh
bun run cooper:migrations up --context boards
```

```text
boards: applied 00001_board, 00002_column, 00003_card, 00004_idempotency_key, 00005_activity, 00006_session
```

Ahora rompe a propósito la regla de los checksums: añade una línea a una migración que
ya se ejecutó, y vuelve a preguntar.

```sh
echo "-- a comment" >> cooper/backend/contexts/boards/migrations/postgres/00001_board_up.sql
bun run cooper:migrations status --context boards
```

```text
boards: 6 applied (last 00006_session), 0 pending
boards: changed after they were applied: 00001_board; put their up files back as they were, and make the change a new migration
```

`up` falla ahora con el error del checksum, como fallaría el arranque del servidor.
Quita otra vez la línea del fichero, y el estado vuelve a estar limpio:

```sh
bun run cooper:migrations status --context boards
```

```text
boards: 6 applied (last 00006_session), 0 pending
```

```sh
bun run cooper:migrations down --context boards
bun run cooper:migrations status --context boards
```

```text
boards: reverted 00006_session
boards: 5 applied (last 00005_activity), 1 pending: 00006_session
```

Sin `--context`, `down` se niega:

```text
down reverts one context's last migration: say which, with --context
```

Ahora el servidor mismo, con todos los contextos sobre Postgres. Crea las otras dos
bases de datos y arráncalo con las tres direcciones:

```sh
docker exec cooper-pg psql -U postgres -c 'CREATE DATABASE cooper_auth'
docker exec cooper-pg psql -U postgres -c 'CREATE DATABASE cooper_backoffice'
export COOPER_AUTH_DATABASE=postgres://postgres:pw@localhost:55437/cooper_auth
export COOPER_BACKOFFICE_DATABASE=postgres://postgres:pw@localhost:55437/cooper_backoffice
bun cooper/backend/index.ts
```

```text
auth listening on http://localhost:3001/
boards listening on http://localhost:3002/
backoffice listening on http://localhost:3003/
```

boards aplicó al abrirse la `00006_session` que habías revertido. Registra a alguien y
pide el estado desde otra terminal (con las mismas tres variables):

```sh
curl -s -X POST localhost:3001/api/session/sign-up -H 'content-type: application/json' \
  -d '{"email":"ana@cooper.test","name":"Ana","password":"a long password"}'
bun run cooper:migrations status
```

```text
auth: 9 applied (last 00009_token), 0 pending
boards: 6 applied (last 00006_session), 0 pending
backoffice: 2 applied (last 00002_analytics), 0 pending
```

Para el servidor, y quita el contenedor cuando termines:

```sh
docker rm -f cooper-pg
```

## Qué recordar

- El store es un puerto: un contexto lo elige en su `open`, y los módulos nunca llegan
  a saber cuál es. cooper lo elige a partir de la dirección de la base de datos, en una
  función (`openStore`); `CooperBase` lleva la unión de los stores que puede ser.
- Las migraciones son SQL en el dialecto de cada base de datos: una carpeta por
  dialecto, con los mismos números y nombres. En Postgres, el texto es `COLLATE "C"`
  (para que compare como en todas partes), los booleanos `BOOLEAN`, el JSON `JSONB`.
- Una migración aplicada no cambia nunca, en ningún store: un checksum la rechaza, y
  `status` la nombra. Una corrección es una migración nueva, en la carpeta de cada
  dialecto.
- `open` migra; `connect` no. Migrar a mano (`status`, `up`, `down`) pasa por
  `connect`, antes de un despliegue o para revertir la última.
- Postgres y MySQL ejecutan los guardados en paralelo: los guards que nombraste en
  SQLite son lo que mantiene allí las reglas sobre filas. La regla del guard se
  aseguró de que no falte ninguno.

Siguiente: [Observabilidad](./28-observability).
