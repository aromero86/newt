# El primer módulo: boards

`boards` está abierto y sirve su salud, y no hace nada más. Este capítulo le da su
primer **módulo**, `board`: una responsabilidad del contexto, con sus datos, las reglas
sobre esos datos y lo que se le puede pedir. Puedes crear un tablero, leerlo,
renombrarlo o describirlo, y archivarlo cuando ya nadie lo necesita.

Es pequeño, pero tiene todas las piezas que tiene un módulo, y todos los demás módulos
de cooper se escriben igual. Estos son sus ficheros, todos dentro de
`cooper/backend/contexts/boards/modules/board/`:

```
board/
  board.schema.ts            the contract: what goes in and what comes out
  value-objects/
    board-name.ts            a board's name, with its own rules
  errors/                    what can go wrong
    invalid-board-name.ts
    board-not-found.ts
  board.ts                   the entity
  board.repository.ts        how it is kept
  board.module.ts            its use cases
  board.routes.ts            its HTTP API
  board.test.ts              its tests
```

Un tablero todavía no tiene workspace: todos ven todos los tableros. El capítulo
[4](./04-who-and-where) pone cada tablero en un workspace.

Aquí escribes cada fichero. En un proyecto tuyo,
`bunx newt add module <carpeta-del-contexto> <nombre>` escribe un esqueleto de estos
ficheros para empezar
([apéndice G](./g-command-line)).

## zod

Todos los datos de newt se describen con [zod](https://zod.dev). Añádelo al
`package.json` de la raíz, con una versión exacta:

```sh
bun add zod@4.3.6 --exact
```

El `package.json` de la raíz depende ahora de él junto a newt:

```json
  "dependencies": {
    "newt": "workspace:*",
    "zod": "4.3.6"
  },
```

## El contrato

Todo empieza por describir los datos. El fichero del esquema es el **contrato público**
del módulo: lo que entra en sus casos de uso y lo que sale de ellos.

```ts
// cooper/backend/contexts/boards/modules/board/board.schema.ts
import { z } from 'zod'
import { BoardName } from './value-objects/board-name'

export const BoardSchema = z.object({
  id: z.uuidv7(),
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

- **`BoardSchema`** es el tablero completo. Su tipo, `BoardDTO`, es lo que ven los demás
  módulos y la API: un *DTO* (objeto de transferencia de datos), datos planos sin
  comportamiento.
- **El id es un UUIDv7.** Lo pone la entidad, con `createdAt` y `updatedAt`; nadie los
  envía. Su `default('')` permite comprobar la entidad antes de que ponga sus fechas.
- **Los esquemas de entrada** (`Create`, `Update`) tienen solo lo que puede enviar un
  cliente. Reutilizan las reglas del completo: la descripción se recorta y después pasa
  (`pipe`) por `BoardSchema.shape.description`, así que "como mucho 500 caracteres" se
  escribe una vez. El nombre se recibe como un string sin más: qué es un nombre lo
  decide el value object de abajo.
- Todo lo que exporta el fichero empieza por el nombre de la entidad (`Board…`).

## Un valor con reglas: `BoardName`

El nombre de un tablero se recorta, lleva un solo espacio entre palabras y tiene de 1 a
60 caracteres, así que ` Road  map ` y `Road map` son el mismo nombre. Un **value
object** guarda esas reglas en un solo sitio: un tipo y una constante con el mismo
nombre.

Primero, el error que lanza cuando un nombre no puede serlo. La clase base de la que
hereda un error decide el estado HTTP; `ValidationError` es un 400:

```ts
// cooper/backend/contexts/boards/modules/board/errors/invalid-board-name.ts
import { ValidationError } from 'newt/contract'

export class InvalidBoardName extends ValidationError {
  readonly code = 'board.invalid_name'
  constructor(value: string) {
    super(`'${value}' is not a board's name: it has 1 to 60 characters`)
  }
}
```

Después, el value object:

```ts
// cooper/backend/contexts/boards/modules/board/value-objects/board-name.ts
import type { ValueObject } from 'newt/contract'
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

- **`from`** convierte lo que alguien escribió en el valor, o lanza `InvalidBoardName`.
  Es indulgente: `'  Road   map '` se convierte en `'Road map'`.
- **`schema`** describe cómo se **guarda** el valor. Es estricto: no arregla nada, y
  rechaza un nombre que no esté ya limpio. Va en el esquema de la entidad.

`satisfies ValueObject<BoardName, string>` comprueba que la constante tiene las dos
mitades, con los tipos correctos.

**El tipo lleva un brand.** En ejecución, un `BoardName` es un `string`. Para
TypeScript, un `string` cualquiera no es un `BoardName` hasta que pasa por
`BoardName.from` o por `BoardName.schema`. A un campo con tipo `BoardName` no se le
puede dar por despiste un nombre sin limpiar.

Los dos imports vienen de `newt/contract`, no de `newt/core`. `newt/contract` es la parte
de newt que comparten un backend y sus clientes, segura para cargar en un navegador:
value objects y sus errores, páginas, el cuerpo de un error. El nombre del tablero se
comprobará igual en la app web (capítulo [23](./23-frontends)).

## La entidad

La entidad es el esquema **más su comportamiento**. Mantiene sus datos válidos, sabe qué
ha cambiado y es la única que los cambia.

```ts
// cooper/backend/contexts/boards/modules/board/board.ts
import { Entity, type EntityInput } from 'newt/core'
import { BoardSchema, type BoardDTO } from './board.schema'
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

  /** A new one: the name as someone typed it becomes a `BoardName`. */
  static create(input: { name: string, description: string }): Board {
    return new Board({ ...input, name: BoardName.from(input.name) }, true)
  }

  get name(): BoardName {
    return this.data.name
  }

  update(changes: { name?: string, description?: string }): void {
    this.change({
      ...(changes.name === undefined ? {} : { name: BoardName.from(changes.name) }),
      ...(changes.description === undefined ? {} : { description: changes.description }),
    })
  }

  /** Out of every list; its row stays, with what points at it. */
  archive(): void {
    this.markAsDeleted()
  }
}
```

Lo que te da y garantiza `Entity`, de `newt/core`:

- **Dos puertas de entrada.** `create` para algo nuevo, `fromDTO` para algo leído del
  store. El tercer argumento del constructor, `isNew`, lo decide la puerta, nunca que
  haya o no un id. El constructor es privado: no hay otra puerta.
- **Una entidad nueva recibe por sí sola su id y sus fechas**: un UUIDv7, `createdAt` y
  `updatedAt`. `EntityInput<BoardDTO>` es el DTO con esos tres opcionales.
- **Una entidad leída del store llega con su `version`**, y no se puede construir sin
  ella. La versión empieza en 0, y cada guardado que escribe la entidad la avanza. No la
  toques nunca: el capítulo [8](./08-two-people-one-card) enseña qué protege.
- **Siempre es válida.** Se comprueba contra su esquema al construirse y en cada cambio.
  Una entidad que no cumple su propio esquema es un fallo del programa, no un error del
  cliente: el capítulo [3](./03-pages-and-errors) enseña qué recibe el cliente.
- **Solo la entidad se cambia a sí misma.** `change()` y `data` son protegidos. Un caso
  de uso llama a `update()` o a `archive()`, métodos con nombres del negocio. `change()`
  comprueba la entidad entera, se queda con los valores que devuelve el esquema, ignora
  lo que en realidad no cambia y mueve `updatedAt` cuando algo cambia.
- **Sus métodos reciben datos del negocio, no el DTO de entrada.** `create` recibe
  `{ name, description }`, ya comprobados por el caso de uso. Aquí se parecen; en el
  capítulo [4](./04-who-and-where) al tablero se le da también su workspace, que ningún
  cliente envía.
- **`markAsDeleted()`** dice que la entidad ya no está. Qué significa "ya no está" lo
  decide el repositorio: más abajo lo harás un borrado lógico. Una entidad borrada no
  puede volver a cambiar.
- **Fuera de su módulo una entidad no existe.** Los casos de uso devuelven `toDTO()`. El
  getter `name` es para el código del propio módulo.

`board.ts` reexporta el fichero del esquema, así que el módulo importa la entidad y su
contrato desde un solo sitio.

## El repositorio

El repositorio es **lo único** que lee y escribe tableros. Cuando cada entidad es una
fila de una tabla, como aquí, extiende `TableRepository`, de `newt/repository`, y di
cómo una fila se convierte en entidad:

```ts
// cooper/backend/contexts/boards/modules/board/board.repository.ts
import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { Board, type BoardDTO } from './board'

/** Its row: the board, its version, and when it was archived (soft deleted). */
export type BoardRow = BoardDTO & { version: number, deletedAt: string | null }

export class Board_Repository extends TableRepository<Board, BoardRow, BoardsBase> {

  constructor(base: BoardsBase) {
    super(base, base.store.table<BoardRow>('board'), {
      // Archiving stamps `deletedAt`: an archived board is in no list.
      softDelete: true,
      // No scope yet: chapter 4 gives the boards their workspace's.
      scope: 'none',
    })
  }

  protected toEntity(row: BoardRow): Board {
    return Board.fromDTO(row)
  }
}
```

Con eso ya tienes `find`, `first`, `count`, `page` y `persist`:

- **`base.store.table<BoardRow>('board')`** es la tabla, en el store del contexto. En el
  store de ficheros es la carpeta `board/`, con un fichero JSON por tablero. La fila es
  el DTO, su `version` y su `deletedAt`.
- **`softDelete: true`** convierte el borrado que pide `archive()` en una marca
  `deletedAt`. La fila se queda, porque las columnas y las tarjetas le apuntarán; los
  tableros archivados desaparecen de todo `find`, `count` y `page`.
- **`scope`** dice de quién son estas filas. Todo repositorio tiene que decirlo, o no
  compila: o un ámbito (el workspace en el que está una petición, desde el capítulo
  [4](./04-who-and-where)) o `'none'`, escrito. De momento no hay workspaces, así que
  los tableros dicen `'none'`, con un comentario que dice hasta cuándo.
- **`persist(...entities)`** guarda uno o varios tableros a la vez, todos o ninguno: una
  transacción. Escribe solo lo que ha cambiado.
- **Lo que se busca se dice con criterios**, campo a campo: `this.repo.find({ id })` es
  "los tableros cuyo id es este". Todos los stores los entienden.

## No encontrado

Pedir un tablero que no está es la segunda cosa que puede salir mal. `NotFoundError` es
un 404:

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

Los errores de un módulo viven en su carpeta `errors/`, uno por fichero. El `code` es
`<módulo>.<qué>`, y no cambia nunca: un cliente decide qué hacer a partir de él. El
mensaje es para que lo lea una persona.

## El módulo y sus casos de uso

El módulo lo junta todo: guarda el repositorio, y cada cosa que se le puede pedir es un
**caso de uso**.

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
import { Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import {
  Board,
  BoardCreateSchema,
  BoardUpdateSchema,
  type BoardDTO,
} from './board'
import { Board_Repository } from './board.repository'
import { registerBoardRoutes } from './board.routes'
import { BoardNotFound } from './errors/board-not-found'

/** The boards. */
export class Board_Module extends Module {

  static initialize(base: BoardsBase): Board_Module {
    const module = new Board_Module(base, new Board_Repository(base))
    registerBoardRoutes(base, module)
    return module
  }

  private constructor(base: BoardsBase, private readonly repo: Board_Repository) {
    super('board', base.invocations)
  }

  @UseCase()
  async get(id: string): Promise<BoardDTO> {
    return (await this.load(id)).toDTO()
  }

  @UseCase()
  async create(input: unknown): Promise<BoardDTO> {
    const { name, description } = BoardCreateSchema.parse(input)
    const board = Board.create({ name, description })
    await this.repo.persist(board)
    return board.toDTO()
  }

  /** Renames it, describes it, or both. */
  @UseCase()
  async update(id: string, input: unknown): Promise<BoardDTO> {
    const changes = BoardUpdateSchema.parse(input)
    const board = await this.load(id)
    board.update(changes)
    await this.repo.persist(board)
    return board.toDTO()
  }

  /** Out of every list for good; its columns and cards stay, pointing at it. */
  @UseCase()
  async archive(id: string): Promise<void> {
    const board = await this.load(id)
    board.archive()
    await this.repo.persist(board)
  }

  private load(id: string): Promise<Board> {
    return this.resolve(() => this.repo.find({ id }), () => new BoardNotFound(id))
  }
}
```

- **`super('board', base.invocations)`** da nombre al módulo. **`@UseCase()`** convierte
  cada método público en un caso de uso con el nombre de ambos: `board.create`,
  `board.update`. Cada llamada es una invocación que la base registra; esos nombres son
  los que verás en las trazas y en los nombres de las colas. Todo método público de un
  módulo es un caso de uso: uno sin `@UseCase()` es un error del lint
  (`newt/use-case`), y lo que no es un caso de uso es `private`, como `load`.
- **La entrada es `unknown`.** `create` y `update` aceptan lo que se les pase y lo
  validan: `BoardCreateSchema.parse(input)` es lo que le da un tipo. Una ruta, un test
  u otro contexto pueden pasar cualquier cosa; quien comprueba es el caso de uso.
- **`static initialize`** crea el módulo y registra sus rutas. Es lo que llama el
  contexto. El constructor es privado.
- **Todos los casos de uso tienen la misma forma**: validar la entrada en la puerta
  (`BoardCreateSchema.parse`), cargar, dejar que la entidad se cambie a sí misma,
  `persist` una vez, devolver DTO. El caso de uso no tiene ninguna transacción: el
  `persist` ya es una.
- **`this.resolve(find, onMissing)`** convierte una búsqueda en una entidad o en un
  error que eliges tú: aquí `BoardNotFound`, un 404, porque el id es el recurso pedido.

## Las rutas

Una ruta lee la petición, llama a un caso de uso y responde. **Nada más.** Toda la
lógica vive en el caso de uso, así que funciona igual desde HTTP, desde un test, desde
un script y, más adelante, desde una herramienta MCP.

```ts
// cooper/backend/contexts/boards/modules/board/board.routes.ts
import type { BoardsBase } from '../../boards-base'
import type { Board_Module } from './board.module'

export function registerBoardRoutes(base: BoardsBase, boards: Board_Module): void {
  base.http.post('/boards', async request => Response.json(await boards.create(await request.json()), { status: 201 }))

  base.http.get('/boards/:boardId', async request => Response.json(await boards.get(request.params.boardId)))

  base.http.patch('/boards/:boardId', async request => Response.json(await boards.update(request.params.boardId, await request.json())))

  base.http.post('/boards/:boardId/archive', async request => {
    await boards.archive(request.params.boardId)
    return new Response(null, { status: 204 })
  })
}
```

- Todas las rutas cuelgan de `/api`: `/boards` es `/api/boards`.
- **La ruta tipa sus parámetros**: en `/boards/:boardId`, `request.params.boardId`
  existe y es un `string`.
- **No hay `try/catch`.** Si el caso de uso lanza `BoardNotFound`, el router responde 404
  con `{ error, code }`. El capítulo siguiente enseña todas las respuestas.
- **El cuerpo llega al caso de uso tal como vino**: `await request.json()`, sin
  `as BoardCreateDTO`. Un cast no es una comprobación, solo un tipo que el editor se
  cree, y el caso de uso valida de todos modos. El lint lo rechaza (`newt/route-body`),
  así que ninguna ruta finge saber lo que envió un cliente.

## Registrarlo

El contexto crea sus módulos en `initializeModules`, cada uno después de los módulos que
usa. `board` no usa ninguno:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Board_Module } from './modules/board/board.module'

/** Every module of `boards`, each one after the modules it uses. */
export function initializeModules(base: BoardsBase, config: Boards_Config) {
  const board = Board_Module.initialize(base)
  return { board }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

`boards.modules.board` es ahora el módulo, tipado: `boards.modules.board.create({ name:
'Roadmap' })` es una llamada a un caso de uso.

## Quién pregunta

Todas las rutas del router necesitan a alguien con la sesión iniciada, salvo que se
registren con `{ public: true }` (la salud lo está). El router pregunta a su
**autenticador** quién envió cada petición: una función que recibe la petición y
devuelve el actor, `{ userId }`, o `null`. Con `null`, la ruta no se ejecuta y la
respuesta es un 401, `not_signed_in`. Con un actor, la ruta se ejecuta como ese actor, y
cualquier caso de uso al que llegue puede preguntar quién actúa (capítulo
[4](./04-who-and-where)).

Iniciar sesión de verdad es el capítulo [22](./22-web-session). Hasta entonces, quien
envía una petición dice quién es en una cabecera `x-user`. Una línea de `index.ts` lo
configura, después de que se abra el contexto:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. For now one context, boards, served on its port.
import { serve } from 'newt/http'
import { config } from './config'
import { Boards_Context } from './contexts/boards/boards.context'

const boards = await Boards_Context.open(config.boards)
// For now, who sends a request says who they are in an `x-user` header (chapter 22 signs them in).
boards.base.http.authenticateWith(async request => {
  const userId = request.headers.get('x-user')
  return userId ? { userId } : null
})
boards.start()
const server = serve(boards.serving())
console.log(`boards listening on ${server.url}`)
```

## Probarlo

Todos los tests necesitan `boards` abierto en una carpeta propia, con el mismo
autenticador. Eso va en un helper, en la carpeta `testing/` del contexto:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from '../../../config'
import { Boards_Context } from '../boards.context'

/**
 * `boards` for a test: its files in a folder of its own, removed as it closes, and
 * who sends a request told by an `x-user` header.
 */
export async function openTestBoards() {
  const folder = await mkdtemp(join(tmpdir(), 'cooper-boards-'))
  const boards = await Boards_Context.open({ ...config.boards, folder, port: 0 })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId } : null
  })
  return {
    boards,
    modules: boards.modules,
    folder,
    async close(): Promise<void> {
      await boards.stop()
      await rm(folder, { recursive: true, force: true })
    },
  }
}

export type TestBoards = Awaited<ReturnType<typeof openTestBoards>>
```

El test del propio módulo llama directamente a sus casos de uso, como lo haría una
ruta. Está junto al módulo:

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'

describe('board', () => {
  let t: TestBoards

  beforeEach(async () => {
    t = await openTestBoards()
  })

  afterEach(() => t.close())

  const create = (name: string) => t.modules.board.create({ name })

  test('keeps a name as a board\'s name: trimmed, one space between words, 1 to 60 characters', async () => {
    expect(String((await create('  Road   map ')).name)).toBe('Road map')
    await expect(create('   ')).rejects.toMatchObject({ code: 'board.invalid_name' })
    await expect(create('x'.repeat(61))).rejects.toMatchObject({ code: 'board.invalid_name' })
  })

  test('renames a board, describes it, or both', async () => {
    const bugs = await create('Bugs')

    expect(await t.modules.board.update(bugs.id, { description: 'What is broken' })).toMatchObject({ name: 'Bugs', description: 'What is broken' })
    expect(String((await t.modules.board.update(bugs.id, { name: ' Known  bugs ' })).name)).toBe('Known bugs')
    expect(String((await t.modules.board.get(bugs.id)).name)).toBe('Known bugs')
  })

  test('archives a board: it is not found any more', async () => {
    const roadmap = await create('Roadmap')

    await t.modules.board.archive(roadmap.id)

    await expect(t.modules.board.get(roadmap.id)).rejects.toMatchObject({ code: 'board.not_found' })
  })
})
```

El test del contexto pasa a usar el helper, y va por HTTP: una petición sin `x-user` es
un 401, y un tablero es un fichero propio, que puedes volver a leer. Sustituye
`boards.context.test.ts`:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { join } from 'node:path'
import { serve } from 'newt/http'
import { openTestBoards, type TestBoards } from './testing/open-test-boards'

describe('boards, through its API', () => {
  let t: TestBoards
  let server: Server<undefined>

  beforeEach(async () => {
    t = await openTestBoards()
    server = serve(t.boards.serving())
  })

  afterEach(async () => {
    await server.stop()
    await t.close()
  })

  const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, user: string | null = 'ana') => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (user) headers['x-user'] = user
    const response = await fetch(new URL(`/api${path}`, server.url), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: (response.status === 204 ? null : await response.json()) as T }
  }

  test('answers its health without a session', async () => {
    const response = await fetch(new URL('/api/health', server.url))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  test('lets in only who says who they are', async () => {
    expect(await call('POST', '/boards', { name: 'Roadmap' }, null)).toMatchObject({ status: 401, body: { code: 'not_signed_in' } })
  })

  test('keeps a board as a file of its own, and gives it back', async () => {
    const board = await call<{ id: string, name: string }>('POST', '/boards', { name: 'Roadmap' })
    expect(board).toMatchObject({ status: 201, body: { name: 'Roadmap', description: '' } })
    const id = board.body.id

    expect(await Bun.file(join(t.folder, 'board', `${id}.json`)).json()).toMatchObject({ id, name: 'Roadmap', version: 1 })
    expect((await call('PATCH', `/boards/${id}`, { name: 'Plans' })).body).toMatchObject({ name: 'Plans' })
    expect((await call('GET', `/boards/${id}`)).body).toMatchObject({ id, name: 'Plans' })
    expect((await call('POST', `/boards/${id}/archive`)).status).toBe(204)
    expect((await call('GET', `/boards/${id}`)).body).toMatchObject({ code: 'board.not_found' })
  })
})
```

## Compruébalo

Ejecuta la comprobación:

```sh
bun install && bun check && bun test cooper && bun run lint
```

```
 6 pass
 0 fail
```

Arranca el backend y, desde otra terminal, crea un tablero como Ana:

```sh
bun cooper/backend/index.ts
```

```sh
curl -s -X POST localhost:3002/api/boards -H 'content-type: application/json' \
  -H 'x-user: ana' -d '{"name":"Roadmap"}'
```

Responde 201 con el tablero:

```json
{"id":"01a1794b-12cb-7140-8329-cfe6ac61de46","name":"Roadmap","description":"","createdAt":"2026-10-26T17:38:45.579Z","updatedAt":"2026-10-26T17:38:45.579Z"}
```

La misma petición sin `x-user`:

```json
{"error":"Sign in to continue","code":"not_signed_in"}
```

Y el tablero es un fichero propio:

```sh
ls data/boards/board/
```

```
01a1794b-12cb-7140-8329-cfe6ac61de46.json
```

```sh
cat data/boards/board/01a1794b-12cb-7140-8329-cfe6ac61de46.json
```

```json
{
  "id": "01a1794b-12cb-7140-8329-cfe6ac61de46",
  "name": "Roadmap",
  "description": "",
  "createdAt": "2026-10-26T17:38:45.579Z",
  "updatedAt": "2026-10-26T17:38:45.579Z",
  "deletedAt": null,
  "version": 1
}
```

Tus ids y tus fechas serán otros. Archívalo, con su id:

```sh
curl -s -i -X POST localhost:3002/api/boards/01a1794b-12cb-7140-8329-cfe6ac61de46/archive -H 'x-user: ana'
```

Responde `204 No Content`. El fichero se queda, en la versión 2, con `deletedAt`
rellenado; un `GET` del tablero es ahora un 404:

```json
{"error":"There is no board 01a1794b-12cb-7140-8329-cfe6ac61de46","code":"board.not_found"}
```

## Qué recordar

- Un módulo es una responsabilidad, y siempre los mismos ficheros: esquema, entidad,
  value objects, errores, repositorio, módulo, rutas, tests.
- El esquema es el contrato. Los esquemas de entrada tienen solo lo que envía un
  cliente, y reutilizan las reglas del completo.
- Un value object guarda las reglas de un valor en un solo sitio: `from` perdona lo que
  alguien escribió, `schema` es estricto con lo que se guarda, y el brand mantiene
  separadas las dos cosas.
- Solo la entidad se cambia a sí misma; solo el repositorio toca el store. Un caso de
  uso valida, carga, cambia, persiste una vez y devuelve DTO.
- Un caso de uso recibe su entrada como `unknown` y la valida; una ruta le pasa el
  cuerpo tal como vino. Todo método público de un módulo es un `@UseCase()`.
- Una ruta no piensa. Quién envía una petición es asunto del autenticador, nunca de la
  ruta.
- Todo repositorio declara su `scope`, aunque sea `'none'`.

Siguiente: [casos de uso, páginas y errores](./03-pages-and-errors).
