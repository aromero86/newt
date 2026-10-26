# Stores

Donde un contexto guarda sus datos es un **store**: un objeto que implementa el puerto
`Store` (`newt/port-store`). El framework solo habla con ese puerto, así que un
contexto puede guardar sus datos en SQLite, en ficheros o en cualquier sitio al que
llegue un adaptador. Con el framework vienen cuatro adaptadores (SQLite, ficheros,
Postgres y MySQL); cualquier otro es una clase que escribes tú y compruebas con la
batería de contrato. Cada contexto de cooper guarda sus datos en un fichero SQLite
propio.

## Lo que promete un store

```ts
interface Store {
  transaction<T>(fn: () => T | Promise<T>): Promise<T>
  afterCommit(fn: () => void): void
  afterRollback(fn: () => void): void
  table<Row extends StoredRow>(name: string, options?: TableOptions<Row>): Table<Row>
  guard(keys: string[]): Promise<void>
  readonly outbox: Outbox
  readonly migrations: Migrations
  close(): Promise<void>
}
```

- **Una transacción es todo o nada.** Lo que escribe `transaction`, incluidos sus
  trabajos del outbox, se guarda junto o no se guarda, y una que se resuelve está
  confirmada. Una llamada dentro de otra se une a ella; las escrituras en paralelo
  dentro de ella (un `Promise.all`) van cada una por su cuenta, como una detrás de
  otra. Una llamada que llega cuando la transacción ya se confirmó o se deshizo (una
  que se dejó sin `await`, o una rama de un `Promise.all` que sigue en marcha cuando
  otra lanzó un error) falla, y no se ejecuta en ningún sitio: haz `await` de cada
  llamada dentro de una transacción.
- **La transacción en curso sigue al código.** Todo lo que se ejecuta dentro de `fn`,
  a cualquier profundidad y a través de los `await`, lee y escribe en ella sin que
  nadie se la pase. (Los adaptadores la guardan en un `AsyncLocalStorage`.)
- **Las transacciones que protegen la misma clave nunca se entrelazan.** Una regla
  sobre varias filas nombra lo que protege (`guard(['boardName:<workspace>:<nombre>'])`,
  que un guardado hace a partir de su opción `guard`); mientras una transacción tiene
  una clave, otra que la pide espera, así que lo que lee la regla sigue siendo cierto
  hasta que confirma. Las demás van en paralelo, si el store puede. SQLite y ficheros
  ejecutan una transacción cada vez, así que ya lo cumplen; Postgres y MySQL toman un
  bloqueo en la base de datos por cada clave.
- **Las lecturas fuera de una transacción solo ven lo confirmado.**
- **Una fila guardada conserva su versión**: una escritura que encuentra otra, o una
  fila nueva cuyo id o valor único ya está cogido, lanza `ConcurrencyConflict`.
- `afterCommit` ejecuta una función cuando se confirma la transacción en curso; al
  momento fuera de una; nunca si se deshace. Así los eventos llegan a sus handlers
  `fire-and-forget` solo por lo que se ha guardado. `afterRollback` ejecuta una si se
  deshace, la última primero; nunca al confirmar, ni fuera de una: así un guardado
  devuelve sus entidades a como estaban cuando se deshace lo que escribió.
- **Una llamada espera su turno, pero no para siempre**: 30 s por defecto
  (`waitTimeoutMs`), y después falla diciendo por qué. La causa habitual es código
  dentro de una transacción que la ha perdido (`AsyncLocalStorage.snapshot`, un
  `EventEmitter`) y pide el store, de modo que espera a la misma transacción de la que
  forma parte. Esto vale donde las transacciones van por turnos (SQLite, y ficheros
  dentro de un proceso; ficheros espera 10 s a otro proceso). En Postgres y MySQL
  `waitTimeoutMs` limita un `guard`; el código que perdió su transacción espera en
  cambio a los bloqueos de fila de la propia base de datos (por defecto, para siempre
  en Postgres y 50 s en MySQL, con el error de la base de datos). La batería de
  contrato no comprueba esta promesa.

### Tablas y criterios

`table(name)` es sobre lo que trabaja `TableRepository`: filas con un `id` y una
`version`, que se buscan por criterios y se escriben comprobando su versión.

```ts
interface Table<Row extends StoredRow> {
  find(criteria?: Criteria<Row>, options?: { orderBy?, limit? }): Promise<Row[]>
  count(criteria?: Criteria<Row>): Promise<number>
  insert(row: NewRow<Row>): Promise<void>                                   // guardada con la versión 1
  update(id: string, version: number, changes: Partial<NewRow<Row>>): Promise<void>  // una versión más
  patch(id: string, changes: Partial<NewRow<Row>>): Promise<void>           // sea cual sea su versión
  delete(id: string, version: number): Promise<void>
  deleteMany(criteria: Criteria<Row>): Promise<number>                     // sea cual sea su versión; cuántas
}
```

Una tabla se describe con las mismas palabras a todos los stores, así que un
repositorio pasa de un store a otro sin cambios: `types` nombra los campos que un
store quizá no pueda guardar tal cual (`boolean`, y `json` para objetos y listas), y
`unique` los campos que no comparten dos filas (sin contar las borradas lógicamente).
Un store que no necesita una de ellas la ignora: los valores únicos de SQLite son sus
índices; ficheros guarda los booleanos tal cual.

Los criterios se anidan en grupos, `and` (todos) y `or` (al menos uno), y responden
igual en todos los stores:
- una comparación con `null` no se cumple para nada: `{ eq: null }` y `{ ne: null }`
  son la forma de preguntar por él;
- `ne` significa "distinto, incluido un valor que falta" (el `IS DISTINCT FROM` de
  SQL, no `<>`): `{ ne: 'x' }` también encuentra las filas sin valor;
- un `null` en una lista de `in` sí encuentra `null`;
- un servidor solo admite tantos valores en una consulta (unos 65 535 parámetros en
  Postgres y MySQL): una lista de `in` que viene de una petición la limita su esquema
  (`.max(500)`), o una larga falla con un 500;
- un operador que queda en `undefined`, o una condición sin ninguno dentro (`{}`), no
  es ninguna condición;
- `ieq` ignora solo la caja de la A a la Z, en todos los stores: `Ñ` y `ñ` son
  distintas. Guarda una columna en minúsculas para una búsqueda que deba igualar todas
  las letras;
- el texto se ordena y se compara (`gt`, `lt`…) por punto de código (el orden de bytes
  de UTF-8: `Bob` antes que `bea`, `z` antes que `é`), como hace `compare` en memoria,
  y un espacio al final hace otro valor (en Postgres y MySQL, donde la intercalación
  de la columna es binaria: ver más abajo); `null` va primero en orden ascendente, y
  último en descendente;
- un valor con NUL (`\u0000`) solo encuentra lo que lo contiene: nada en Postgres,
  cuyo texto no puede contenerlo (escribir uno ahí es un `ValidationError`, un 400).

Una tabla es el terreno común que todos los stores pueden ofrecer. Lo que una tabla no
sabe decir (un join, una agregación, una búsqueda de texto completo) un repositorio lo
pide a la API propia de su store: cada adaptador expone una.

### El outbox

`outbox` guarda los trabajos de las suscripciones `handler`: se escriben en la
transacción del cambio que los publica y luego el worker de trabajos los reclama,
renueva y cierra, cada reclamación protegida por su intento, de modo que un worker
cuyo plazo se ha agotado no puede cerrar un trabajo que ha cogido otro. `retry(id)`
vuelve a poner en espera un trabajo muerto, como nuevo (cooper lo ofrece, con la
lista de trabajos muertos, como casos de uso de un pequeño `Outbox_Module` en cada
contexto, para su backoffice). `list()` y `queues()` enseñan
lo que guarda; `waiting()` cuenta los trabajos pendientes de cada cola, que el worker
lee cada minuto para avisar de una cola que nadie atiende, así que no debería leer los
trabajos terminados ni su contenido (el store de ficheros, que lee colecciones
enteras, sí lo hace).

### Migraciones

`migrations` aplica los cambios a la estructura del store, en orden, y los recuerda:
`up()`, `down()`, `status()`. Cada adaptador decide qué es una migración. Abrir un
store con `open` aplica las pendientes; `connect` lo abre tal como está, para los
scripts que migran a mano, cuyo `up()` aplica primero las del store y luego las del
framework (su outbox), igual que `open`. Una carpeta de migraciones que no se puede
leer es un error, nunca "no hay migraciones". El de cooper es
`cooper/scripts/migrations.ts`
(`bun run cooper:migrations status|up|down [--context <nombre>]`):

```ts
// cooper/scripts/migrations.ts
// `connect` opens the database as it is: `open` would migrate it first.
const store = await SqliteStore.connect({
  path: config[context].dbPath,
  migrations: join(import.meta.dir, `../backend/contexts/${context}/migrations`),
})
```

## SQLite: `newt/adapter-sqlite`

```ts
// cooper/backend/contexts/boards/boards.context.ts
const store = await SqliteStore.open({ path: config.dbPath, migrations: join(import.meta.dir, 'migrations') })
```

`config.dbPath` es `data/cooper-boards.db` salvo que `COOPER_BOARDS_DB_PATH` diga
otra cosa; los tests le dan `:memory:`.

- **Las transacciones van de una en una**, en el orden en que se piden, en una
  conexión que escribe. Las lecturas fuera de ellas van a una segunda conexión, de
  solo lectura, que solo ve lo confirmado (WAL). Un store `:memory:` es un fichero
  temporal, que se borra al cerrar (`close`), así que los tests se ejecutan con
  exactamente la misma semántica que producción. Una transacción que SQLite deshace
  por su cuenta (`RAISE(ROLLBACK)` en un trigger, un disco lleno) falla aunque el
  código haya capturado el error: no se ejecuta nada más en ella, y no se guarda nada.
- **`store.connection`** es el acceso para todo lo que una tabla no sabe decir: una
  base de datos de `bun:sqlite` cuyas sentencias se ejecutan en la conexión correcta
  en el momento de ejecutarse (una sentencia preparada fuera de una transacción y
  ejecutada dentro lee lo que escribió la transacción), y que rechaza una escritura
  fuera de una transacción. Pon encima un constructor de consultas si quieres uno, y
  usa las transacciones del store, nunca las suyas: en un repositorio, `save` o
  `saveRows`; en otro sitio, `store.transaction`. `kyselyFor(store)`, de
  `newt/kysely`, es eso, ya hecho:

  ```ts
  // cooper/backend/contexts/boards/boards-base.ts
  export class BoardsBase extends CooperBase {
    readonly db = kyselyFor<BoardsDatabase>(this.store)
  }
  ```

  Sus sentencias leen y escriben en la transacción en curso.
- **`store.table(name, options)`** escribe su propio SQL. La columna de un campo es su
  nombre en *snake case* salvo que `columns` diga otra cosa (un campo tiene que estar
  en *camel case* para que su columna lo nombre de vuelta); aquí `types` importa: un
  booleano se guarda como 0 o 1, y el JSON como texto.
- **Las migraciones son SQL**: parejas de `000NN_<nombre>_up.sql` y
  `000NN_<nombre>_down.sql` en una carpeta, que se aplican todas o ninguna; dos con el
  mismo número se rechazan. El store guarda un checksum de cada fichero `up` que
  aplica, y no abre si uno aplicado ha cambiado: un cambio es una migración nueva (o,
  antes de compartirla, `down`, el cambio y `up` otra vez). Una aplicada antes de que
  se guardaran los checksums se acepta tal como está.
  Un fichero se ejecuta sentencia a sentencia, separadas
  como las lee SQLite (un trigger, con puntos y coma en su cuerpo, es una), y
  cualquier sentencia que falle hace fallar el fichero. Las migraciones se ejecutan
  con las claves foráneas desactivadas, así que una tabla reconstruida como documenta
  SQLite (crear la nueva, copiar, borrar, renombrar) conserva las filas que apuntan a
  ella; una que deja una fila apuntando a nada falla (`PRAGMA foreign_key_check`). La
  tabla de una entidad tiene `id TEXT PRIMARY KEY` y `version INTEGER NOT NULL`; un
  valor único es un índice único (parcial, `WHERE deleted_at IS NULL`, cuando las filas
  se borran lógicamente). Las tablas propias del framework (`job`, `job_queue`) se
  migran después de las del contexto.

## Postgres y MySQL: `newt/adapter-postgres`, `newt/adapter-mysql`

```ts
const store = await PostgresStore.open({ url: 'postgres://user:password@host:5432/boards', migrations: 'migrations' })
const store = await MySqlStore.open({ url: 'mysql://user:password@host:3306/boards?sslmode=require', migrations: 'migrations' })
```

- **Sobre `Bun.SQL`**: no hay driver que instalar. Un pool de conexiones
  (`connections`, 10 por defecto); cada transacción reserva una hasta que termina, y
  las lecturas fuera de una cogen cualquiera, y solo ven lo confirmado.
- **Las transacciones van en paralelo**, como las ejecuta la base de datos, las dos en
  `READ COMMITTED` (la de MySQL por defecto es `REPEATABLE READ`: el store la fija en
  cada transacción), así que una lectura ve lo que se confirmó antes que ella, y una
  regla leída después de su `guard` ve lo que escribió el último que tuvo ese `guard`.
  Una clave protegida es un bloqueo en la base de datos durante la transacción
  (`pg_advisory_xact_lock`, `GET_LOCK`, con el nombre de la base de datos y la clave),
  así que solo esperan su turno las transacciones que protegen la misma clave; un
  `guard` espera como mucho `waitTimeoutMs`, y solo el `guard`. Las sentencias de una
  transacción esperan su turno en su conexión. Una transacción que la base de datos
  abandona (un interbloqueo, un fallo de serialización) es un `ConcurrencyConflict`,
  que el caso de uso repite (salvo que diga `retryOnConflict: false`).
- **Las mismas tablas SQL que las de SQLite**, escritas para cada una:
  `store.table(name, { types })` traduce los criterios al dialecto de la base de datos,
  y `ieq` aquí también iguala solo de la A a la Z. `store.query(sql, params)` ejecuta
  una sentencia propia en la transacción en curso; Kysely funciona sobre él como sobre
  SQLite. A diferencia de SQLite, una escritura fuera de una transacción no se
  rechaza: se ejecuta al momento, sola. Un `BIGINT` llega como número mientras es
  exacto (como texto más allá de 2^53), y un `DECIMAL`/`NUMERIC` como texto. Una tabla
  de Postgres aprende los tipos de sus columnas una vez, otra vez cuando una fila trae
  una columna que no ha visto (una que añadió una migración), y cada vez que su store
  migra: una columna a la que otro proceso le cambió el tipo o la nulabilidad se ve
  tras reiniciar.
- **Las migraciones son SQL en el dialecto de la base de datos**, las mismas parejas
  de ficheros que en SQLite. Un lote se ejecuta en una transacción. Postgres lo aplica
  todo o nada. MySQL confirma al momento cada cambio de estructura (`CREATE`, `ALTER`,
  `DROP`…), junto con todo lo que el lote hizo antes: un lote solo de sentencias de
  datos (`INSERT`, `UPDATE`…) es todo o nada; uno que falla después de un cambio de
  estructura conserva lo que se confirmó entonces, las migraciones anteriores
  registradas como aplicadas, y los cambios de estructura de la que falló, sin
  registrar. Dos procesos que migran a la vez esperan su turno (un bloqueo consultivo,
  un bloqueo con nombre): el segundo encuentra aplicadas las migraciones del primero.
  Dos ficheros con el mismo número y distinto nombre son un error, y también un
  fichero `up` cambiado después de aplicarse, como en SQLite. Un fichero se
  separa en sentencias por sus puntos y coma, sin contar los que están en cadenas y
  nombres entre comillas (`'…'`, `"…"`, `` `…` ``, con escapes `\` en MySQL), en
  comentarios (`--`, `/* */`) y, en Postgres, en cuerpos entre dólares (`$$ … $$`), así
  que una función o un trigger de Postgres va entero; un trigger de MySQL es una sola
  sentencia (`FOR EACH ROW SET …`), sin `BEGIN … END`.
- **Postgres**: la tabla de una entidad tiene `id TEXT PRIMARY KEY` y `version INTEGER
  NOT NULL`; los booleanos son `BOOLEAN` y el JSON es `JSONB`; un valor único entre las
  filas no borradas es un índice único parcial. Las columnas de texto mejor con
  `COLLATE "C"` (o una base de datos creada con `LC_COLLATE 'C'`), para que comparen y
  ordenen por punto de código, como en los demás stores: la intercalación habitual
  ordena `Ana`, `bea`, `Bob`. Una columna se compara y se ordena con su propia
  intercalación, para que le sirvan sus índices. `null` se ordena como en los demás
  stores (primero en ascendente): en una columna que puede tenerlo, la tabla dice
  `NULLS FIRST`/`NULLS LAST`, así que un índice pensado para ese orden se declara igual
  (`CREATE INDEX … (assignee_id NULLS FIRST)`); una `NOT NULL` (una clave primaria) se
  ordena sin más. Una sentencia que falla dentro de una transacción la estropea en
  Postgres, así que una escritura que puede chocar se ejecuta bajo un *savepoint*: un
  choque es un `ConcurrencyConflict` y la transacción sigue; una transacción
  estropeada por una sentencia propia que falló se deshace, y falla, al ir a
  confirmarse.
- **MySQL** (8.4): `id VARCHAR(36) PRIMARY KEY`; las columnas de texto mejor con
  `utf8mb4_0900_bin`, para que `=`, los índices únicos y el orden traten la caja y el
  espacio final como los demás stores (`utf8mb4_bin` rellena: `'ana' = 'ana '`); los
  booleanos son 0 y 1, el JSON es `JSON` (un campo json vive en una columna `JSON`: de
  una de texto se lee como su texto); un valor único entre las filas no borradas es un
  índice único funcional sobre `(IF(deleted_at IS NULL, col, NULL))`. Un cambio de
  estructura (`CREATE`, `ALTER`, `DROP`…) dentro de cualquier transacción, no solo de
  una migración, la confirma ahí mismo: lo que viene después se ejecuta por su cuenta,
  fuera de ella, y deshacerla no deshace nada de ello. MySQL 8.4 solo inicia sesión
  por TLS: una URL sin `?sslmode=require` falla con
  `ERR_MYSQL_PUBLIC_KEY_RETRIEVAL_NOT_ALLOWED`.
- Sus tests ejecutan la batería de contrato contra bases de datos reales cuando están
  `FRAMEWORK_TEST_POSTGRES_URL` y `FRAMEWORK_TEST_MYSQL_URL`, y se saltan si no.
  Vacían la base de datos que nombra la URL antes de cada test (el esquema `public` en
  Postgres, la base de datos entera en MySQL): dales una propia, y ejecuta una sola
  batería sobre ella a la vez.

## Kysely: `newt/kysely`

`kyselyFor<Database>(store)` da Kysely sobre cualquier store SQL (SQLite, Postgres,
MySQL): sus sentencias se ejecutan en las conexiones del store, en la transacción en
curso, y los nombres de los campos son los de las filas (`workspaceId`), convertidos
por el camino en los de las columnas (`workspace_id`). Las transacciones propias de
Kysely se rechazan: no serían las del store. Un booleano llega como 0 o 1 en SQLite y
MySQL, y el JSON como texto en SQLite: `SqliteRow<Row>` lo dice en los tipos. Una
columna JSON de Postgres recibe el valor mismo (`tags: []`): su texto JSON se guardaría
como un string. Una suma llega como texto en Postgres y MySQL, y un `COUNT` en
Postgres: pásalos por `Number(…)`. En Postgres y MySQL el store solo devuelve filas a
Kysely, así que los `numUpdatedRows` y `numDeletedRows` de una escritura son `0n` y no
hay `insertId`: usa `returning` (Postgres) o vuelve a leer. Kysely es una dependencia
*peer* opcional.

`whereOf(store, criterios)` dice unos criterios como una condición de Kysely, igual que
los dicen las tablas del store: todos los operadores y grupos, y el null, las
mayúsculas y lo demás respondidos como responde `find`, sobre los campos de la tabla
consultada.

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
this.base.db.selectFrom('card').where('workspaceId', '=', currentWorkspaceId()).where(whereOf(this.store, criteria))
```

## Ficheros: `newt/adapter-files`

```ts
const store = await FileStore.open({ folder: 'data/boards', migrations: [/* FileMigration */] })
```

- **Un fichero JSON por registro**, una carpeta por colección:
  `data/boards/card/<id>.json`. Se leen y se escriben en el disco tal cual, nunca se
  guardan en memoria. Un id tiene hasta 100 letras, números, `.`, `-` y `_`, y empieza
  por una letra o un número (el nombre de una colección, hasta 100 letras, números,
  `-` y `_`): una escritura con cualquier otro se rechaza, y una lectura no encuentra
  nada.
- **Las transacciones son suyas.** Lo que escribe una espera en memoria, donde la
  propia transacción lo vuelve a leer, y va al disco al confirmar a través de un
  diario: cada escritura va a `_journal.json`, volcado al disco (eso es la
  confirmación); después cada registro se escribe entero, encima del anterior; después
  el diario desaparece. Un fallo antes del diario no deja nada; después, quien coja el
  bloqueo a continuación lo vuelve a escribir todo.
- **Un solo bloqueo, `_lock`, para todo**: una transacción o lectura cada vez, en este
  proceso y entre procesos que comparten la carpeta. El bloqueo dice qué proceso lo
  cogió, y quien lo tiene lo toca cada segundo mientras lo tiene. Se considera
  abandonado, y se toma, cuando el proceso que nombra no está vivo, o cuando lleva 5 s
  sin tocarse sea quien sea el que nombra (un reinicio dio su id de proceso a otro
  proceso). Los procesos tienen que ver los ids de los demás: una máquina, un espacio
  de nombres de procesos, no dos contenedores. A quien lo tiene y cuyo proceso se para
  5 s (un paso síncrono largo, una pausa del recolector de basura, SIGSTOP, una máquina
  suspendida) también se le quita así, de modo que cada fichero que escribe una
  confirmación, el diario primero, se renombra a su sitio solo después de comprobar,
  en ese momento, que el bloqueo sigue teniendo su propio token: una transacción a la
  que le quitan el bloqueo antes de que esté su diario falla con un
  `ConcurrencyConflict` y no escribe nada (el caso de uso se repite); una a la que se
  lo quitan después deja sus registros al nuevo dueño, que termina primero el diario.
  Una transacción que solo leyó falla igual: lo que leyó puede mezclar dos; una lectura
  fuera de una transacción vuelve a leer en su lugar. Lo que queda es un proceso
  parado 5 s justo dentro de esa comprobación y ese renombrado.
- **En cuanto el diario está en el disco la transacción está confirmada**, aunque
  falle la escritura de los registros: el siguiente que coja el bloqueo los escribe.
  Hasta entonces cada llamada falla, diciendo por qué: lo que leyera no tendría esa
  transacción. Arregla lo que rechazó el disco (espacio, permisos) y el store sigue.
- **`store.collection(name)`** es el acceso para lo que una tabla no sabe decir:
  `get`, `all`, `put`, `remove`, en la transacción en curso.
- **`store.table(name, { unique })`** busca filas leyendo la colección entera. Aquí
  `unique` importa: es lo único que impide que dos filas compartan un valor.
- **Las migraciones son funciones** que transforman registros, ejecutadas en una
  transacción:

  ```ts
  const assignee: FileMigration = {
    version: 2,
    name: 'card-assignee',
    up: async store => {
      const cards = store.collection('card')
      for (const card of await cards.all()) await cards.put({ ...card, assigneeId: null })
    },
    down: async store => { /* deshacerlo */ },
  }
  ```
- **Es para miles de registros, no millones**: cada búsqueda lee una colección entera.
  Para prototipos, tests, herramientas pequeñas, configuración.

## Escribir un store

Un store para otra base de datos es una clase que implementa `Store`, con una
`Table`, un `Outbox` y unas `Migrations` propias. El framework ayuda con lo que
comparten todos los adaptadores:

- `TransactionScope` es la maquinaria de las transacciones: la actual siguiendo al
  código, una llamada dentro de otra uniéndose a ella, una llamada tardía a una que ya
  terminó fallando en vez de ejecutarse fuera, `afterCommit` y `afterRollback` y, para
  un store cuyas transacciones van por turnos (`serial`, lo normal), la cola y la
  espera que se rinde diciendo por qué. Un adaptador le da sus pasos (`begin`,
  `commit`, `rollback`, `end`) y construye sobre ella, como hacen todos los de aquí.
- `criteriaTree(criteria)` convierte los criterios en un árbol (`all`, `any`, una
  condición sobre un campo) para traducirlo a una consulta; `matches(row, criteria)` y
  `compare(a, b)` comprueban y ordenan filas en memoria, para un store sin lenguaje de
  consulta. Un store SQL puede reutilizar la tabla SQL entera del framework dándole su
  dialecto, como hacen Postgres y MySQL.
- `isSameClaim(stored, claimed)` es la regla que protege un trabajo reclamado.
- `migrationName(version, name)` nombra una migración como las demás.

Después ejecuta la batería de contrato, que comprueba las promesas de arriba (todas
menos la espera limitada), los repositorios y la cola de trabajos sobre él. Su
fixture (`StoreFixture`) pide dos cosas a `open`: un store nuevo y vacío cada vez, y
una tabla `thing` para `ThingRow` (cada campo una columna en *snake case*, `name`
único entre las filas no borradas):

```ts
import { describeStoreContract } from 'newt/port-store/contract'

describeStoreContract('PostgresStore', {
  open: async () => {
    await emptyTheTestDatabase()   // una base de datos solo para los tests, vaciada cada vez
    return PostgresStore.open({ url: process.env.TEST_DATABASE_URL!, migrations: 'test/migrations' })
  },
})
```

La migración de `thing` la escribe el adaptador: mira
`packages/newt/adapter-postgres/postgres-store.test.ts`.

Dos promesas piden cuidado en una base de datos con transacciones concurrentes:

- **Los `guard`.** "Las transacciones que protegen la misma clave nunca se entrelazan"
  necesita un bloqueo por clave, que dure hasta que termine la transacción (un
  bloqueo consultivo), o transacciones que vayan de una en una. Sin él, una regla
  comprobada en un hook `after` se rompe sin hacer ruido; la batería tiene un test
  para eso. Una transacción que la base de datos abandona (un interbloqueo, el `40001`
  de Postgres) es un `ConcurrencyConflict`, que el caso de uso repite.
- **La transacción en curso.** Guárdala en un `AsyncLocalStorage`, como hacen todos
  los adaptadores de aquí: un repositorio, una tabla y el outbox tienen que escribir
  todos en la misma sin que nadie se la pase.

## Almacenamiento sin transacciones

Algunos sitios no pueden guardar un cambio y sus trabajos juntos: una base de datos
analítica (ClickHouse, DuckDB), un almacén de objetos, una API de fuera. No son stores,
ni hace falta que lo sean: un módulo puede guardar ahí **proyecciones**, escritas por
un worker `handler` que sigue los eventos de un store que sí tiene transacciones. El
trabajo se repite hasta que sale bien, así que el handler escribe de forma que se
pueda repetir sin problema (un *upsert* por id, una escritura con la clave del
evento).

Para la analítica el framework tiene un puerto propio, `Analytics`:
`append(dataset, rows)`, que solo añade, cada fila con un id propio para que un
trabajo repetido nunca la duplique; se lee con el lenguaje de cada adaptador. Aún no
viene ningún adaptador: `MemoryAnalytics` es para los tests y como el ejemplo más
sencillo, y `describeAnalyticsContract` comprueba uno escrito para ClickHouse o
DuckDB. cooper escribe uno pequeño sobre SQLite, `shared/analytics/sqlite-analytics.ts`,
con su SQL en ese único fichero y marcado como de SQLite. DuckDB también puede leer el fichero SQLite de un contexto tal cual, para
informes, sin copiarlo.
