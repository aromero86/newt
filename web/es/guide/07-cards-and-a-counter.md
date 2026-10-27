# Tarjetas y un contador compartido

Un tablero tiene columnas; ahora recibe lo que va en ellas. Una tarjeta es algo que
hacer: un título, una descripción, la columna de su estado y, quizá, alguien a quien
está asignada. Cada tarjeta de un tablero tiene un número, #1, #2, #3…, y la gente lo
usa: "la #12 está bloqueada". Así que dos tarjetas creadas en el mismo momento en el
mismo tablero tienen que recibir dos números distintos, y un número no puede volver
nunca: si se borra la #12, la "#12" del mensaje de la semana pasada no puede acabar
significando otra tarjeta.

El siguiente número de un tablero es un valor que **todos cambian a la vez**: cada
tarjeta nueva del tablero lo coge y lo sube en uno. Este capítulo añade el módulo de
tarjetas, y enseña dónde guarda cooper ese número y cómo dos tarjetas creadas a la vez
se turnan para cogerlo en lugar de chocar.

Dos diseños que parecen correctos no funcionan:

- **Un contador en el tablero**, que cada tarjeta nueva lee y aumenta. El tablero es
  otro módulo: crear una tarjeta escribiría dos módulos en un caso de uso. Y la fila
  del tablero chocaría con cualquier otra cosa que la guarde, un cambio de nombre por
  ejemplo.
- **Ningún contador: el número más alto que queda, más uno.** Solo ve las tarjetas que
  siguen ahí. Las tarjetas se borran de verdad (capítulo [8](./08-two-people-one-card)):
  borra la #3 de tres, y la siguiente tarjeta vuelve a ser la #3.

cooper guarda el último número que dio cada tablero en una tabla del **módulo de
tarjetas**: `card_counter`, una fila por tablero, escrita en el mismo guardado que la
tarjeta.

## Las tablas

La migración añade dos tablas: las tarjetas y sus contadores.

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00003_card_up.sql
-- A card points at its board, its column and the member it is assigned to by id: the
-- column is another module's, the member another context's.
CREATE TABLE card (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  column_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  assignee_id TEXT,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
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
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  last_number INTEGER NOT NULL,
  version INTEGER NOT NULL
);
CREATE INDEX card_counter_workspace ON card_counter (workspace_id);
```

Una tarjeta apunta a su tablero, a su columna y a su asignado por id, nunca con una
clave foránea: la columna es de otro módulo, el asignado de otro contexto. El índice
único sobre `(board_id, number)` tiene la última palabra sobre los números: haga lo que
haga el código, la tabla nunca contiene dos #7 en un tablero.

`card_counter` no tiene entidad propia. Su `id` es el del tablero, así que encontrar el
contador de un tablero es buscar por id. Tiene una `version`, como toda fila que
escribe un store.

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00003_card_down.sql
DROP TABLE card_counter;
DROP TABLE card;
```

## El esquema

`card.schema.ts` dice qué es una tarjeta y las formas que envía un cliente para crear,
editar y asignar una. También guarda `MAX_CARDS`: un tablero se lee entero, como una
sola pantalla, así que tiene un límite, como las diez columnas de un tablero.

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
import { z } from 'zod'

/** The most cards a board holds: a board is read whole, as one screen. */
export const MAX_CARDS = 500

/** A card of a board: something to do, in the column of its status. */
export const CardSchema = z.object({
  id: z.uuidv7(),
  workspaceId: z.string(),
  boardId: z.string(),
  /** Its status: the column it is in, by id. The column is another module's. */
  columnId: z.string(),
  /** #1, #2…: its board's, in the order its cards were created, never reused. */
  number: z.number().int().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5_000),
  /** Who it is assigned to: a member of the workspace, by their user's id in auth. */
  assigneeId: z.string().nullable(),
  /** Where it is in its column, from 0 at the top: a column's cards are 0, 1, 2… without gaps. */
  position: z.number().int().min(0),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

const description = z.string().trim().pipe(CardSchema.shape.description)

export const CardCreateSchema = CardSchema.pick({ columnId: true, title: true }).extend({
  description: description.default(''),
  assigneeId: CardSchema.shape.assigneeId.default(null),
})
export const CardEditSchema = z.object({ title: CardSchema.shape.title, description }).partial()
export const CardAssignSchema = z.object({ assigneeId: z.string() })

export type CardDTO = z.infer<typeof CardSchema>
export type CardCreateDTO = z.input<typeof CardCreateSchema>
export type CardEditDTO = z.input<typeof CardEditSchema>
export type CardAssignDTO = z.input<typeof CardAssignSchema>
```

`CardCreateSchema` toma solo lo que decide un cliente: la columna, el título y,
opcionalmente, una descripción y un asignado. El número y la posición los pone cooper.

## La entidad

`Card` se construye como `Column`. Una nueva se crea con el número y el sitio que
parecía que iba a tener; `place` le da los que de verdad tiene, dentro del guardado, y
solo mientras es nueva.

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
import { Entity, type EntityInput } from 'newt/core'
import { CardSchema, type CardDTO } from './card.schema'

export * from './card.schema'

/**
 * What it takes to create a card: checked, in its workspace, with the number and the
 * place it looked to get. Its save gives it the ones it really gets.
 */
export type CardOpening = {
  workspaceId: string
  boardId: string
  columnId: string
  number: number
  position: number
  title: string
  description: string
  assigneeId: string | null
}

/** A card of a board. */
export class Card extends Entity<typeof CardSchema> {

  private constructor(input: EntityInput<CardDTO>, isNew: boolean) {
    super(CardSchema, input, isNew)
  }

  static fromDTO(dto: CardDTO & { version: number }): Card {
    return new Card(dto, false)
  }

  static create(input: CardOpening): Card {
    return new Card(input, true)
  }

  get workspaceId(): string {
    return this.data.workspaceId
  }

  get boardId(): string {
    return this.data.boardId
  }

  get columnId(): string {
    return this.data.columnId
  }

  get position(): number {
    return this.data.position
  }

  get assigneeId(): string | null {
    return this.data.assigneeId
  }

  /**
   * A new one takes its number and its place as it is saved: the next number of its
   * board and the bottom of its column, read where no other card can take them in
   * between.
   */
  place(number: number, position: number): void {
    if (!this.isNew) throw new Error(`Card ${this.id} is placed once, as it is created`)
    this.change({ number, position })
  }

  edit(changes: { title?: string, description?: string }): void {
    this.change(changes)
  }

  /** To a member of its workspace: the module checked they are. */
  assign(assigneeId: string): void {
    this.change({ assigneeId })
  }

  unassign(): void {
    this.change({ assigneeId: null })
  }
}
```

La entidad no comprueba nada sobre quién es el asignado: no puede saberlo. Lo comprueba
el módulo y luego llama a `assign`.

## Sus errores

Cuatro errores, uno por archivo, como antes. Una tarjeta que no existe es un 404:

```ts
// cooper/backend/contexts/boards/modules/card/errors/card-not-found.ts
import { NotFoundError } from 'newt/core'

export class CardNotFound extends NotFoundError {
  readonly code = 'card.not_found'
  constructor(id: string) {
    super(`There is no card ${id}`)
  }
}
```

Un tablero que ya tiene `MAX_CARDS` es un conflicto con el estado de las cosas (409):

```ts
// cooper/backend/contexts/boards/modules/card/errors/too-many-cards.ts
import { ConflictError } from 'newt/core'
import { MAX_CARDS } from '../card.schema'

export class TooManyCards extends ConflictError {
  readonly code = 'card.too_many'
  constructor(boardId: string) {
    super(`Board ${boardId} has ${MAX_CARDS} cards already: that is the most a board holds`)
  }
}
```

Una columna de otro tablero, o un asignado de fuera del workspace, es un error de la
petición (400):

```ts
// cooper/backend/contexts/boards/modules/card/errors/column-not-in-board.ts
import { ValidationError } from 'newt/core'

/** A card goes only to a column of its own board: the request named another. */
export class ColumnNotInBoard extends ValidationError {
  readonly code = 'card.column_not_in_board'
  constructor(columnId: string, boardId: string) {
    super(`Column ${columnId} is not a column of board ${boardId}`)
  }
}
```

```ts
// cooper/backend/contexts/boards/modules/card/errors/assignee-not-member.ts
import { ValidationError } from 'newt/core'

/** A card is assigned only to someone of its workspace: the request named anyone else. */
export class AssigneeNotMember extends ValidationError {
  readonly code = 'card.assignee_not_member'
  constructor(userId: string) {
    super(`${userId} is not a member of this workspace: a card is assigned to one of its members`)
  }
}
```

## Lo que necesita el módulo de tarjetas

Una tarjeta necesita tres módulos: el tablero, para comprobar que existe en el
workspace; la columna, para comprobar que es del tablero; y el módulo de miembros, para
comprobar que un asignado pertenece al workspace. Los tres son lecturas, llamadas a sus
casos de uso.

```ts
// cooper/backend/contexts/boards/modules/card/card.deps.ts
import type { Board_Module } from '../board/board.module'
import type { Column_Module } from '../column/column.module'
import type { Member_Module } from '../member/member.module'

export interface Card_Deps {
  /** That a card's board exists, in the current workspace. */
  board: Board_Module
  /** That a card's column exists, and is of its board. */
  column: Column_Module
  /** That a card's assignee belongs to its workspace. */
  member: Member_Module
}
```

El módulo de miembros sabe decir si *la persona con sesión* pertenece a un workspace
(`enter`), pero no si *otra persona* pertenece. Añádele `isMember`, e importa
`currentWorkspaceId`:

```ts
// cooper/backend/contexts/boards/modules/member/member.module.ts
import { currentWorkspaceId, type WorkspaceScope } from '../../workspace-scope'
// …
  /** Whether someone belongs to the current workspace. */
  @UseCase()
  async isMember(userId: string): Promise<boolean> {
    return this.deps.workspaces.isMember(currentWorkspaceId(), userId)
  }
```

Va después de `enter`. Pregunta a auth (aquí, el falso) cada vez: un miembro quitado
hace un minuto ya no es miembro.

## El repositorio: una segunda tabla

El repositorio es donde vive el contador. Sus entidades son las filas de `card`, así que
es un `TableRepository`, como antes. Los contadores son una segunda tabla que abre junto
a la suya con `base.store.table<CardCounterRow>('card_counter')`: una `Table` es el
acceso simple del store a las filas (`find`, `insert`, `update`, `delete`), sin
entidad. Ningún otro módulo la ve nunca.

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Card, MAX_CARDS, type CardDTO } from './card'
import { TooManyCards } from './errors/too-many-cards'

export type CardRow = CardDTO & { version: number }

/** The last number a board gave a card: its id is the board's. A card deleted does not give it back. */
export type CardCounterRow = { id: string, workspaceId: string, lastNumber: number, version: number }

export class Card_Repository extends TableRepository<Card, CardRow, BoardsBase> {

  private readonly counters

  constructor(base: BoardsBase) {
    super(base, base.store.table<CardRow>('card', { unique: [['boardId', 'number']] }), {
      scope: { field: 'workspaceId', current: currentWorkspaceId },
    })
    this.counters = base.store.table<CardCounterRow>('card_counter')
  }

  protected toEntity(row: CardRow): Card {
    return Card.fromDTO(row)
  }

  /** The number the next card of a board gets: one more than the last one it gave. */
  async nextNumber(boardId: string): Promise<number> {
    const [counter] = await this.counters.find({ id: boardId })
    return (counter?.lastNumber ?? 0) + 1
  }

  /**
   * Saves a new card with the next number of its board and at the bottom of its
   * column, both read inside the save, and only if the board is left with no more
   * than `MAX_CARDS`. The save guards the board's cards and the column's order: two
   * cards created at once in a board get #7 and #8, in any store, and neither waits
   * for a conflict to try again.
   *
   * The number is a value everyone changes at once: each board keeps the last one it
   * gave in a row of its own, which every new card of the board updates. Updated in
   * place, those saves would collide with each other; under the board's guard, they
   * take turns instead, and none is refused. The row is never lowered, so a deleted
   * card's number, even the last one's, is not given again. The table's unique index
   * on (board, number) is the last word.
   */
  async persistNew(card: Card): Promise<void> {
    const { boardId, columnId } = card
    await this.save([card], each => this.write(each), {
      guard: [`boardCards:${boardId}`, `cards:${columnId}`],
      before: async () => card.place(await this.takeNumber(card), await this.count({ columnId })),
      after: async () => {
        const count = await this.count({ boardId })
        if (count > MAX_CARDS) throw new TooManyCards(boardId)
      },
    })
  }

  /** The board's next number, taken: its counter one up, in the save of the card that gets it. */
  private async takeNumber(card: Card): Promise<number> {
    const [counter] = await this.counters.find({ id: card.boardId })
    if (!counter) {
      await this.counters.insert({ id: card.boardId, workspaceId: card.workspaceId, lastNumber: 1 })
      return 1
    }
    const number = counter.lastNumber + 1
    await this.counters.update(counter.id, counter.version, { lastNumber: number })
    return number
  }
}
```

Lee `persistNew` despacio; es el capítulo.

**El número se coge dentro del guardado.** `takeNumber` lee el contador y lo sube en
uno, en `before`, en la misma transacción que la tarjeta. La primera tarjeta de un
tablero crea la fila. Cada una de las siguientes la actualiza con
`update(id, version, changes)`: la fila tiene que seguir en la versión que se leyó, o el
store lanza `ConcurrencyConflict`. Nada aquí lo baja nunca, así que un número dado no se
da otra vez.

**El guard convierte la colisión en una cola.** Dos tarjetas creadas a la vez leerían
las dos `lastNumber: 6` y las dos intentarían escribir 7. Bajo la clave
`boardCards:<board id>`, dos guardados nunca se entrelazan, en ningún store: el segundo
empieza cuando el primero ha confirmado, lee 7 y escribe 8. Ninguno es rechazado y
ninguno se repite. Es el `guard` que conociste en el capítulo
[6](./06-rules-over-rows), usado para un valor en vez de para una regla.

**Un guardado puede guardar varias claves.** `cards:<column id>` protege el orden de la
columna: la posición es el número de tarjetas de la columna, leído en el mismo
`before`, así que dos tarjetas creadas a la vez en una columna reciben 0 y 1, nunca 0 y
0. El capítulo [8](./08-two-people-one-card) usa esa clave para mover tarjetas.

**`after` comprueba la regla sobre las tarjetas del tablero.** `MAX_CARDS` es una regla
sobre varias filas, como `MAX_COLUMNS`: se cuenta después de escribir, bajo el guard del
tablero, y al lanzar el error se deshacen a la vez la tarjeta y su número.

`nextNumber` lee sin coger nada. El módulo lo usa para construir una tarjeta válida
antes de guardar: lo que lee es una suposición, que `before` sustituye por lo que es
verdad.

::: tip
Un valor que muchos cambian a la vez (un contador, un stock, un saldo) no es un campo
que se lee en un caso de uso y se guarda: cada cambio chocaría con los demás. Guárdalo
en el módulo que lo cambia, y cógelo dentro del guardado, en `before`, bajo un guard
sobre lo que cuenta.
:::

## El módulo

`Card_Module` tiene los casos de uso: listar las tarjetas de un tablero, obtener una por
id o por número, crear, editar, asignar y desasignar.

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
import { Module, UseCase } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import {
  Card,
  CardAssignSchema,
  CardCreateSchema,
  CardEditSchema,
  MAX_CARDS,
  type CardDTO,
} from './card'
import type { Card_Deps } from './card.deps'
import { Card_Repository } from './card.repository'
import { registerCardRoutes } from './card.routes'
import { AssigneeNotMember } from './errors/assignee-not-member'
import { CardNotFound } from './errors/card-not-found'
import { ColumnNotInBoard } from './errors/column-not-in-board'
import { TooManyCards } from './errors/too-many-cards'

/**
 * The cards of each board: what there is to do, in the column of its status, and
 * who does it. A card points at its board and its column (modules of `boards`) and at
 * its assignee (a member, kept by auth), each by id.
 */
export class Card_Module extends Module {

  static initialize(base: BoardsBase, deps: Card_Deps): Card_Module {
    const module = new Card_Module(base, new Card_Repository(base), deps)
    registerCardRoutes(base, module, deps)
    return module
  }

  private constructor(
    base: BoardsBase,
    private readonly repo: Card_Repository,
    private readonly deps: Card_Deps,
  ) {
    super('card', base.invocations, deps)
  }

  /**
   * A board's cards, column by column and from the top: whole, since a board is read
   * as one screen and holds at most `MAX_CARDS`.
   */
  @UseCase()
  async listInBoard(boardId: string): Promise<CardDTO[]> {
    const cards = await this.repo.find({ boardId }, { orderBy: [{ field: 'columnId' }, { field: 'position' }] })
    return cards.map(card => card.toDTO())
  }

  @UseCase()
  async get(id: string): Promise<CardDTO> {
    return (await this.load(id)).toDTO()
  }

  /** A card by its number on its board: #12 of the roadmap. */
  @UseCase()
  async getByNumber(boardId: string, number: number): Promise<CardDTO> {
    return (await this.resolve(() => this.repo.find({ boardId, number }), () => new CardNotFound(`#${number}`))).toDTO()
  }

  /**
   * A new card at the bottom of a column of the board, with the board's next number:
   * a board holds at most `MAX_CARDS`.
   */
  @UseCase()
  async create(boardId: string, input: unknown): Promise<CardDTO> {
    const card = await this.newCard(boardId, input)
    // For a clear answer in the usual case: the save counts again, where nothing slips in.
    if (await this.repo.count({ boardId }) >= MAX_CARDS) throw new TooManyCards(boardId)
    await this.repo.persistNew(card)
    return card.toDTO()
  }

  @UseCase()
  async edit(id: string, input: unknown): Promise<CardDTO> {
    const changes = CardEditSchema.parse(input)
    const card = await this.load(id)
    card.edit(changes)
    await this.repo.persist(card)
    return card.toDTO()
  }

  /** Assigns it to a member of its workspace: anyone else is a mistake of the request (400). */
  @UseCase()
  async assign(id: string, input: unknown): Promise<CardDTO> {
    const { assigneeId } = CardAssignSchema.parse(input)
    const card = await this.load(id)
    await this.assertMember(assigneeId)
    card.assign(assigneeId)
    await this.repo.persist(card)
    return card.toDTO()
  }

  @UseCase()
  async unassign(id: string): Promise<CardDTO> {
    const card = await this.load(id)
    card.unassign()
    await this.repo.persist(card)
    return card.toDTO()
  }

  /** A new card of a board, checked: its column is the board's, its assignee a member. */
  private async newCard(boardId: string, input: unknown): Promise<Card> {
    const { columnId, title, description, assigneeId } = CardCreateSchema.parse(input)
    const board = await this.deps.board.get(boardId)
    await this.assertColumnOf(boardId, columnId)
    if (assigneeId !== null) await this.assertMember(assigneeId)
    return Card.create({
      workspaceId: board.workspaceId,
      boardId,
      columnId,
      // What they look to be now; the save reads them again, where nothing slips in.
      number: await this.repo.nextNumber(boardId),
      position: await this.repo.count({ columnId }),
      title,
      description,
      assigneeId,
    })
  }

  private load(id: string): Promise<Card> {
    return this.resolve(() => this.repo.find({ id }), () => new CardNotFound(id))
  }

  /** The column a card goes to is one of its board's: asked to the column module, a read. */
  private async assertColumnOf(boardId: string, columnId: string): Promise<void> {
    const columns = await this.deps.column.list(boardId)
    if (!columns.some(column => column.id === columnId)) throw new ColumnNotInBoard(columnId, boardId)
  }

  /** The assignee belongs to the workspace now: asked to auth, through the member module, every time. */
  private async assertMember(userId: string): Promise<void> {
    if (!await this.deps.member.isMember(userId)) throw new AssigneeNotMember(userId)
  }
}
```

`create` sigue la forma de todo caso de uso: validar, cargar lo que necesita, decidir,
guardar. `newCard` comprueba las referencias preguntando a sus módulos: `board.get`
(404 cuando el tablero no es del workspace), `column.list` (la columna tiene que ser una
de las del tablero) y `member.isMember`. Cada una es una lectura de otro módulo a través
de sus casos de uso; el módulo de tarjetas nunca toca sus tablas.

El recuento antes de `persistNew` da un `card.too_many` claro en el caso habitual. El
guardado cuenta otra vez, donde nada se cuela entre medias: un tablero de 497 tarjetas
al que se le crean seis a la vez acaba con 500, y tres de las seis reciben
`card.too_many`.

`listInBoard` devuelve la lista entera, sin página: una regla del dominio la acota
(`MAX_CARDS`), como `MAX_COLUMNS` acota las columnas de un tablero.

## Las rutas

Las rutas van en el grupo del workspace, como las de las columnas: cada una se ejecuta
en el workspace una vez que `member.enter` ha dejado entrar a la persona.

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { Card_Deps } from './card.deps'
import type { Card_Module } from './card.module'

export function registerCardRoutes(base: BoardsBase, cards: Card_Module, deps: Card_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/cards', async request => Response.json(await cards.listInBoard(request.params.boardId)))

  workspace.post('/boards/:boardId/cards', async request => Response.json(await cards.create(request.params.boardId, await request.json()), { status: 201 }))

  workspace.get('/cards/:cardId', async request => Response.json(await cards.get(request.params.cardId)))

  workspace.patch('/cards/:cardId', async request => Response.json(await cards.edit(request.params.cardId, await request.json())))

  workspace.post('/cards/:cardId/assign', async request => Response.json(await cards.assign(request.params.cardId, await request.json())))

  workspace.post('/cards/:cardId/unassign', async request => Response.json(await cards.unassign(request.params.cardId)))
}
```

## Conectarlo

`initializeModules` inicializa el módulo de tarjetas después de los tres que usa:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import type { Boards_Config } from './boards-config'
import type { BoardsBase } from './boards-base'
import { Board_Module } from './modules/board/board.module'
import { Card_Module } from './modules/card/card.module'
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
  const card = Card_Module.initialize(base, { board, column, member })
  return { member, board, column, card }
}

export type Boards_Modules = ReturnType<typeof initializeModules>
```

## Tests

Los tests de las tarjetas abren `boards` en memoria, con ana y bea en acme y carl en
globex, un tablero y tres columnas.

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'
import { MAX_CARDS, type CardCreateDTO } from './card.schema'

describe('card', () => {
  let t: TestBoards
  let boardId: string
  let todo: string
  let doing: string
  let done: string

  beforeEach(async () => {
    t = await openTestBoards()
    t.auth.join('acme', 'ana')
    t.auth.join('acme', 'bea')
    t.auth.join('globex', 'carl')
    boardId = (await inAcme(() => t.modules.board.create({ name: 'Roadmap' }))).id
    ;[todo, doing, done] = await Promise.all(['To do', 'Doing', 'Done'].map(name => inAcme(() => t.modules.column.add(boardId, { name })))).then(columns => columns.map(column => column.id))
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>) => t.as('ana', 'acme', fn)
  const create = (title: string, input: Partial<CardCreateDTO> = {}) => inAcme(() => t.modules.card.create(boardId, { columnId: todo, title, ...input }))
  /** Each column's cards from the top, as `#number@position`. */
  const columns = async () => {
    const cards = await inAcme(() => t.modules.card.listInBoard(boardId))
    const of = (columnId: string) => cards.filter(card => card.columnId === columnId).map(card => `#${card.number}@${card.position}`)
    return { todo: of(todo), doing: of(doing), done: of(done) }
  }

  test('numbers a board\'s cards #1, #2… and puts each new one at the bottom of its column', async () => {
    await create('Plan')
    await create('Design', { columnId: doing })
    await create('Build')

    expect(await columns()).toEqual({ todo: ['#1@0', '#3@1'], doing: ['#2@0'], done: [] })
    expect((await inAcme(() => t.modules.card.getByNumber(boardId, 2))).title).toBe('Design')
  })

  test('gives distinct numbers and places to cards created at once', async () => {
    const created = await Promise.all(Array.from({ length: 20 }, (_, i) => create(`Task ${i}`)))

    const sorted = (values: number[]) => values.toSorted((a, b) => a - b)
    expect(sorted(created.map(card => card.number))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(sorted(created.map(card => card.position))).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  test('holds up to MAX_CARDS cards in a board, however many are created at once', async () => {
    await Promise.all(Array.from({ length: MAX_CARDS - 3 }, (_, i) => create(`Task ${i}`)))

    const created = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => create(`More ${i}`)))

    expect(created.filter(each => each.status === 'fulfilled')).toHaveLength(3)
    for (const each of created.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'card.too_many' })
    expect(await inAcme(() => t.modules.card.listInBoard(boardId))).toHaveLength(MAX_CARDS)
  })

  test('creates a card only in a column of its board', async () => {
    const other = await inAcme(() => t.modules.board.create({ name: 'Other' }))
    const elsewhere = await inAcme(() => t.modules.column.add(other.id, { name: 'To do' }))

    await expect(create('Lost', { columnId: elsewhere.id })).rejects.toMatchObject({ code: 'card.column_not_in_board' })
  })

  test('edits a card\'s title and description', async () => {
    const plan = await create('Plan')

    const edited = await inAcme(() => t.modules.card.edit(plan.id, { title: ' Plan the launch ', description: 'Dates, people' }))

    expect(edited).toMatchObject({ title: 'Plan the launch', description: 'Dates, people', number: 1 })
  })

  test('assigns a card only to a member of its workspace', async () => {
    const plan = await create('Plan')

    await expect(inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'carl' }))).rejects.toMatchObject({ code: 'card.assignee_not_member' })
    await expect(create('Design', { assigneeId: 'carl' })).rejects.toMatchObject({ code: 'card.assignee_not_member' })

    expect((await inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))).assigneeId).toBe('bea')
    expect((await inAcme(() => t.modules.card.unassign(plan.id))).assigneeId).toBeNull()
  })
})
```

El segundo test es el del contador: veinte tarjetas creadas a la vez reciben de la #1 a
la #20 y las posiciones de 0 a 19, ninguna repetida, ninguna saltada. El tercero es el
del límite: seis creadas a la vez en un tablero a tres del límite, y solo entran tres.

En `boards.context.test.ts`, el test que guardaba un tablero y sus columnas ahora
guarda también sus tarjetas, y el cambio de nombre, el archivado y la comprobación del
nombre del tablero pasan a un test propio. Sustituye los dos tests que van después del
que solo deja entrar a los miembros:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
  test('keeps a board, its columns and its cards', async () => {
    const board = await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })
    expect(board.status).toBe(201)
    const id = board.body.id
    const todo = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'To do' })).body.id
    await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'Done' })
    const card = await call<{ id: string, number: number }>('POST', `/acme/boards/${id}/cards`, { columnId: todo, title: 'Plan' })
    expect(card).toMatchObject({ status: 201, body: { number: 1 } })

    expect((await call('POST', `/acme/cards/${card.body.id}/assign`, { assigneeId: 'bea' })).body).toMatchObject({ code: 'card.assignee_not_member' })
    expect((await call('PATCH', `/acme/boards/${id}`, { name: 'Plans' })).body).toMatchObject({ name: 'Plans' })

    expect((await call<{ name: string }[]>('GET', `/acme/boards/${id}/columns`)).body.map(column => column.name)).toEqual(['To do', 'Done'])
    expect((await call<{ title: string }[]>('GET', `/acme/boards/${id}/cards`)).body.map(each => each.title)).toEqual(['Plan'])

    // Another workspace sees none of it.
    expect((await call('GET', `/globex/boards/${id}`, undefined, 'bea')).status).toBe(404)
  })

  test('renames a board, archives it, and gives its name once', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id

    expect(await call('POST', '/acme/boards', { name: 'ROADMAP' })).toMatchObject({ status: 409, body: { code: 'board.name_taken' } })
    expect((await call('PATCH', `/acme/boards/${id}`, { name: 'Plans' })).body).toMatchObject({ name: 'Plans' })
    expect((await call('GET', `/acme/boards/${id}`)).body).toMatchObject({ id, name: 'Plans' })
    expect((await call('POST', `/acme/boards/${id}/archive`)).status).toBe(204)
    expect((await call('GET', `/acme/boards/${id}`)).body).toMatchObject({ code: 'board.not_found' })
  })
```

bea está en globex, no en acme, así que asignarle una tarjeta de acme es
`card.assignee_not_member`.

## Compruébalo

```sh
bun install && bun check && bun test cooper/ && bun run lint
```

Luego, a mano. Arranca el backend; ejecuta la nueva migración en tu base de datos de
desarrollo al abrirse:

```sh
bun cooper/backend/index.ts
```

En otra terminal, crea un tablero y una columna, y crea veinte tarjetas a la vez (usa
`jq` para leer los ids):

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
BOARD=$(curl -s -X POST $API/boards -H "$H" -H 'x-user: ana' -d "{\"name\":\"Counter $RANDOM\"}" | jq -r .id)
COLUMN=$(curl -s -X POST $API/boards/$BOARD/columns -H "$H" -H 'x-user: ana' -d '{"name":"To do"}' | jq -r .id)
for i in $(seq 1 20); do
  curl -s -o /dev/null -X POST $API/boards/$BOARD/cards -H "$H" -H 'x-user: ana' -d "{\"columnId\":\"$COLUMN\",\"title\":\"Task $i\"}" &
done; wait
curl -s $API/boards/$BOARD/cards -H 'x-user: ana' | jq -c '[.[].number] | sort'
curl -s $API/boards/$BOARD/cards -H 'x-user: ana' | jq -c '[.[].position] | sort'
```

```text
[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]
[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19]
```

Cada número una vez, cada posición una vez.

## En resumen

- Un valor que todos cambian a la vez choca consigo mismo si cada cambio se lee en un
  caso de uso y se guarda. Cógelo dentro del guardado, en `before`, bajo un `guard`
  sobre lo que cuenta: los guardados se turnan en vez de chocar.
- Guárdalo en el módulo que lo cambia, en una tabla que su repositorio abre junto a la
  suya (`base.store.table`), nunca en una fila que también escriben otros guardados.
- Un valor que no debe volver nunca se guarda en una fila que solo crece, no se deduce
  de filas que se pueden borrar.
- Un índice único tiene la última palabra; la comprobación antes del guardado es la
  respuesta clara; la comprobación en `after` es la regla.
- Un módulo comprueba sus referencias llamando a los casos de uso de los otros módulos,
  nunca a sus tablas.

Siguiente: [Dos personas, una tarjeta](./08-two-people-one-card).
