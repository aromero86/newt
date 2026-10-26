# Migraciones

La forma de los datos cambia con la aplicación: una tabla nueva para un módulo nuevo, una
columna para un campo nuevo, un índice para una búsqueda nueva. Las **migraciones** son
esos cambios, aplicados en orden y recordados por el store. Este capítulo enseña cómo los
guarda cooper, y las reglas que los hacen seguros.

## Una carpeta por contexto

Cada contexto tiene su store, así que cada uno tiene sus migraciones, en una carpeta
`migrations/` junto a su fichero de contexto. El store aplica las pendientes cuando el
contexto lo abre:

```ts
// cooper/backend/contexts/boards/boards.context.ts
static async open(config: Boards_Config, deps: Boards_ModuleDeps): Promise<Boards_Context> {
  const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
  const base = new BoardsBase({ name: 'boards', store })
  return new Boards_Context(base, initializeModules(base, config, deps), config, deps.auth)
}
```

`SqliteStore.open` migra antes de volver. Un contexto nunca arranca con datos viejos, y
un test que abre `:memory:` tiene las mismas tablas que producción.

Las migraciones de cooper hoy:

```
cooper/backend/contexts/auth/migrations/
  00001_user_up.sql           00001_user_down.sql
  00002_session_up.sql        00002_session_down.sql
  00003_oauth-client_up.sql   00003_oauth-client_down.sql
  00004_oauth-grant_up.sql    00004_oauth-grant_down.sql
  00005_token_up.sql          00005_token_down.sql
  00006_tenant_up.sql         00006_tenant_down.sql
  00007_access_up.sql         00007_access_down.sql
  00008_invitation_up.sql     00008_invitation_down.sql
cooper/backend/contexts/boards/migrations/
  00001_boards_up.sql         00001_boards_down.sql
  00002_session_up.sql        00002_session_down.sql
cooper/backend/contexts/backoffice/migrations/
  00001_session_up.sql        00001_session_down.sql
  00002_analytics_up.sql      00002_analytics_down.sql
```

auth creció módulo a módulo, y tiene una migración por cada uno. boards creó sus tres
tablas de una vez. Las dos cosas valen: una migración es un cambio, no un módulo.

## Nombres

Una migración es un par de ficheros: `000NN_<nombre>_up.sql`, lo que cambia, y
`000NN_<nombre>_down.sql`, cómo deshacerlo. El número tiene cinco cifras y las ordena. El
nombre dice de qué va. Un fichero cuyo nombre no tiene esa forma se ignora, así que un
`README` en la carpeta no molesta.

El store apunta lo que ha aplicado en una tabla, `migrations`: el número, el nombre y
cuándo. Las tablas propias de newt (`job` y `job_queue`, las del outbox) tienen sus
migraciones aparte, apuntadas en `framework_migrations` y aplicadas después de las tuyas,
así que sus números nunca se cruzan.

## Escribir una

Esta es la primera migración de boards, recortada:

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
-- boards' tables: each workspace's boards, their columns and their cards. Every row
-- says its workspace (an auth tenant), by id and without a foreign key: the workspace
-- is another context's, and the repositories see only the rows of the current one.

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

-- "column" is a word of SQL's: quoted, it is a table's name like any other.
CREATE TABLE "column" (
  -- …
);

-- …
```

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_down.sql
DROP TABLE card;
DROP TABLE "column";
DROP TABLE board;
```

Las reglas que sigue:

- **Cada campo de la entidad es una columna**, con su nombre en *snake_case*
  (`workspaceId` → `workspace_id`). La tabla de una entidad tiene `id TEXT PRIMARY KEY`
  y `version INTEGER NOT NULL`.
- **Un valor único es un índice único.** Con borrado lógico (`deletedAt`), hazlo
  parcial, `WHERE deleted_at IS NULL`, para que una fila borrada libere su valor. Así es
  como un tablero archivado deja libre su nombre.
- **Ninguna clave ajena a la tabla de otro módulo, ni de otro contexto.** `card` apunta
  a su columna, a su tablero y a su asignado solo por id. La columna es de otro módulo
  ([capítulo 18](./18-references)), y el asignado vive en otra base de datos. Lo que
  mantiene esas referencias en orden es el código, con eventos.
- **Un nombre que es una palabra de SQL va entre comillas**: `"column"` en boards,
  `"user"` en auth.
- **`down` deshace exactamente lo que hizo `up`**, en orden inverso.

Los comentarios son bienvenidos. Una migración se lee mucho después de escribirla, y el
comentario es donde vive el motivo de un índice o de una clave ajena que falta.

## Una migración compartida entre contextos

boards y el backoffice hacen entrar a la gente a través de auth con el mismo módulo,
`shared/web-session`, y ese módulo necesita una tabla `session` en la base de datos de
cada uno. Cada store lee una sola carpeta, numerada en una sola secuencia, así que un
contexto no puede apuntar a una segunda carpeta. El módulo compartido guarda la
migración, y cada contexto la **copia** en su carpeta, con el número que le toca después
de las que ya tiene:

```sql
-- cooper/backend/shared/web-session/migrations/00001_session_up.sql
-- A context's web sessions (shared/web-session): each context that signs its people in
-- through auth copies this migration into its own, numbered after the ones it has.
-- Only the hash of each token: a copy of the database opens nothing.
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX session_user ON session (user_id);
```

En boards es `00002_session_up.sql`. En el backoffice es `00001_session_up.sql`, seguida
de `00002_analytics_up.sql`, la copia de la de `shared/analytics`. Las carpetas
compartidas no sobran: los tests de los propios módulos compartidos abren un store sobre
ellas.

Cuando el módulo compartido cambia su tabla, añade una migración a su carpeta, y cada
contexto que lo usa copia también esa, con su siguiente número. Una copia es una
migración como cualquier otra: una vez aplicada, no se edita.

## Cómo las ejecuta SQLite

El store de SQLite de newt trata las migraciones con cuidado, y conviene saber cómo:

- **Todas las pendientes se aplican en una transacción**, todas o ninguna. Si la tercera
  de tres falla, también se deshacen las dos primeras, y el contexto no arranca.
- **Un fichero se ejecuta sentencia a sentencia**, partido como lo lee SQLite. Un
  trigger, con puntos y coma dentro, es una sola sentencia. Una sentencia que falla hace
  fallar el fichero: ejecutado entero, SQLite solo informaría del error de la última.
- **Las claves ajenas se apagan durante una migración.** SQLite documenta cómo cambiar
  la forma de una tabla: crear la nueva, copiar las filas, borrar la vieja, renombrar.
  Con las claves ajenas encendidas, borrar la vieja borraría o rechazaría las filas que
  apuntan a ella. Como SQLite ignora apagarlas dentro de una transacción, newt las apaga
  antes de empezarla, y ejecuta `PRAGMA foreign_key_check` antes de confirmar: una
  migración que deja una fila apuntando a nada falla.
- **Dos ficheros con el mismo número y distinto nombre se rechazan**:
  `Migrations 00003_a_up.sql and 00003_b_up.sql share the version 00003: renumber one`.
  Pasa cuando dos ramas añaden cada una su migración. Renumera la tuya.
- **Un fichero sin su pareja se rechaza** (`Migration 3_tags is missing its down file`).
- **Una base de datos por delante del código no arranca.** Si la última migración que
  aplicó no está en la carpeta (has vuelto a una rama más vieja), abrir falla en vez de
  ejecutar código viejo sobre tablas nuevas.
- **Una carpeta que no se puede leer es un error**, nunca "no hay migraciones". Una ruta
  mal escrita no te deja con una base de datos vacía.
- **Dos procesos que abren la base de datos a la vez se turnan.** El segundo espera al
  primero y encuentra sus migraciones aplicadas.

## Nunca reescribas una que ya se aplicó

El store recuerda una migración por su número y su nombre, no por su contenido. Si editas
un fichero que ya se aplicó, no pasa nada en las bases de datos que lo tienen: nunca lo
vuelven a ejecutar. Una base de datos nueva (la de un compañero, la de un test) ejecuta la
versión nueva. Ahora dos bases de datos que dicen "00002 aplicada" tienen tablas
distintas, y nada te avisa.

Así que un cambio es una migración nueva. Para añadir una columna a las cards, escribe
`00003_card-priority_up.sql` con un `ALTER TABLE`, y un `down` que la quite.

::: warning Cuidado
`bun run cooper` arranca el backend con `--watch`. Se reinicia al guardar, y cada
reinicio abre los stores, que aplican cualquier migración pendiente. Una migración que
aún estás escribiendo se aplica en cuanto el backend se reinicia. Desde ese momento está
aplicada: corrígela con otra nueva, o deshazla con `down` (más abajo) antes de editarla.
:::

**Los datos sobreviven a todas las migraciones.** Una columna nueva en una tabla con
filas necesita un valor por defecto
(`ALTER TABLE card ADD COLUMN priority INTEGER NOT NULL DEFAULT 0`), y una tabla que
cambia de forma copia sus filas a la nueva.

## Mirar, y volver atrás

`open` migra solo. Para mirar antes, o para deshacer la última, un script abre el store
con `connect`, que no migra, y usa `store.migrations`:

```ts
// packages/newt/port-store/migrations.ts
export interface Migrations {
  /** Applies every pending one, all of them or none; the ones it applied. */
  up(): Promise<string[]>
  /** Reverts the last one applied; the one it reverted, if any. */
  down(): Promise<string | null>
  status(): Promise<{ applied: string[], pending: string[] }>
}
```

`status()` las lista por su nombre (`00001_boards`). `down()` ejecuta el fichero `down`
de la última aplicada, en una transacción como `up`. `up()` aplica las tuyas y después
las de newt, como `open`.

## Otros stores

Postgres y MySQL usan los mismos pares de ficheros y las mismas reglas, en su dialecto, en
una carpeta propia. El [capítulo 26](./26-production) cuenta qué cambiaría en las de
cooper.

## En resumen

- Cada contexto tiene sus migraciones en su carpeta; abrir el store aplica las
  pendientes.
- Una migración es `000NN_<nombre>_up.sql` y `000NN_<nombre>_down.sql`.
- Columnas en *snake_case*, `id TEXT PRIMARY KEY`, `version INTEGER NOT NULL`, un índice
  único para un valor único (parcial con borrado lógico), ninguna clave ajena entre
  módulos ni entre contextos.
- La migración que necesita un módulo compartido se copia en cada contexto que lo usa,
  con el siguiente número de ese contexto.
- En SQLite: todas las pendientes en una transacción, sentencia a sentencia, claves
  ajenas apagadas y comprobadas al final, números repetidos rechazados.
- Una migración aplicada no se edita nunca: un cambio es una migración nueva.
