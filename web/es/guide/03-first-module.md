# Tu primer módulo: los tableros

Este capítulo construye el módulo `board` de `boards`, fichero a fichero. Es pequeño,
pero tiene todas las piezas que tiene un módulo, y todos los demás módulos de cooper se
escriben igual. Úsalo de plantilla.

Un tablero pertenece a un workspace. Tiene un nombre, que no tiene ningún otro tablero
de su workspace, sin mirar mayúsculas, y una descripción. Cuando ya nadie lo necesita
se archiva: sale de todas las listas, pero su fila se queda, porque sus columnas y sus
tarjetas siguen apuntándole.

Estos son los ficheros, todos dentro de `cooper/backend/contexts/boards/modules/board/`:

```
board/
  board.schema.ts            el contrato: qué entra y qué sale
  value-objects/
    board-name.ts            el nombre de un tablero, con sus reglas
  board.ts                   la entidad
  events/                    lo que puede pasar
    board-created.ts
    board-updated.ts
    board-archived.ts
  errors/                    lo que puede salir mal
    board-not-found.ts
    board-name-taken.ts
    invalid-board-name.ts
  board.repository.ts        cómo se guarda
  board.deps.ts              los módulos que usa
  board.module.ts            sus casos de uso
  board.routes.ts            su API HTTP
  board.test.ts              sus tests
```

## 1. El contrato

Todo empieza por describir los datos con `zod`. Este fichero es el **contrato
público** del módulo: lo que entra en sus casos de uso y lo que sale de ellos. Es
también el único fichero del backend que pueden importar los clientes de la API de los
frontends.

```ts
// cooper/backend/contexts/boards/modules/board/board.schema.ts
import { z } from 'zod'
import { BoardName } from './value-objects/board-name'

export const BoardSchema = z.object({
  id: z.uuidv7(),
  /** The workspace it is in: an auth tenant, by id. */
  workspaceId: z.string(),
  /** Its workspace's once, whatever its case. */
  name: BoardName.schema,
  description: z.string().max(500),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** As someone types it: the name is made a `BoardName` by the board itself. */
export const BoardCreateSchema = z.object({
  name: z.string(),
  description: z.string().trim().pipe(BoardSchema.shape.description).default(''),
})
export const BoardUpdateSchema = z.object({
  name: BoardCreateSchema.shape.name,
  description: z.string().trim().pipe(BoardSchema.shape.description),
}).partial()

export type BoardDTO = z.infer<typeof BoardSchema>
export type BoardCreateDTO = z.input<typeof BoardCreateSchema>
export type BoardUpdateDTO = z.input<typeof BoardUpdateSchema>
```

- **`BoardSchema`** es el tablero completo. Su tipo, `BoardDTO`, es lo que ven los
  demás módulos y la API: un *DTO* (objeto de transferencia), datos planos sin
  comportamiento.
- Los esquemas de **entrada** (`Create`, `Update`) tienen solo lo que puede mandar un
  cliente. Nadie manda un `id`, un `workspaceId` ni unas fechas: los pone el sistema.
  El workspace, en concreto, sale de dónde está la petición (capítulo
  [5](./05-who-and-where)), nunca de su cuerpo.
- Los esquemas de entrada reutilizan las reglas del completo: la descripción se
  recorta y después pasa (`pipe`) por `BoardSchema.shape.description`, así que "como
  mucho 500 caracteres" se escribe una vez. El nombre se recibe como un string sin
  más: qué es un nombre lo decide el value object de abajo.
- `workspaceId` es cosa de otro contexto (un tenant de `auth`), así que el tablero
  solo guarda su id.
- Todo lo que exporta el fichero empieza por el nombre de la entidad (`Board…`). Se lee
  igual desde cualquier sitio.

## 2. Un valor con reglas: `BoardName`

Algunos valores tienen reglas propias. Un email se guarda en minúsculas y sin
espacios. El nombre de un tablero se recorta, lleva un solo espacio entre palabras y
tiene de 1 a 60 caracteres, así que ` Road  map ` y `Road map` son el mismo nombre. Un
**value object** guarda esas reglas en un solo sitio: un tipo y una constante con el
mismo nombre.

```ts
// cooper/backend/contexts/boards/modules/board/value-objects/board-name.ts
import type { ValueObject } from 'newt/core'
import { z } from 'zod'
import { InvalidBoardName } from '../errors/invalid-board-name'

const MAX_LENGTH = 60

/**
 * A board's name: 1 to 60 characters, without spaces around it nor two in a row, so
 * ` Road  map ` and `Road map` are one name. A string at runtime; to the compiler, only
 * one that went through `BoardName.from` or `BoardName.schema` is a `BoardName`.
 */
export type BoardName = string & z.$brand<'BoardName'>

export const BoardName = {
  /** How it is kept: what `from` makes of what someone typed. */
  schema: z.string()
    .min(1)
    .max(MAX_LENGTH)
    .refine(name => name === tidy(name), 'A board\'s name has no spaces around it, nor two in a row')
    .brand<'BoardName'>(),
  from(value: string): BoardName {
    const name = tidy(value)
    if (name.length === 0 || name.length > MAX_LENGTH) throw new InvalidBoardName(value)
    return name as BoardName
  },
} satisfies ValueObject<BoardName, string>

function tidy(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}
```

Tiene dos mitades:

- **`from`** convierte lo que alguien escribió en el valor, o lanza un error de
  validación (400) que dice qué está mal: `InvalidBoardName`.
- **`schema`** describe cómo se **guarda** el valor. Es estricto: no arregla nada,
  rechaza un nombre que no esté ya limpio. Va en el esquema de la entidad.

`satisfies ValueObject<BoardName, string>` comprueba que la constante tiene las dos
mitades, con los tipos correctos.

### El brand: que el compilador te cuide

En ejecución, un `BoardName` es un `string`. Para TypeScript, un `string` cualquiera
**no es** un `BoardName` hasta que pasa por `BoardName.from` o por `BoardName.schema`.
A eso se le llama *brand*. Hace imposible guardar un nombre sin limpiar por despiste: un
campo con tipo `BoardName` no lo acepta.

newt trae dos value objects propios, hechos igual: `Email` y `SecretToken`. `auth`
guarda cada email como un `Email`, y el brand viaja: no se puede enviar un correo a una
dirección que nadie comprobó, porque el mailer pide un `Email`:

```ts
// cooper/backend/shared/mail/mailer.ts
import type { Email } from 'newt/core'

/** One email: plain text, which every reader shows. */
export type Mail = {
  to: Email
  subject: string
  text: string
}
```

### Dónde se aplica `from`

El esquema de entrada acepta el nombre tal como lo escribe la persona (`z.string()`).
La entidad aplica `BoardName.from` al crearse o al renombrarse, como verás ahora. Así
todos los caminos que crean o renombran un tablero (una ruta, una herramienta MCP, un
worker, el seed) pasan por la misma regla.

Un value object que usa un solo módulo vive en su carpeta `value-objects/`. Uno que
comparten varios vive en la aplicación (`cooper/backend/shared`) o, como `Email`, en el
framework.

## 3. La entidad

La entidad es el esquema **más su comportamiento**. Guarda datos válidos, sabe qué ha
cambiado y anota lo que ha pasado.

```ts
// cooper/backend/contexts/boards/modules/board/board.ts
import { Entity, type EntityInput } from 'newt/core'
import { BoardSchema, type BoardDTO } from './board.schema'
import { Board_Archived } from './events/board-archived'
import { Board_Created } from './events/board-created'
import { Board_Updated } from './events/board-updated'
import { BoardName } from './value-objects/board-name'

export * from './board.schema'

/** A workspace's board: its columns and cards are other modules', which point at it. */
export class Board extends Entity<typeof BoardSchema> {

  private constructor(input: EntityInput<BoardDTO>, isNew: boolean) {
    super(BoardSchema, input, isNew)
  }

  static fromDTO(dto: BoardDTO & { version: number }): Board {
    return new Board(dto, false)
  }

  /** A new one, in its workspace: the name as someone typed it becomes a `BoardName`. */
  static create(input: { workspaceId: string, name: string, description: string }): Board {
    const board = new Board({ ...input, name: BoardName.from(input.name) }, true)
    board.trackEvent(new Board_Created(board.toDTO()))
    return board
  }

  get workspaceId(): string {
    return this.data.workspaceId
  }

  get name(): BoardName {
    return this.data.name
  }

  update(changes: { name?: string, description?: string }): void {
    this.change({
      ...(changes.name === undefined ? {} : { name: BoardName.from(changes.name) }),
      ...(changes.description === undefined ? {} : { description: changes.description }),
    })
    const diff = this.getChanges()
    if (diff) this.trackEvent(new Board_Updated({ dto: this.toDTO(), changes: diff, previous: this.getPrevious()! }))
  }

  /** Out of every list, its name free again; its row stays, with what points at it. */
  archive(): void {
    this.markAsDeleted()
    this.trackEvent(new Board_Archived(this.toDTO()))
  }
}
```

Las ideas que hay detrás:

- **Dos puertas de entrada.** `create` para algo nuevo; `fromDTO` para algo que se lee
  del store: la fila, que trae su `version`, y sin ella no se puede construir (al
  guardarla, la versión dice si alguien la cambió entretanto). Si una entidad es nueva
  lo decide la puerta por la que entra, nunca si trae `id` o no. El constructor es
  privado: no hay tercera puerta.
- **Se pone sola su id y sus fechas.** `create` no pasa ni `id`, ni `createdAt`, ni
  `updatedAt`: la entidad se da un UUIDv7 y las fechas.
- **Solo la entidad se cambia a sí misma.** `change()` es protegido: desde fuera no se
  puede llamar. Un caso de uso llama a `update()` o a `archive()`, métodos con nombre de
  negocio. `change()` valida la entidad entera contra su esquema (también sus
  `refine`), guarda los valores que devuelve el esquema e ignora lo que no cambia de
  verdad.
- **Sabe qué cambia.** `getChanges()` da los campos que cambiaron, tal como quedan;
  `getPrevious()`, esos mismos campos tal como estaban al leerla. Juntos son la
  transición que hará el guardado.
- **Anota lo que pasa.** `trackEvent` apunta un evento. Todavía no se publica: se
  publicará cuando la entidad se guarde, y solo si el guardado sale bien (capítulo
  [10](./10-events)).
- **Archivar es un borrado que el repositorio suaviza.** `markAsDeleted()` dice que la
  entidad ya no está; el repositorio, configurado con `softDelete`, conserva la fila y
  pone `deletedAt` en lugar de borrarla. Una entidad borrada ya no se puede cambiar.
- **Fuera de su módulo, una entidad no existe.** Los casos de uso devuelven `toDTO()`,
  nunca la entidad. Los getters de solo lectura (`workspaceId`, `name`) son para el
  código del propio módulo.
- **Tiene una versión**, que empieza en 0 y sube con cada guardado que la escribe. No
  la toques nunca: es la que impide que dos personas se pisen (capítulo
  [7](./07-concurrency)).

### Sus métodos reciben datos de negocio, no el DTO de entrada

`create` no recibe un `BoardCreateDTO`. Parecen lo mismo, pero no lo son:

- El **DTO de entrada** es el contrato de la API: lo que manda un cliente, *antes* de
  comprobarlo. Puede traer campos de más, textos sin recortar, cosas que no existen.
- Lo que recibe la entidad es lo que **necesita para nacer**, ya comprobado y a menudo
  **completado** por el caso de uso.

Aquí la diferencia es `workspaceId`. El cliente no lo manda nunca, y no debe poder
elegirlo: el caso de uso lo toma del workspace en el que está la petición. La
convención es sencilla: si la entrada es pequeña, va escrita en línea, como en
`Board.create`; si merece un nombre, es un tipo con nombre de negocio en el fichero de
la entidad, nunca con sufijo `DTO` y nunca en el fichero del esquema, que es el
contrato de la API.

## 4. Los eventos

Un evento es una clase pequeña con un nombre y un *payload* (lo que cuenta):

```ts
// cooper/backend/contexts/boards/modules/board/events/board-created.ts
import type { DomainEvent } from 'newt/core'
import type { BoardDTO } from '../board.schema'

export class Board_Created implements DomainEvent<BoardDTO> {
  static readonly eventName = 'board.created'
  readonly name = Board_Created.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: BoardDTO) {}
}
```

```ts
// cooper/backend/contexts/boards/modules/board/events/board-updated.ts
import type { DomainEvent } from 'newt/core'
import type { BoardDTO } from '../board.schema'

/** The whole board as it is now, the fields that changed (`changes`) and what they were (`previous`). */
type BoardChange = { dto: BoardDTO, changes: Partial<BoardDTO>, previous: Partial<BoardDTO> }

export class Board_Updated implements DomainEvent<BoardChange> {
  static readonly eventName = 'board.updated'
  readonly name = Board_Updated.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: BoardChange) {}
}
```

`board-archived.ts` es como `board-created.ts`, con `'board.archived'`.

- El nombre tiene la forma `<módulo>.<verbo en pasado>`.
- El payload es JSON: un worker lo recibe de un trabajo guardado, así que una fecha
  viaja como su texto ISO, nunca como `Date`. Por eso también `BoardChange` es un
  `type` y no una `interface`, que TypeScript no acepta como JSON.
- Un `updated` cuenta la **transición** entera: `dto`, el tablero tal como queda;
  `changes`, solo los campos que cambiaron, con su valor nuevo; `previous`, esos mismos
  campos con el valor que tenían. Renombrar `Roadmap` a `Plans` cuenta
  `changes: { name: 'Plans' }` y `previous: { name: 'Roadmap' }`. Quien escucha no
  tiene que volver a preguntar, y puede ignorar los cambios que no le interesan.

El capítulo [10](./10-events) cuenta cuándo se publica un evento, y por qué cada tipo
se cuenta una sola vez por guardado.

## 5. Los errores

Cada cosa que puede salir mal es una clase con un `code` estable. La clase de la que
hereda decide el código HTTP:

```ts
// cooper/backend/contexts/boards/modules/board/errors/board-not-found.ts
import { NotFoundError } from 'newt/core'

export class BoardNotFound extends NotFoundError {
  readonly code = 'board.not_found'
  constructor(id: string) {
    super(`There is no board ${id}`)
  }
}
```

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

```ts
// cooper/backend/contexts/boards/modules/board/errors/invalid-board-name.ts
import { ValidationError } from 'newt/core'

export class InvalidBoardName extends ValidationError {
  readonly code = 'board.invalid_name'
  constructor(value: string) {
    super(`'${value}' is not a board's name: it has 1 to 60 characters`)
  }
}
```

Los errores de un módulo viven en su carpeta `errors/`, uno por fichero. El `code` es
`<módulo>.<qué>`, y no cambia nunca: el código del cliente decide qué hacer a partir de
él. El mensaje es para que lo lea una persona. Estas son las bases que te da newt:

| Base | HTTP | Cuándo |
|---|---|---|
| `NotFoundError` | 404 | Lo que se pide no existe. |
| `ValidationError` | 400 | La entrada está mal. |
| `ReferenceNotFound` | 400 | Un id **dentro** de la entrada no apunta a nada. |
| `UnauthorizedError` | 401 | No hay sesión. |
| `ForbiddenError` | 403 | Hay sesión, pero no tiene permiso. |
| `ConflictError` | 409 | El estado actual no lo permite. |
| `ConcurrencyConflict` | 409 | Alguien lo guardó mientras tanto. |

Bajo `/api`, el cliente recibe siempre `{ error, code }` (y, si el cuerpo no pasó el
esquema, sus `issues`).

### Los mensajes del framework, con tus palabras

Los errores propios del framework (`not_signed_in`, `validation`,
`concurrency_conflict`…) tienen mensajes en inglés llano: correctos, pero escritos
para un desarrollador. Una aplicación los sustituye **una vez, al arrancar**, con
`setMessages` de `newt/core`, para hablarle a quien la usa, o para hablar otro idioma.
cooper sigue en inglés y cambia el tono:

```ts
// cooper/backend/shared/messages.ts
import { setMessages, type Messages } from 'newt/core'

/**
 * What cooper says when something newt owns goes wrong, in cooper's words: newt's
 * defaults are plain and right, these speak to the person using the app. Its own
 * errors' messages each module writes itself (`errors/`); the `code` a client acts
 * on never changes (ch. 22.2).
 */
export const cooperMessages: Partial<Messages> = {
  concurrency_conflict: () => 'Someone else changed this a moment ago. Reload it and try again.',
  reference_not_found: ({ resource, id }) => `That ${resource} is not there any more (${id})`,
  not_signed_in: () => 'Your session has ended: sign in again to go on',
  validation: () => 'Some of what was sent is not right: check the fields and try again',
  route_not_found: ({ method, path }) => `Cooper has nothing at ${method} ${path}`,
  internal: () => 'Something went wrong on our side. Try again in a moment.',
}

/**
 * Sets cooper's messages for the whole process: once, as the server starts
 * (`index.ts`), before any request. Every context answers with them.
 */
export function setCooperMessages(): void {
  setMessages(cooperMessages)
}
```

Es `Partial`: el mensaje que no da se queda con el de newt. Solo cambia el mensaje; el
`code` sigue siendo `not_signed_in`, y un cliente que actúa según él no nota nada. Los
mensajes son del proceso, no de un contexto, así que `index.ts` los pone antes de abrir
ninguno (capítulo [2](./02-a-context)). El test de cooper lo ejecuta en un proceso
propio, porque los demás tests del mismo proceso leen los de newt:

```ts
// cooper/backend/shared/messages.test.ts
expect(JSON.parse(await new Response(child.stdout).text())).toEqual({
  conflict: 'Someone else changed this a moment ago. Reload it and try again.',
  reference: 'That column is not there any more (c1)',
  route: { status: 404, body: { error: 'Cooper has nothing at GET /api/nothing', code: 'route_not_found' } },
})
```

Los mensajes de tus propios errores los escribes tú, en cada clase de error, como
arriba.

## 6. El repositorio

El repositorio es **lo único** que lee y escribe tableros. Cuando las entidades son
filas de una tabla, como aquí, basta con heredar de `TableRepository` y decir cómo una
fila se convierte en entidad:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Board, type BoardDTO } from './board'
import { BoardNameTaken } from './errors/board-name-taken'

/** Its row: the board, its version, and when it was archived (soft deleted). */
export type BoardRow = BoardDTO & { version: number, deletedAt: string | null }

export class Board_Repository extends TableRepository<Board, BoardRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<BoardRow>('board', { unique: [['workspaceId', 'name']] }), {
      // Archiving stamps `deletedAt`: an archived board is in no list, and its name is free again.
      softDelete: true,
      // Every find, count and page sees the current workspace's boards only.
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
  }

  protected toEntity(row: BoardRow): Board {
    return Board.fromDTO(row)
  }

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

  // … recentInEveryScope, for the staff (chapter 22), and purgeWorkspace, for when auth deletes a workspace (chapter 16)
}
```

Con eso ya tienes `find`, `first`, `count`, `page` y `persist`. Tres opciones dan forma
a esta tabla:

- **`unique`** dice qué campos no pueden repetirse, con palabras que entiende cualquier
  store. Un store SQL ya lo sabe por el índice único de su migración (abajo) e ignora la
  opción; el store de ficheros lo comprueba él.
- **`softDelete: true`** convierte el borrado que pide `archive()` en una marca en
  `deletedAt`. Los tableros archivados desaparecen de todo `find`, `count` y `page`.
- **`scope`** hace que cada lectura vea solo los tableros del workspace actual, y que
  cada escritura compruebe que se queda en él. Un caso de uso no puede olvidarse del
  workspace, porque nunca lo escribe. El capítulo [5](./05-who-and-where) explica los
  ámbitos.

`persistWithNameFree` es la forma propia del tablero de guardarse: mantiene la regla
"un nombre por workspace, sin mirar mayúsculas" aunque dos personas creen `Roadmap` y
`ROADMAP` en el mismo instante. Los capítulos [7](./07-concurrency) y
[8](./08-rules-over-rows) explican `guard` y `after`. De momento, léelo como "guarda, y
si otro tablero del workspace tiene este nombre, deshazlo todo y dilo".

### Criterios

Para buscar, un repositorio recibe **criterios**, campo a campo:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
this.repo.find({ id })                                  // igual a
this.repo.first({ name: { ieq: BoardName.from(name) } }) // igual, sin mirar mayúsculas (de la A a la Z)
this.repo.count({ name: { ieq: name }, id: exceptId === undefined ? undefined : { ne: exceptId } })
this.repo.page({}, page, { newestFirst: true })         // una página
```

Los operadores son `eq`, `ne`, `in`, `gt`, `gte`, `lt`, `lte` e `ieq`. Un campo que
vale `undefined` no es ninguna condición, así que un filtro opcional no necesita `if`:
en el `count` de arriba, `id` solo cuenta cuando hay un `exceptId`. Los campos de un
criterio se cumplen todos a la vez; para un "o" hay grupos `and` y `or` (capítulo
[23](./23-search)).

### La tabla

El repositorio dice `'board'`; la tabla la crea una migración SQL del contexto
(capítulo [24](./24-migrations)). Los campos van en camelCase en el código y en
snake_case en SQL: el store los traduce.

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
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

El índice parcial (`WHERE deleted_at IS NULL`) es lo que libera el nombre de un tablero
archivado. No hay clave foránea en `workspace_id`: el workspace vive en la base de
datos de otro contexto.

## 7. El módulo y sus casos de uso

El módulo lo junta todo: el repositorio, los eventos que ofrece a los demás y sus
casos de uso.

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
import { eventsOf, Module, UseCase, type Page, type PageRequest } from 'newt/core'
// … the module's own imports

/**
 * The boards of each workspace. Every use case works in the current workspace (the
 * scope its route, worker or script entered): the repository sees no other. Those
 * another context calls name their workspace instead, and enter it.
 */
export class Board_Module extends Module {

  static initialize(base: BoardsBase, deps: Board_Deps): Board_Module {
    const module = new Board_Module(base, new Board_Repository(base))
    registerBoardRoutes(base, module, deps)
    return module
  }

  readonly events

  private constructor(base: BoardsBase, private readonly repo: Board_Repository) {
    super('board', base.invocations)
    this.events = eventsOf(base.bus, { created: Board_Created, updated: Board_Updated, archived: Board_Archived })
  }

  /** A page of the workspace's boards, the newest first. */
  @UseCase()
  async list(page: PageRequest): Promise<Page<BoardDTO>> {
    const found = await this.repo.page({}, page, { newestFirst: true })
    return {
      items: found.items.map(board => board.toDTO()),
      hasMore: found.hasMore,
      total: found.total,
    }
  }

  @UseCase()
  async get(id: string): Promise<BoardDTO> {
    return (await this.load(id)).toDTO()
  }

  @UseCase()
  async create(input: BoardCreateDTO): Promise<BoardDTO> {
    const { name, description } = BoardCreateSchema.parse(input)
    await this.assertNameFree(BoardName.from(name))
    const board = Board.create({ workspaceId: currentWorkspaceId(), name, description })
    await this.repo.persistWithNameFree(board)
    return board.toDTO()
  }

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

  /** Out of every list for good; its columns and cards stay, pointing at it. */
  @UseCase()
  async archive(id: string): Promise<void> {
    const board = await this.load(id)
    board.archive()
    await this.repo.persist(board)
  }

  // … listOf, recentInEveryWorkspace, findByName and purgeWorkspace, for other modules and contexts

  private load(id: string): Promise<Board> {
    return this.resolve(() => this.repo.find({ id }), () => new BoardNotFound(id))
  }

  /** For a clear answer in the usual case: the save checks it again, where nothing can slip in between. */
  private async assertNameFree(name: BoardName, exceptId?: string): Promise<void> {
    if (await this.repo.count({ name: { ieq: name }, id: exceptId === undefined ? undefined : { ne: exceptId } }) > 0) throw new BoardNameTaken(name)
  }
}
```

- **`super('board', …)`** da nombre al módulo, y **`@UseCase()`** convierte cada método
  público en un caso de uso que se llama `board.create`, `board.update`… Son los
  nombres que verás en las trazas, en los nombres de las colas y en la regla de
  escritura.
- **`events`** reúne los eventos que el módulo ofrece a los demás.
  `eventsOf(base.bus, { created: Board_Created, … })` los construye con sus tipos, y
  desde fuera se leen como lo que son: `board.events.created`. El capítulo
  [11](./11-reacting) los usa.
- **`static initialize`** crea el módulo y registra sus rutas. Es lo que llama el
  contexto. El constructor es privado.
- **`currentWorkspaceId()`** es de donde sale el workspace del tablero: el ámbito en el
  que entró la ruta, nunca el cuerpo de la petición.
- **`resolve(buscar, siNoHay)`** convierte una búsqueda en una entidad o en el error
  que elijas: aquí `BoardNotFound`, un 404. El capítulo [4](./04-use-cases) dice cuándo
  elegir cuál.
- **`assertNameFree`** comprueba el nombre antes de escribir nada, para responder con
  claridad en el caso normal. El guardado lo vuelve a comprobar, donde nada puede
  colarse entre medias.
- Si alguien cambió el tablero entre leerlo y guardarlo, el caso de uso se repite solo:
  capítulo [7](./07-concurrency).

### Lo que usa: `board.deps.ts`

Un módulo dice qué otros módulos usa en su fichero `deps`:

```ts
// cooper/backend/contexts/boards/modules/board/board.deps.ts
import type { Member_Module } from '../member/member.module'

export interface Board_Deps {
  /** Who may enter each workspace: its routes run in the workspace scope it gives. */
  member: Member_Module
}
```

Los casos de uso del tablero no necesitan nada de otros módulos. Sus rutas sí: se
ejecutan dentro de un workspace, y el módulo `member` es el que dice quién puede entrar
en él. El capítulo [17](./17-modules-talk) trata de las dependencias.

## 8. Las rutas

Una ruta lee la petición, llama a un caso de uso y responde. **Nada más.** Toda la
lógica vive en el caso de uso, para que funcione igual llamado desde HTTP, desde una
herramienta MCP, desde un script o desde otro módulo.

```ts
// cooper/backend/contexts/boards/modules/board/board.routes.ts
import { pageRequestFrom } from 'newt/http'
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { BoardCreateDTO, BoardUpdateDTO } from './board'
import type { Board_Deps } from './board.deps'
import type { Board_Module } from './board.module'

export function registerBoardRoutes(base: BoardsBase, boards: Board_Module, deps: Board_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards', async request => Response.json(await boards.list(pageRequestFrom(request))))

  workspace.post('/boards', async request => {
    const input = await request.json() as BoardCreateDTO
    return Response.json(await boards.create(input), { status: 201 })
  })

  workspace.get('/boards/:boardId', async request => Response.json(await boards.get(request.params.boardId)))

  workspace.patch('/boards/:boardId', async request => {
    const input = await request.json() as BoardUpdateDTO
    return Response.json(await boards.update(request.params.boardId, input))
  })

  workspace.post('/boards/:boardId/archive', async request => {
    await boards.archive(request.params.boardId)
    return new Response(null, { status: 204 })
  })
}
```

- **`workspaceRoutes`** es un grupo del router, bajo `/workspaces/:workspaceId`. Su
  middleware comprueba que la persona con sesión pertenece al workspace, y ejecuta la
  ruta dentro de él. Todos los módulos de `boards` registran sus rutas en él. El
  capítulo [5](./05-who-and-where) lo construye.
- Todas las rutas cuelgan de `/api`: `/boards` es
  `/api/workspaces/:workspaceId/boards`.
- El camino tipa sus parámetros: en `/boards/:boardId`, `request.params.boardId`
  existe y es un `string`.
- **Toda ruta exige un actor**, salvo que la registres con `{ public: true }`. Sin
  actor, responde 401.
- **No hay `try/catch`.** Si el caso de uso lanza un `BoardNotFound`, el router
  responde 404 con `{ error, code }`. Un cuerpo que no pasa el esquema del caso de uso
  es un 400 (`validation`, con sus `issues`); uno que no se puede leer, un 400
  (`malformed_body`); un cuerpo JSON enviado sin `Content-Type: application/json`, un
  415 (`unsupported_media_type`). Cualquier otro error es un 500 que no cuenta nada de
  dentro.
- `as BoardCreateDTO` no comprueba nada, solo le da un tipo al editor. La comprobación
  es el `parse` del caso de uso.

## 9. Registrarlo

En el contexto, el módulo se inicializa en `initializeModules`, después de los módulos
que usa:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
export function initializeModules(base: BoardsBase, config: Boards_Config, deps: Boards_ModuleDeps) {
  // …
  const member = Member_Module.initialize(base, { workspaces: deps.workspaces })
  const board = Board_Module.initialize(base, { member })
  const column = Column_Module.initialize(base, { board, member })
  // …
  return { session, member, board, column, card, workspace, activity, outbox }
}
```

`member` va antes que `board` porque `board` lo usa; `column` va después porque usa
`board`. Si te equivocas de orden, TypeScript te avisa: no puedes pasar una variable
antes de declararla.

## 10. Probarlo

Los tests de cooper abren el contexto de verdad, sobre SQLite en memoria, y llaman a
sus casos de uso como lo haría una ruta. `boards` tiene una ayuda que lo abre con un
`auth` falso detrás de sus puertos (quién pertenece a cada workspace se guarda en
memoria), y que toma quién manda una petición de una cabecera `x-user` en lugar de una
cookie de sesión:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const mails: Mail[] = []
  const lines: string[] = []
  const boards = await Boards_Context.open({ ...config.boards, dbPath: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
    tenants: auth.tenants,
    access: auth.access,
    auth: auth.modules,
    mailer: { send: async mail => { mails.push(mail) } },
    log: line => { lines.push(line) },
  })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId, via: 'web' as const } : null
  })
  return {
    // …
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` (or an MCP tool) does. */
    as<T>(userId: string, workspaceId: string, fn: () => Promise<T>, via: ActorVia = 'web'): Promise<T> {
      return runAsActor({ userId, via }, () => inWorkspace(boards.modules.member, workspaceId, fn))
    },
    // …
  }
}
```

Los tests del módulo se leen entonces como sus reglas:

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
describe('board', () => {
  let t: TestBoards

  beforeEach(async () => {
    t = await openTestBoards()
    t.auth.join('acme', 'ana')
    t.auth.join('globex', 'bea')
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>) => t.as('ana', 'acme', fn)
  const create = (name: string) => inAcme(() => t.modules.board.create({ name }))

  test('keeps a name as a board\'s name: trimmed, one space between words, 1 to 60 characters', async () => {
    expect(String((await create('  Road   map ')).name)).toBe('Road map')
    await expect(create('   ')).rejects.toMatchObject({ code: 'board.invalid_name' })
    await expect(create('x'.repeat(61))).rejects.toMatchObject({ code: 'board.invalid_name' })
  })

  test('gives a name to one board of a workspace, whatever its case; another workspace has its own', async () => {
    await create('Roadmap')

    await expect(create('ROADMAP')).rejects.toMatchObject({ code: 'board.name_taken' })
    expect((await t.as('bea', 'globex', () => t.modules.board.create({ name: 'roadmap' }))).workspaceId).toBe('globex')
    // …
  })

  test('archives a board: out of every list, and its name free again', async () => {
    const roadmap = await create('Roadmap')

    await inAcme(() => t.modules.board.archive(roadmap.id))

    await expect(inAcme(() => t.modules.board.get(roadmap.id))).rejects.toMatchObject({ code: 'board.not_found' })
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)
    expect((await create('Roadmap')).id).not.toBe(roadmap.id)
  })

  // …
})
```

```bash
bun test cooper/backend/contexts/boards/modules/board
```

### Por HTTP

`boards.context.test.ts` sirve ese mismo contexto de test en un puerto libre y lo llama
con `fetch`, con `x-user` diciendo quién llama. Estas son las respuestas que recibe,
petición a petición:

```http
POST /api/workspaces/acme/boards
x-user: ana
content-type: application/json

{"name":"  Road   map ","description":"What comes next"}

→ 201
{"id":"01a177d6-7444-750a-b84f-bb1e82121256","workspaceId":"acme","name":"Road map",
 "description":"What comes next","createdAt":"2026-10-26T10:51:45.605Z","updatedAt":"2026-10-26T10:51:45.605Z"}
```

```http
POST /api/workspaces/acme/boards
{"name":"ROAD MAP"}

→ 409
{"error":"There is a board called ROAD MAP in this workspace already","code":"board.name_taken"}
```

```http
POST /api/workspaces/acme/boards
{"name":"   "}

→ 400
{"error":"'   ' is not a board's name: it has 1 to 60 characters","code":"board.invalid_name"}
```

```http
POST /api/workspaces/acme/boards
{"description":5}

→ 400
{"error":"The request is not valid","code":"validation","issues":[
  {"expected":"string","code":"invalid_type","path":["name"],"message":"Invalid input: expected string, received undefined"},
  {"expected":"string","code":"invalid_type","path":["description"],"message":"Invalid input: expected string, received number"}]}
```

```http
GET /api/workspaces/acme/boards/nope

→ 404
{"error":"There is no board nope","code":"board.not_found"}
```

```http
GET /api/workspaces/acme/boards
x-user: bea

→ 404
{"error":"There is no workspace acme","code":"workspace.not_found"}
```

La última es Bea, que no está en Acme. Para ella, Acme no existe: el capítulo
[5](./05-who-and-where) explica por qué es un 404 y no un 403.

El test no llama a `setCooperMessages`, así que la respuesta de `validation` de arriba
lleva el mensaje propio de newt. El servidor en marcha responde a la misma petición con
el de cooper: `"Some of what was sent is not right: check the fields and try again"`,
y el mismo `code` y los mismos `issues`.

En la app en marcha, después de `bun run cooper:seed`, las filas están en
`data/cooper-boards.db`:

```bash
sqlite3 -header -column data/cooper-boards.db "select name, description, version, deleted_at from board"
```

```
name     description                                                          version  deleted_at
-------  -------------------------------------------------------------------  -------  ----------
Welcome  A first board to find your way around: move the card, add your own.        1
Launch   Everything left before Acme's launch.                                      1
```

Cada tablero tiene una columna más que su DTO: `version`, que vale 1 después de su
primer guardado.

## En resumen

- Un módulo son siempre los mismos ficheros: esquema, entidad, eventos, errores,
  repositorio, deps, módulo, rutas y tests; y `value-objects/` cuando tiene valores con
  reglas.
- El esquema es el contrato. Los esquemas de entrada tienen solo lo que puede mandar un
  cliente, y reutilizan las reglas del completo.
- Un value object guarda las reglas de un valor en un solo sitio: `from` para lo que
  alguien escribió, `schema` para cómo se guarda. Su brand para un valor sin comprobar
  al compilar.
- Solo la entidad se cambia a sí misma, con métodos de negocio que anotan sus eventos.
  Nace por `create` o se lee por `fromDTO`. Fuera de su módulo, solo existe su DTO.
- Cada error es una clase con un `code` estable; su base decide el código HTTP. Los
  mensajes propios de newt se cambian una vez, al arrancar, con `setMessages`; sus
  códigos no cambian nunca.
- Solo el repositorio toca el store.
- Los casos de uso validan su entrada, devuelven DTOs y se llaman `<módulo>.<método>`.
- Una ruta lee, llama a un caso de uso y responde: sin lógica y sin `try/catch`.
