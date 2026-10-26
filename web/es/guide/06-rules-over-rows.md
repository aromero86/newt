# Reglas sobre filas

Un tablero tiene columnas: Por hacer, En curso, Hecho. Con ellas llegan dos reglas
nuevas, y una trata de los propios tableros:

- **Un tablero tiene como máximo diez columnas.**
- **El nombre de un tablero es único en su espacio de trabajo**, sea cual sea su
  capitalización: `Roadmap` y `ROADMAP` son el mismo nombre.

Ninguna de las dos reglas se puede comprobar mirando la fila que se guarda. Una versión
protege una fila: nadie sobrescribe un tablero que otra persona ha cambiado. Estas
reglas hablan de **varias** filas, y una comprobación antes de guardar no ve lo que
pasa entre medias:

```text
Ana   counts the columns: 9
Bob   counts the columns: 9
Ana   saves her column     → 10
Bob   saves his column     → 11
```

Los dos contaron, los dos encontraron hueco, y el tablero tiene once. Ninguna versión
ayuda: las dos columnas son filas nuevas, y ninguna toca a la otra.

Este capítulo enseña cómo comprueba newt una regla sobre varias filas dentro del
guardado, y cómo el guardado dice lo que protege para que la regla se cumpla en todos
los stores. También escribes tu segundo módulo, `column`, que usa `board`.

## El módulo column

### Su esquema y su entidad

Una columna pertenece a un tablero, por id, y tiene una `position`: 0 a la izquierda,
luego 1, 2… sin huecos. `MAX_COLUMNS` es el número de la regla, en un solo sitio.

```ts
// cooper/backend/contexts/boards/modules/column/column.schema.ts
import { z } from 'zod'

/** The most columns a board has. */
export const MAX_COLUMNS = 10

/** A board's column: a status its cards are in (To do, Doing, Done…). */
export const ColumnSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.string(),
  /** The board it is in, by id: the board is another module's. */
  boardId: z.string(),
  name: z.string().trim().min(1).max(40),
  /** Where it is on its board, from 0 on the left: a board's columns are 0, 1, 2… without gaps. */
  position: z.number().int().min(0),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const ColumnAddSchema = ColumnSchema.pick({ name: true })
export const ColumnRenameSchema = ColumnSchema.pick({ name: true })
/** Where it goes: a position past the last one is the last. */
export const ColumnMoveSchema = ColumnSchema.pick({ position: true })

export type ColumnDTO = z.infer<typeof ColumnSchema>
export type ColumnAddDTO = z.input<typeof ColumnAddSchema>
export type ColumnRenameDTO = z.input<typeof ColumnRenameSchema>
export type ColumnMoveDTO = z.input<typeof ColumnMoveSchema>
```

`ColumnMoveSchema` es para mover una columna, algo que necesita lo que enseña el
capítulo 8. Espera aquí hasta entonces.

La entidad sigue la forma de `Board`. El único método nuevo es `place`: una columna
nueva toma su posición al guardarse, no antes. En un momento verás por qué.

```ts
// cooper/backend/contexts/boards/modules/column/column.ts
import { Entity, type EntityInput } from 'newt/core'
import { ColumnSchema, type ColumnDTO } from './column.schema'

export * from './column.schema'

/** A column of a board. */
export class Column extends Entity<typeof ColumnSchema> {

  private constructor(input: EntityInput<ColumnDTO>, isNew: boolean) {
    super(ColumnSchema, input, isNew)
  }

  static fromDTO(dto: ColumnDTO & { version: number }): Column {
    return new Column(dto, false)
  }

  /** A new one, at the end of its board: `position` is where the end looked to be, and its save places it for sure. */
  static add(input: { workspaceId: string, boardId: string, name: string, position: number }): Column {
    return new Column(input, true)
  }

  get boardId(): string {
    return this.data.boardId
  }

  get name(): string {
    return this.data.name
  }

  get position(): number {
    return this.data.position
  }

  /** A new one takes its place as it is saved: the end of its board, read where no other column can be added in between. */
  place(position: number): void {
    if (!this.isNew) throw new Error(`Column ${this.id} is placed once, as it is added`)
    this.change({ position })
  }

  rename(name: string): void {
    this.change({ name })
  }
}
```

### Sus errores

Una columna que no está es un 404:

```ts
// cooper/backend/contexts/boards/modules/column/errors/column-not-found.ts
import { NotFoundError } from 'newt/core'

export class ColumnNotFound extends NotFoundError {
  readonly code = 'column.not_found'
  constructor(id: string) {
    super(`There is no column ${id}`)
  }
}
```

Un tablero lleno es un `ConflictError`, un 409: la petición es correcta, el estado del
tablero la rechaza.

```ts
// cooper/backend/contexts/boards/modules/column/errors/too-many-columns.ts
import { ConflictError } from 'newt/core'
import { MAX_COLUMNS } from '../column.schema'

export class TooManyColumns extends ConflictError {
  readonly code = 'column.too_many'
  constructor(boardId: string) {
    super(`Board ${boardId} has ${MAX_COLUMNS} columns already: that is the most a board has`)
  }
}
```

No lo confundas con `ConcurrencyConflict`, que también es un 409 y que conocerás en el
capítulo 8: ese hace que el caso de uso se ejecute de nuevo. Ejecutarlo otra vez no
haría sitio en un tablero lleno, así que `TooManyColumns` es un `ConflictError` normal.

### Su tabla

`column` es una palabra de SQL, así que el nombre de la tabla va entre comillas. Igual
que `board`, cada fila dice su espacio de trabajo. El índice sirve a la única consulta
que hace el módulo: las columnas de un tablero, en orden.

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00002_column_up.sql
-- Each board's columns, from the left.
-- "column" is a word of SQL's: quoted, it is a table's name like any other.
CREATE TABLE "column" (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX column_board ON "column" (workspace_id, board_id, position);
```

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00002_column_down.sql
DROP TABLE "column";
```

Una migración nueva, `00002`. No tocas `00001`: el capítulo 5 enseñó por qué.

## Comprobar dentro del guardado

Hasta ahora todos los repositorios guardaban con `persist`. Detrás está `save`, un
método protegido del `Repository` de newt, del que extiende `TableRepository`.
`persist` es justo esto:

```ts
await this.save(entities, entity => this.write(entity))
```

Lee sus tres argumentos uno a uno:

```ts
save(entities, write, { guard, before, after })
```

- **`entities`**: lo que escribe el guardado, todo o nada, en una transacción. Cada
  una guardada tiene que seguir en la versión en la que se leyó. `persist` solo guarda
  entidades de su propio módulo.
- **`write`**: cómo escribir una entidad, dentro de la transacción. `TableRepository`
  ya tiene una, `this.write(entity)`, que inserta o actualiza su fila. Solo se llama
  para las entidades con cambios.
- **Los hooks**, todos opcionales, se ejecutan en la misma transacción:
  - **`guard`**: lo que protege el guardado, como claves que eliges tú
    (`columns:<board id>`). **Dos guardados que comparten una clave nunca se ejecutan
    a la vez**, en ningún store: el segundo espera hasta que el primero confirma o
    revierte. Los guardados sin ninguna clave en común no se esperan entre sí (en
    Postgres y MySQL; en SQLite y ficheros cada guardado espera su turno de todos
    modos).
  - **`before`**: lo que tiene que pasar antes de escribir las entidades. Puede leer, y
    escribir lo que deba ir primero.
  - **`after`**: se ejecuta una vez escritas las entidades. Comprueba la regla sobre
    varias filas; **si lanza un error, se revierte todo**.

En orden, un guardado hace esto:

```text
open the transaction
take the guard's keys            (wait for any other save holding one of them)
before()
write(entity) for each entity that changed
after()
commit                           (or, if anything threw, roll it all back)
```

Cuando un guardado se revierte, sus entidades vuelven a como estaban antes, y newt se
niega a guardarlas otra vez (`SaveRolledBack`): lo que dirían podría haber dejado de
ser cierto. Un caso de uso que quiera reintentar las lee de nuevo.

### Una columna al final de un tablero, diez como máximo

Este es el repositorio de columnas. `persistAdded` es el guardado de una columna nueva:

```ts
// cooper/backend/contexts/boards/modules/column/column.repository.ts
import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Column, MAX_COLUMNS, type ColumnDTO } from './column'
import { TooManyColumns } from './errors/too-many-columns'

export type ColumnRow = ColumnDTO & { version: number }

export class Column_Repository extends TableRepository<Column, ColumnRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<ColumnRow>('column'), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: ColumnRow): Column {
    return Column.fromDTO(row)
  }

  /** A board's columns, from left to right. */
  ofBoard(boardId: string): Promise<Column[]> {
    return this.find({ boardId }, { orderBy: [{ field: 'position' }] })
  }

  /**
   * Saves a new column at the end of its board, only if the board is left with no more
   * than `MAX_COLUMNS`: a rule over several rows, which no version covers. The
   * save guards its board's columns: its place is read before writing it, and the
   * columns counted after, with no other column of the board added, moved or removed
   * in between, in any store. Ten added at once to a board of five: five get in.
   */
  async persistAdded(column: Column): Promise<void> {
    const { boardId } = column
    await this.save([column], each => this.write(each), {
      guard: [`columns:${boardId}`],
      before: async () => column.place(await this.count({ boardId })),
      after: async () => {
        if (await this.count({ boardId }) > MAX_COLUMNS) throw new TooManyColumns(boardId)
      },
    })
  }
}
```

Cada parte tiene una sola tarea:

- **``guard: [`columns:${boardId}`]``**: la regla trata de las columnas de un tablero,
  así que la clave es por tablero. Dos personas que añaden columnas al mismo tablero
  esperan su turno; dos tableros nunca se esperan. Una clave tan amplia como "todas las
  columnas" también sería correcta, y haría que cada tablero esperase a todos los
  demás.
- **`before`** cuenta las columnas del tablero y coloca ahí la nueva: al final. Bajo
  el guard, nadie añade una columna entre ese recuento y esta escritura, así que dos
  columnas nunca reciben la misma posición.
- **`after`** cuenta otra vez, ya con la columna nueva escrita. Si hay más de diez,
  lanza `TooManyColumns`: la columna no se guarda.

Ahora la historia acaba bien:

```text
Ana   takes columns:<board>; places at 9; writes; counts 10 ≤ 10; commits
Bob   (waits for columns:<board>)
Bob   takes it; places at 10; writes; counts 11 > 10; rolls back → column.too_many
```

Ana y Bob añadieron al mismo tablero, así que el guard los hizo esperar su turno. El
recuento de `after` es la verdad, y sigue siéndolo hasta que el guardado confirma.

### El caso de uso comprueba primero, también

El módulo también cuenta antes de guardar:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
import { Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import {
  Column,
  ColumnAddSchema,
  ColumnRenameSchema,
  MAX_COLUMNS,
  type ColumnAddDTO,
  type ColumnDTO,
  type ColumnRenameDTO,
} from './column'
import type { Column_Deps } from './column.deps'
import { Column_Repository } from './column.repository'
import { registerColumnRoutes } from './column.routes'
import { ColumnNotFound } from './errors/column-not-found'
import { TooManyColumns } from './errors/too-many-columns'

/**
 * The columns of each board: the statuses its cards go through, in order. It knows
 * its boards; it does not know the cards, which point at their column.
 */
export class Column_Module extends Module {

  static initialize(base: BoardsBase, deps: Column_Deps): Column_Module {
    const module = new Column_Module(base, new Column_Repository(base), deps)
    registerColumnRoutes(base, module, deps)
    return module
  }

  private constructor(base: BoardsBase, private readonly repo: Column_Repository, private readonly deps: Column_Deps) {
    super('column', base.invocations)
  }

  /**
   * A board's columns, from left to right: whole, since a board has at most
   * `MAX_COLUMNS`. A board the workspace does not have has none.
   */
  @UseCase()
  async list(boardId: string): Promise<ColumnDTO[]> {
    return (await this.repo.ofBoard(boardId)).map(column => column.toDTO())
  }

  @UseCase()
  async get(id: string): Promise<ColumnDTO> {
    return (await this.load(id)).toDTO()
  }

  /** A new column, at the end of the board: a board has at most `MAX_COLUMNS`. */
  @UseCase()
  async add(boardId: string, input: ColumnAddDTO): Promise<ColumnDTO> {
    const { name } = ColumnAddSchema.parse(input)
    await this.deps.board.get(boardId)
    const count = await this.repo.count({ boardId })
    // For a clear answer in the usual case: the save counts again, where nothing slips in.
    if (count >= MAX_COLUMNS) throw new TooManyColumns(boardId)
    const column = Column.add({ workspaceId: currentWorkspaceId(), boardId, name, position: count })
    await this.repo.persistAdded(column)
    return column.toDTO()
  }

  @UseCase()
  async rename(id: string, input: ColumnRenameDTO): Promise<ColumnDTO> {
    const { name } = ColumnRenameSchema.parse(input)
    const column = await this.load(id)
    column.rename(name)
    await this.repo.persist(column)
    return column.toDTO()
  }

  private load(id: string): Promise<Column> {
    return this.resolve(() => this.repo.find({ id }), () => new ColumnNotFound(id))
  }
}
```

La comprobación de `add` da la respuesta clara en el caso habitual, antes de abrir una
transacción. No es la garantía: lo es `after`. Quédate con las dos. Lo mismo vale para
la posición: `add` crea la columna donde el final parecía estar, y `before` la coloca
donde el final está.

`add` también pregunta primero a `board.get(boardId)`. Ese caso de uso se ejecuta en el
espacio de trabajo actual, así que un tablero de otro espacio de trabajo, o ninguno, es
un `board.not_found`.

`list` devuelve las columnas enteras, no una página: un tablero nunca tiene más de
diez. `rename` toca una fila y no decide nada sobre las demás, así que la versión es
todo lo que necesita: un `persist` normal.

### Usar otro módulo

`column` usa `board`, y lo dice en su `.deps.ts`:

```ts
// cooper/backend/contexts/boards/modules/column/column.deps.ts
import type { Board_Module } from '../board/board.module'
import type { Member_Module } from '../member/member.module'

export interface Column_Deps {
  /** That the board a column is added to exists, in the current workspace. */
  board: Board_Module
  member: Member_Module
}
```

Un módulo llega a otro solo a través de sus casos de uso (su `.module.ts`), su esquema,
sus eventos, sus errores y sus objetos de valor. Nunca a su entidad, su repositorio,
sus tablas o sus rutas. La regla `newt/module-boundaries` del lint lo comprueba. Si
`column` importara el repositorio de `board`, `bun run lint` diría:

```text
'../board/board.repository' is board's own: a module reaches another through its use cases (`board.module.ts`), its schema, its events, its errors and its value objects  newt/module-boundaries
```

Por eso una columna guarda un `boardId` y nada más de su tablero, y por eso `add`
pregunta a `board.get` en vez de leer la tabla `board`.

### Sus rutas

Las rutas de columnas viven también en el grupo del espacio de trabajo: las columnas
de un tablero bajo el tablero, y una columna por su propio id.

```ts
// cooper/backend/contexts/boards/modules/column/column.routes.ts
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { ColumnAddDTO, ColumnRenameDTO } from './column'
import type { Column_Deps } from './column.deps'
import type { Column_Module } from './column.module'

export function registerColumnRoutes(base: BoardsBase, columns: Column_Module, deps: Column_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/columns', async request => Response.json(await columns.list(request.params.boardId)))

  workspace.post('/boards/:boardId/columns', async request => {
    const input = await request.json() as ColumnAddDTO
    return Response.json(await columns.add(request.params.boardId, input), { status: 201 })
  })

  workspace.patch('/columns/:columnId', async request => {
    const input = await request.json() as ColumnRenameDTO
    return Response.json(await columns.rename(request.params.columnId, input))
  })
}
```

`column` va después de `board` en `initializeModules`, porque lo usa:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Board_Module } from './modules/board/board.module'
import { Column_Module } from './modules/column/column.module'
import type { Workspaces } from './modules/member/member.deps'
import { Member_Module } from './modules/member/member.module'

/**
 * What `boards`' modules are given besides its base: what they need of auth, as ports
 * of their own (who belongs to each workspace). Whoever opens the context wires them.
 */
export type Boards_ModuleDeps = {
  workspaces: Workspaces
}

/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  return { member, board, column }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

### Sus tests

El segundo test es la carrera del principio del capítulo, multiplicada por ocho: ocho
columnas añadidas a la vez a un tablero de cinco. Entran cinco, se rechazan tres, y las
posiciones van de 0 a 9 sin huecos.

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'
import { MAX_COLUMNS } from './column.schema'

describe('column', () => {
  let t: TestBoards
  let boardId: string

  beforeEach(async () => {
    t = await openTestBoards()
    t.auth.join('acme', 'ana')
    boardId = (await inAcme(() => t.modules.board.create({ name: 'Roadmap' }))).id
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>) => t.as('ana', 'acme', fn)
  const add = (name: string) => inAcme(() => t.modules.column.add(boardId, { name }))
  const names = async () => (await inAcme(() => t.modules.column.list(boardId))).map(column => `${column.position}:${column.name}`)

  test('adds columns at the end of the board, up to ten', async () => {
    for (let i = 1; i <= MAX_COLUMNS; i++) await add(`Step ${i}`)

    await expect(add('One more')).rejects.toMatchObject({ code: 'column.too_many' })
    expect(await names()).toEqual(Array.from({ length: MAX_COLUMNS }, (_, i) => `${i}:Step ${i + 1}`))
  })

  test('lets in only the columns that fit, when many are added at once', async () => {
    for (let i = 1; i <= 5; i++) await add(`Step ${i}`)

    const added = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => add(`More ${i}`)))

    expect(added.filter(each => each.status === 'fulfilled')).toHaveLength(5)
    for (const each of added.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'column.too_many' })
    expect((await names()).map(name => Number(name.split(':')[0]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  test('renames a column', async () => {
    const todo = await add('To do')
    expect((await inAcme(() => t.modules.column.rename(todo.id, { name: ' Backlog ' }))).name).toBe('Backlog')
  })

  test('adds columns only to a board of the workspace', async () => {
    await expect(inAcme(() => t.modules.column.add('nope', { name: 'To do' }))).rejects.toMatchObject({ code: 'board.not_found' })
  })
})
```

## Por qué decirlo, si SQLite ya hace turnos

En SQLite, las transacciones ya se ejecutan de una en una. La carrera de arriba no
puede ocurrir allí, con guard o sin él. Entonces, ¿por qué escribirlo?

Porque los módulos no saben sobre qué store se ejecutan (capítulo 5), y no todos los
stores hacen turnos:

| Store | Sin `guard` | Con `guard` |
|---|---|---|
| Ficheros, SQLite | Los guardados se ejecutan de uno en uno. | Igual. |
| Postgres, MySQL | Los guardados se ejecutan a la vez: dos `after` pueden contar antes de que ninguno confirme. | Los guardados que comparten una clave esperan su turno. |

Una regla que en SQLite se cumple solo por suerte se rompería, sin que nadie lo viera,
el día que `boards` pase a Postgres (capítulo 27). newt se encarga de que nunca lo
olvides, de dos maneras.

**En compilación.** Un guardado con `after` tiene que nombrar su `guard`, o no compila.
Cuando un `after` no comprueba ninguna regla sobre filas, escribe `guard: []`: quien
lea el guardado verá entonces que no hace falta ningún guard, en vez de preguntarse si
se olvidó uno.

**En ejecución: la regla del guard.** Un guardado que no protege nada y aun así lee
filas dentro de su transacción (un `find` o un `count` en `before`, `write` o `after`)
incumple la regla del guard, en todos los stores, SQLite incluido. Por defecto
(`guardRule: 'error'`) el guardado falla, y se revierte. Pruébalo: escribe `guard: []`
en `persistAdded`, y `bun test cooper` falla con

```text
error: [guard rule] column.add reads column in a save that guards nothing: on Postgres and MySQL another save may change what it read before it commits. Name what its rule protects in the save's guard
```

Un contexto puede bajarla a un aviso, que se imprime una vez por caso de uso y tabla,
con `guardRule: 'warn'` en las opciones de su `Base`, o desactivarla con `'off'`.
cooper mantiene el valor por defecto. La regla solo mira la transacción del propio
guardado: lo que un caso de uso lee antes de guardar (la entidad que cargó, su propia
comprobación) no es asunto suyo, ni tampoco una consulta que escribas tú mismo sobre
la conexión del store.

Vuelve a poner el guard antes de seguir.

## El nombre de un tablero, una vez por espacio de trabajo

El nombre de un tablero es la misma clase de regla, con "más de uno" en lugar de "más
de diez". Primero su error, un 409:

```ts
// cooper/backend/contexts/boards/modules/board/errors/board-name-taken.ts
import { ConflictError } from 'newt/core'

export class BoardNameTaken extends ConflictError {
  readonly code = 'board.name_taken'
  constructor(name: string) {
    super(`There is a board called ${name} in this workspace already`)
  }
}
```

### El guardado

En `board.repository.ts`, importa el error:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
import { Board, type BoardDTO } from './board'
import { BoardNameTaken } from './errors/board-name-taken'
// …
```

Luego añade `persistWithNameFree` después de `toEntity`:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
  /**
   * Saves a board only if no other one of its workspace has its name, whatever the
   * case: counted again after writing it, in its transaction, guarding the name in
   * lower case, so no other save of that name slips in between. `Roadmap` and
   * `ROADMAP` created at once cannot both have it. Only A to Z are folded, as `ieq`
   * and the table's unique index compare: `Ärger` and `ärger` are two names.
   */
  async persistWithNameFree(board: Board): Promise<void> {
    const { workspaceId, name } = board
    await this.save([board], each => this.write(each), {
      guard: [`boardName:${workspaceId}:${name.replace(/[A-Z]/g, letter => letter.toLowerCase())}`],
      after: async () => {
        if (await this.count({ name: { ieq: name } }) > 1) throw new BoardNameTaken(name)
      },
    })
  }
// …
```

`after` cuenta los tableros con este nombre, donde `ieq` significa igual sea cual sea
la capitalización de la A a la Z. El recuento incluye el tablero recién escrito, así
que más de uno significa que el nombre está ocupado. El ámbito del repositorio limita
el recuento al espacio de trabajo actual, y `softDelete` deja fuera los tableros
archivados: el nombre de un tablero archivado vuelve a estar libre.

La clave es por espacio de trabajo y por nombre: dos guardados de `Roadmap` y
`ROADMAP` en `acme` esperan su turno, y nada más los espera. Fíjate en cómo se
normaliza el nombre: solo de la A a la Z, no con `toLowerCase()`. **La clave tiene que
normalizar exactamente como compara la regla.** `ieq` y el índice único normalizan solo
de la A a la Z, así que para la regla `Ärger` y `ärger` son dos nombres, y sus
guardados no tienen nada que esperar. Normalizar más (`toLowerCase()`) seguiría siendo
seguro, solo que más lento: nombres distintos se esperarían entre sí. Normalizar
**menos** que la comparación es el fallo: dos nombres que la regla ve como uno
tendrían dos claves, y entrarían los dos.

### El índice único: la última palabra

La migración del capítulo 5 ya tiene la regla como índice:

```sql
CREATE UNIQUE INDEX board_name ON board (workspace_id, lower(name)) WHERE deleted_at IS NULL;
```

Es parcial (`WHERE deleted_at IS NULL`), así que un tablero archivado no retiene su
nombre. Y la tabla le dice lo mismo a todos los stores, con la opción `unique` de
`store.table`: ningunas dos filas (salvo una borrada de forma lógica) comparten un
espacio de trabajo y un nombre. Cambia el constructor:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
  constructor(base: BoardsBase) {
    super(base, base.store.table<BoardRow>('board', { unique: [['workspaceId', 'name']] }), {
      // Archiving stamps `deletedAt`: an archived board is in no list, and its name is free again.
      softDelete: true,
// …
```

SQLite ignora `unique`, porque sus índices ya lo dicen; el store de ficheros, que no
tiene índices, lo respeta. Una fila que toma un valor único que ya tiene otra es
rechazada por el store con `DuplicateValue`, un 409 (`duplicate_value`).

Así que en SQLite, en una carrera, el índice suele responder primero: el segundo
`ROADMAP` se rechaza al escribirlo, antes de que se ejecute su `after`.
`DuplicateValue` es una clase de `ConcurrencyConflict`, así que el caso de uso se
ejecuta de nuevo, una vez (el capítulo 8 explica el reintento), y esta vez su propia
comprobación encuentra el nombre y responde `board.name_taken`. El cliente recibe la
misma respuesta en ambos casos. Cada comprobación tiene su tarea:

- **La comprobación del caso de uso**: la respuesta clara en el caso habitual.
- **El `after` del guardado, bajo su guard**: la regla, cumplida de la misma manera en
  todos los stores, tengan los índices que tengan.
- **El índice único**: la última palabra de la base de datos. Escriba en la tabla quien
  escriba, dos filas con el mismo nombre nunca entran las dos.

El límite de columnas de un tablero no tiene ningún índice que lo respalde: ningún
índice puede decir "diez como máximo". Ahí el `after` es la única garantía.

### El módulo

`board.module.ts` importa el error y el objeto de valor:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
import type { Board_Deps } from './board.deps'
import { Board_Repository } from './board.repository'
import { registerBoardRoutes } from './board.routes'
import { BoardNameTaken } from './errors/board-name-taken'
import { BoardNotFound } from './errors/board-not-found'
import { BoardName } from './value-objects/board-name'
// …
```

`create` comprueba primero el nombre, para dar la respuesta clara, y luego guarda con
`persistWithNameFree`. Un caso de uso nuevo, `findByName`, encuentra un tablero por su
nombre, sea cual sea su capitalización, para otros módulos (lo usa un capítulo
posterior):

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
  /** For other modules: the board with this name, whatever its case, if there is one. */
  @UseCase()
  async findByName(name: string): Promise<BoardDTO | null> {
    const board = await this.repo.first({ name: { ieq: BoardName.from(name) } })
    return board?.toDTO() ?? null
  }

  @UseCase()
  async create(input: BoardCreateDTO): Promise<BoardDTO> {
    const { name, description } = BoardCreateSchema.parse(input)
    await this.assertNameFree(BoardName.from(name))
    const board = Board.create({ workspaceId: currentWorkspaceId(), name, description })
    await this.repo.persistWithNameFree(board)
    return board.toDTO()
  }
// …
```

`update` guarda de la misma manera, así que un cambio de nombre tampoco puede tomar un
nombre ocupado. Su comprobación deja fuera al propio tablero: renombrar `Roadmap` a
`ROADMAP` es válido.

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
  /** Renames it, describes it, or both. */
  @UseCase()
  async update(id: string, input: BoardUpdateDTO): Promise<BoardDTO> {
    const changes = BoardUpdateSchema.parse(input)
    const board = await this.load(id)
    if (changes.name !== undefined) await this.assertNameFree(BoardName.from(changes.name), id)
    board.update(changes)
    await this.repo.persistWithNameFree(board)
    return board.toDTO()
  }
// …
```

`archive` mantiene un `persist` normal: archivar libera un nombre, nunca toma uno.
Añade la comprobación después de `load`, al final de la clase:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
// …
  private load(id: string): Promise<Board> {
    return this.resolve(() => this.repo.find({ id }), () => new BoardNotFound(id))
  }

  /** For a clear answer in the usual case: the save checks it again, where nothing can slip in between. */
  private async assertNameFree(name: BoardName, exceptId?: string): Promise<void> {
    if (await this.repo.count({ name: { ieq: name }, id: exceptId === undefined ? undefined : { ne: exceptId } }) > 0) throw new BoardNameTaken(name)
  }
}
```

`id: { ne: exceptId }` se omite cuando `exceptId` es `undefined`: un campo o un
operador puesto a `undefined` no es ninguna condición, así que un filtro opcional no
necesita ningún `if`.

Por último, el comentario de la entidad sobre `archive` dice lo que significa ahora:

```ts
// cooper/backend/contexts/boards/modules/board/board.ts
  /** Out of every list, its name free again; its row stays, with what points at it. */
  archive(): void {
    this.markAsDeleted()
  }
// …
```

### Sus tests

En `board.test.ts`, sustituye el test `renames a board, describes it, or both` y el
test de archivar por estos. El segundo es la carrera de nombres; el tercero comprueba
que solo se normaliza de la A a la Z; el último, que un tablero archivado libera su
nombre.

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
// …
  test('gives a name to one board of a workspace, whatever its case; another workspace has its own', async () => {
    await create('Roadmap')

    await expect(create('ROADMAP')).rejects.toMatchObject({ code: 'board.name_taken' })
    expect((await t.as('bea', 'globex', () => t.modules.board.create({ name: 'roadmap' }))).workspaceId).toBe('globex')

    const bugs = await create('Bugs')
    await expect(inAcme(() => t.modules.board.update(bugs.id, { name: 'roadMAP' }))).rejects.toMatchObject({ code: 'board.name_taken' })
    expect((await inAcme(() => t.modules.board.update(bugs.id, { description: 'What is broken' }))).description).toBe('What is broken')
  })

  test('gives a name to one of several boards created with it at once, whatever its case', async () => {
    const created = await Promise.allSettled(['Roadmap', 'ROADMAP', 'roadmap', 'RoadMap'].map(create))

    expect(created.filter(each => each.status === 'fulfilled')).toHaveLength(1)
    for (const each of created.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'board.name_taken' })
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(1)
  })

  test('folds only A to Z when comparing names: letters beyond them are told apart by their case', async () => {
    await Promise.all([create('Ärger'), create('ärger')])

    await expect(create('äRGER')).rejects.toMatchObject({ code: 'board.name_taken' })
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(2)
  })

  test('archives a board: out of every list, and its name free again', async () => {
    const roadmap = await create('Roadmap')

    await inAcme(() => t.modules.board.archive(roadmap.id))

    await expect(inAcme(() => t.modules.board.get(roadmap.id))).rejects.toMatchObject({ code: 'board.not_found' })
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)
    expect((await create('Roadmap')).id).not.toBe(roadmap.id)
  })
// …
```

Y por HTTP, en `boards.context.test.ts`, el test del tablero añade también dos
columnas y prueba un nombre ocupado:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
  test('keeps a board and its columns', async () => {
    const board = await call<{ id: string, name: string }>('POST', '/acme/boards', { name: 'Roadmap' })
    expect(board).toMatchObject({ status: 201, body: { name: 'Roadmap', description: '' } })
    const id = board.body.id
    for (const name of ['To do', 'Done']) expect((await call('POST', `/acme/boards/${id}/columns`, { name })).status).toBe(201)
    expect((await call<{ name: string }[]>('GET', `/acme/boards/${id}/columns`)).body.map(column => column.name)).toEqual(['To do', 'Done'])
    expect(await call('POST', '/acme/boards', { name: 'ROADMAP' })).toMatchObject({ status: 409, body: { code: 'board.name_taken' } })
// …
```

## Compruébalo

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint
```

Arranca el servidor (`bun cooper/backend/index.ts`; la migración nueva se aplica al
abrir), y en otra terminal crea un tablero, y luego otro con el mismo nombre en
mayúsculas:

```sh
curl -X POST -H 'x-user: ana' -H 'content-type: application/json' -d '{"name":"Launch"}' localhost:3002/api/workspaces/acme/boards
# {"id":"01a1…","workspaceId":"acme","name":"Launch",…}
curl -X POST -H 'x-user: ana' -H 'content-type: application/json' -d '{"name":"LAUNCH"}' localhost:3002/api/workspaces/acme/boards
# {"error":"There is a board called LAUNCH in this workspace already","code":"board.name_taken"}
```

Añade una columna al primer tablero (pon su id en lugar de `<board>`), y lístalas:

```sh
curl -X POST -H 'x-user: ana' -H 'content-type: application/json' -d '{"name":"To do"}' localhost:3002/api/workspaces/acme/boards/<board>/columns
# {"id":"01a1…","workspaceId":"acme","boardId":"<board>","name":"To do","position":0,…}
curl -H 'x-user: ana' localhost:3002/api/workspaces/acme/boards/<board>/columns
# [{"id":"01a1…","workspaceId":"acme","boardId":"<board>","name":"To do","position":0,…}]
```

Añade nueve más, y la undécima se rechaza:

```sh
curl -X POST -H 'x-user: ana' -H 'content-type: application/json' -d '{"name":"One more"}' localhost:3002/api/workspaces/acme/boards/<board>/columns
# {"error":"Board <board> has 10 columns already: that is the most a board has","code":"column.too_many"}
```

## Qué recordar

- Una versión protege una fila. Una regla sobre varias filas se comprueba en el
  `after` del guardado, dentro de su transacción, después de las escrituras: si lanza
  un error, se revierte todo.
- El guardado nombra en `guard` lo que protege la regla, con claves tan estrechas como
  la regla (por tablero, por espacio de trabajo y nombre). Los guardados que comparten
  una clave nunca se ejecutan a la vez, en ningún store. Normaliza una clave
  exactamente como compara la regla.
- `before` lee y escribe lo que debe ir primero (el lugar de una columna nueva), donde
  nada se cuela.
- Un guardado con `after` tiene que nombrar su `guard` (`guard: []` cuando no hace
  falta ninguno), y la regla del guard rechaza, por defecto, un guardado que lee filas
  y no protege nada.
- Comprueba primero también en el caso de uso, para dar la respuesta clara; cuando un
  índice puede decir la regla, tiene la última palabra (`DuplicateValue`).

Siguiente: [Tarjetas y un contador compartido](./07-cards-and-a-counter).
