# Dos personas, una tarjeta

Ana y Bob abren el mismo tablero. Ana arrastra la tarjeta #1 a *Doing*; en el mismo
momento, Bob la arrastra a *Done*. Los dos guardan. ¿Qué queda?

Sin protección, el segundo guardado pisaría al primero con lo que leyó antes, y el
movimiento de Ana desaparecería sin que nadie se enterase. Peor aún: cada movimiento
reescribe también las posiciones de las tarjetas de alrededor, así que una columna
podría acabar con dos tarjetas en un sitio y un hueco en otro.

Este capítulo añade mover y quitar a las columnas y a las tarjetas. Cada uno de esos
guardados escribe varias filas a la vez, filas que otras personas también pueden estar
cambiando. Verás cómo se da cuenta newt, qué hace por su cuenta, y el único caso en el
que no puede darse cuenta sin tu ayuda.

## La versión

Cada fila que escribe un store tiene una **versión** que sube con cada guardado que la
escribe. La tienes desde el capítulo [2](./02-first-module): la columna `version` de
cada tabla, el `version` de cada tipo de fila.

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
export type CardRow = CardDTO & { version: number }
```

Una entidad recuerda la versión en la que se leyó. Cuando `save` la escribe, el store
comprueba que la fila sigue en esa versión. Si alguien la ha guardado entre medias, ya
no lo está, y el guardado lanza **`ConcurrencyConflict`** (409, `concurrency_conflict`)
y no escribe nada: toda la transacción se deshace.

```text
Ana   reads card #1 (version 3)
Bob   reads card #1 (version 3)
Ana   saves the move, if it is still at 3   → done, now version 4
Bob   saves the move, if it is still at 3   → ConcurrencyConflict: it is at 4
```

Nadie pierde nada en silencio. No has escrito nada de esto: `TableRepository.write`
actualiza y borra en la versión leída, y `takeNumber` en el capítulo
[7](./07-cards-and-a-counter) hizo lo mismo a mano con `update(id, version,
changes)`.

## Volver a intentarlo, solo

Que Bob reciba un error sería correcto, pero rara vez es lo que alguien quiere: lo
sensato es **volver a intentarlo**, leer la tarjeta otra vez, ahora en *Doing*,
moverla a *Done* y guardar. Todo caso de uso lo hace sin que se lo pidan. Ante un
`ConcurrencyConflict` se ejecuta otra vez **desde el principio**, hasta tres veces más,
tras una breve espera aleatoria. Solo cuando todos los intentos chocan llega el 409 al
cliente.

Eso funciona porque un caso de uso **carga, cambia y guarda al final, y no hace nada que
no se pueda deshacer antes de guardar**. Ejecutado de nuevo, carga lo que hay guardado
ahora y decide otra vez. Un caso de uso que enviara un email y luego guardara lo
enviaría dos veces; lo que no se puede deshacer sale de un worker, después del guardado
(capítulo [12](./12-failures)).

Cuando un caso de uso llama a otro, solo se repite **el primero de la cadena**, con todo
lo que llama. El interior deja pasar el conflicto hasta quien lo llamó, y se ejecuta
otra vez en cada intento de quien lo llamó. Si se repitieran los dos, el de dentro
repetiría lo que su llamador va a repetir de todos modos.

Un caso de uso que hace antes de guardar algo que no debe ocurrir dos veces (una
llamada a otro contexto que ya guardó, por ejemplo) lo desactiva, con su motivo al lado:

```ts
@UseCase({ retryOnConflict: false })
```

Entonces ningún caso de uso de su cadena se repite, ni siquiera los que lo llamaron.
Nada en boards lo necesita: cada caso de uso de aquí carga, decide y guarda una vez.
auth tiene algunos que sí, en los capítulos [18](./18-tenants-and-access) y
[21](./21-oauth-server). Antes de escribirlo, comprueba si el caso de uso puede
reordenarse para guardar una sola vez, al final. La opción es para lo que no puede.

## Las columnas se mueven

Empieza por las columnas, donde la idea es la misma con menos alrededor. Una columna
movida a otro sitio de su tablero cambia su propia posición, y las columnas de entre
medias se desplazan un sitio cada una. Añade dos métodos a `Column`, después de
`rename`, y uno para quitarla:

```ts
// cooper/backend/contexts/boards/modules/column/column.ts
  rename(name: string): void {
    this.change({ name })
  }

  /** Someone moved it: where it goes. */
  moveTo(position: number): void {
    this.change({ position })
  }

  /** Another one moved, or left: this one takes the place left to it, and tells nothing. */
  reposition(position: number): void {
    this.change({ position })
  }

  remove(): void {
    this.markAsDeleted()
  }
}
```

`moveTo` y `reposition` hacen hoy lo mismo. Son dos métodos porque significan dos cosas:
uno es lo que hizo alguien, el otro es una consecuencia. El capítulo [10](./10-events)
da al primero un evento y deja el segundo en silencio.

`remove` marca la columna como borrada. El repositorio de columnas no tiene
`softDelete`, así que su guardado quita la fila de verdad, en la versión leída.

### Un tablero conserva una columna

Un tablero sin columnas no tiene dónde poner una tarjeta. Y el capítulo
[13](./13-another-context) lleva las tarjetas que quedan en una columna quitada a la
primera columna del tablero, así que siempre tiene que haber una. Quitar la última
columna de un tablero es un conflicto con el estado de las cosas, un 409:

```ts
// cooper/backend/contexts/boards/modules/column/errors/last-column.ts
import { ConflictError } from 'newt/core'

/** A board keeps one column at least: where its cards go when another column is removed. */
export class LastColumn extends ConflictError {
  readonly code = 'column.last'
  constructor(boardId: string) {
    super(`Board ${boardId} has only this column: a board keeps one at least`)
  }
}
```

### Guardar un orden

El repositorio recibe `persistOrder`: las columnas de un tablero en su nuevo orden,
guardadas a la vez, todas o ninguna. Importa `LastColumn`, y añádelo después de
`persistAdded`:

```ts
// cooper/backend/contexts/boards/modules/column/column.repository.ts
import { Column, MAX_COLUMNS, type ColumnDTO } from './column'
import { LastColumn } from './errors/last-column'
import { TooManyColumns } from './errors/too-many-columns'
// …
  /**
   * Saves a board's columns in their new order, all of them or none: each
   * one moved, and the one removed. Each was read at a version, so a column moved by
   * someone else meanwhile makes it a conflict, and the use case runs again with what
   * there is now. One added meanwhile has no version here: the order is checked
   * whole after writing, guarding the board's columns, so it is a conflict too. And
   * the board keeps one column at least: two of its last two removed at once, one is.
   */
  async persistOrder(columns: Column[], boardId: string): Promise<void> {
    await this.save(columns, each => this.write(each), {
      guard: [`columns:${boardId}`],
      after: async () => {
        const positions = (await this.ofBoard(boardId)).map(each => each.position)
        if (positions.length === 0) throw new LastColumn(boardId)
        if (positions.some((position, index) => position !== index)) this.conflict()
      },
    })
  }
```

Las versiones protegen las filas que se leyeron. No pueden proteger una fila que **no
existía** cuando el caso de uso leyó: si Carla añade una columna mientras el movimiento
de Bob renumera el tablero, el guardado de Bob nunca toca la columna de Carla, y dos
columnas podrían acabar en la misma posición. Por eso `after` vuelve a leer las columnas
del tablero, dentro de la transacción, y comprueba que las posiciones van 0, 1, 2… sin
huecos.

Si no es así, eso no es un error que responder: alguien se ha colado, y lo que decidió el
caso de uso puede que ya no valga. **`this.conflict()`** lo dice. Es un método de todo
repositorio, y lanza el mismo `ConcurrencyConflict` que lanza una versión obsoleta: la
transacción se deshace y el caso de uso se ejecuta otra vez, viendo ya la columna de
Carla.

El guard `columns:<board id>` es el que toma `persistAdded` (capítulo
[6](./06-rules-over-rows)): ninguna columna del tablero se añade, se mueve ni se quita
entre las escrituras y la comprobación, en ningún store.

La misma lectura conserva la última columna del tablero. El caso de uso de abajo se
niega a quitarla, pero decide sobre lo que leyó: si Ana quita *To do* mientras Bob
quita *Done*, las dos últimas, cada uno ve que queda otra columna y sigue adelante.
Después de escribir, bajo el guard, nadie se cuela, así que lo que cuenta `after` es
seguro: un tablero sin ninguna columna lanza `LastColumn`, esa transacción se deshace,
y uno de los dos borrados responde 409. Lanza la respuesta él mismo en vez de
`this.conflict()`: ejecutado otra vez, el caso de uso encontraría una columna y se
negaría igual.

### Los casos de uso

Añade `ColumnMoveSchema` y `ColumnMoveDTO` a los imports de `column.module.ts` (los dos
están ya en `column.schema.ts`: una posición), e importa `LastColumn`:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
import {
  Column,
  ColumnAddSchema,
  ColumnMoveSchema,
  ColumnRenameSchema,
  MAX_COLUMNS,
  type ColumnAddDTO,
  type ColumnDTO,
  type ColumnMoveDTO,
  type ColumnRenameDTO,
} from './column'
import type { Column_Deps } from './column.deps'
import { Column_Repository } from './column.repository'
import { registerColumnRoutes } from './column.routes'
import { ColumnNotFound } from './errors/column-not-found'
import { LastColumn } from './errors/last-column'
import { TooManyColumns } from './errors/too-many-columns'
```

y dos casos de uso después de `rename`:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
  /**
   * Moves a column to another place on its board, and the others take the places
   * left: several columns saved at once, all or none. Whoever moved one of them
   * meanwhile makes it run again, from the start, with the board as it is then.
   */
  @UseCase()
  async move(id: string, input: ColumnMoveDTO): Promise<ColumnDTO> {
    const { position } = ColumnMoveSchema.parse(input)
    const column = await this.load(id)
    const others = (await this.repo.ofBoard(column.boardId)).filter(each => each.id !== id)
    const at = Math.min(position, others.length)
    others.splice(at, 0, column)
    others.forEach((each, index) => each === column ? column.moveTo(index) : each.reposition(index))
    await this.repo.persistOrder(others, column.boardId)
    return column.toDTO()
  }

  /**
   * Removes a column, and the ones to its right move one place left. Whether it is
   * empty is not known here, where cards are not: `card.removeColumn` asks the cards
   * first, and is what the API calls. A board keeps one column at least: its last one
   * is not removed.
   */
  @UseCase()
  async remove(id: string): Promise<void> {
    const column = await this.load(id)
    const others = (await this.repo.ofBoard(column.boardId)).filter(each => each.id !== id)
    // For a clear answer in the usual case: the save counts again, where nothing slips in.
    if (others.length === 0) throw new LastColumn(column.boardId)
    others.forEach((each, index) => each.reposition(index))
    column.remove()
    await this.repo.persistOrder([column, ...others], column.boardId)
  }
```

`move` construye el nuevo orden en memoria, da a cada columna su índice y las guarda
todas. Una columna cuya posición no cambió no tiene nada que guardar: `save` no la
escribe, y no comprueba su versión. Una posición más allá del final es el final.

`remove` saca la columna, y las demás cierran el hueco. Si no queda ninguna otra columna,
lanza `LastColumn` antes de guardar: la respuesta clara para el caso habitual, una
persona quitando la última columna. Para dos a la vez está el recuento de
`persistOrder`.

`remove` es un caso de uso del módulo de columnas, pero la API no lo llama: una columna
se quita solo cuando no hay ninguna tarjeta en ella, y el módulo de columnas no conoce
las tarjetas. Eso le toca al módulo de tarjetas, más abajo.

### La ruta

`POST /columns/:columnId/move`, con una nota sobre dónde fue a parar el quitar:

```ts
// cooper/backend/contexts/boards/modules/column/column.routes.ts
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { ColumnAddDTO, ColumnMoveDTO, ColumnRenameDTO } from './column'
import type { Column_Deps } from './column.deps'
import type { Column_Module } from './column.module'

/** A column's removal is the cards' route (`card.routes.ts`): they know whether it is empty. */
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

  workspace.post('/columns/:columnId/move', async request => {
    const input = await request.json() as ColumnMoveDTO
    return Response.json(await columns.move(request.params.columnId, input))
  })
}
```

## Las tarjetas se mueven

Una tarjeta se mueve a una columna de su tablero (la suya también) en una posición; las
tarjetas que deja cierran el hueco, y las tarjetas donde aterriza hacen sitio. Añade lo
que envía un cliente para ello a `card.schema.ts`, después de `CardEditSchema`:

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export const CardEditSchema = z.object({ title: CardSchema.shape.title, description }).partial()
/** Where it goes: a column of its board and, in it, a position; at the bottom when none is given, or one past it. */
export const CardMoveSchema = z.object({
  columnId: CardSchema.shape.columnId,
  position: CardSchema.shape.position.optional(),
})
export const CardAssignSchema = z.object({ assigneeId: z.string() })
```

y su tipo, después de `CardEditDTO`:

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export type CardEditDTO = z.input<typeof CardEditSchema>
export type CardMoveDTO = z.input<typeof CardMoveSchema>
```

La entidad recibe el mismo par que la columna, después de `edit`, y `delete` al final:

```ts
// cooper/backend/contexts/boards/modules/card/card.ts
  /** Someone moved it: to this column, at this position. */
  moveTo(columnId: string, position: number): void {
    this.change({ columnId, position })
  }

  /** Another one moved, or left: this one takes the place left to it in its column, and tells nothing. */
  reposition(position: number): void {
    this.change({ position })
  }
// …
  unassign(): void {
    this.change({ assigneeId: null })
  }

  delete(): void {
    this.markAsDeleted()
  }
}
```

Una tarjeta también se borra de verdad: el repositorio de tarjetas no tiene
`softDelete`. Su número sigue cogido de todos modos, porque `card_counter` no se baja
nunca.

### El repositorio

Dos métodos. `inColumn` lee las tarjetas de una columna desde arriba; añádelo después de
`toEntity`:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
  /** A column's cards, from the top. */
  inColumn(columnId: string): Promise<Card[]> {
    return this.find({ columnId }, { orderBy: [{ field: 'position' }] })
  }
```

`persistOrder` es el de la columna, para una o dos columnas a la vez. Añádelo después de
`persistNew`:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
  /**
   * Saves cards in their new order, all of them or none: the one moved or
   * deleted, and the ones that took the places left, in each column it touches. Each
   * was read at a version, so a card someone else moved meanwhile makes it a
   * conflict, and the use case runs again with the columns as they are then.
   * One created meanwhile has no version here: the order of each column is checked
   * whole after writing, guarding those columns, so it is a conflict too.
   */
  async persistOrder(cards: Card[], columnIds: string[]): Promise<void> {
    const columns = [...new Set(columnIds)]
    await this.save(cards, each => this.write(each), {
      guard: columns.map(columnId => `cards:${columnId}`),
      after: async () => {
        for (const columnId of columns) {
          const positions = (await this.inColumn(columnId)).map(card => card.position)
          if (positions.some((position, index) => position !== index)) this.conflict()
        }
      },
    })
  }
```

Protege `cards:<column id>` para cada columna que toca: la clave que toma `persistNew`
para la columna a la que va una tarjeta nueva. Así una tarjeta nueva y un movimiento en
la misma columna nunca se entrelazan: o el movimiento ve la tarjeta nueva, o la tarjeta
se crea después del movimiento, en el nuevo final. Y una tarjeta creada entre las
lecturas del movimiento y su guardado es lo que atrapa la comprobación de `after`.

### Una columna que no está vacía

Quitar una columna con tarjetas dentro las dejaría apuntando a nada. Es un conflicto con
el estado de las cosas, un 409:

```ts
// cooper/backend/contexts/boards/modules/card/errors/column-not-empty.ts
import { ConflictError } from 'newt/core'

/** A column is removed only once no card is in it. */
export class ColumnNotEmpty extends ConflictError {
  readonly code = 'card.column_not_empty'
  constructor(columnId: string, cards: number) {
    super(`Column ${columnId} has ${cards} card(s): move them to another column first`)
  }
}
```

### Los casos de uso

Añade `CardMoveSchema`, `CardMoveDTO` y `ColumnNotEmpty` a los imports de
`card.module.ts`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
import {
  Card,
  CardAssignSchema,
  CardCreateSchema,
  CardEditSchema,
  CardMoveSchema,
  MAX_CARDS,
  type CardAssignDTO,
  type CardCreateDTO,
  type CardDTO,
  type CardEditDTO,
  type CardMoveDTO,
} from './card'
import type { Card_Deps } from './card.deps'
import { Card_Repository } from './card.repository'
import { registerCardRoutes } from './card.routes'
import { AssigneeNotMember } from './errors/assignee-not-member'
import { CardNotFound } from './errors/card-not-found'
import { ColumnNotEmpty } from './errors/column-not-empty'
import { ColumnNotInBoard } from './errors/column-not-in-board'
import { TooManyCards } from './errors/too-many-cards'
```

`move` va después de `edit`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * Moves a card to a column of its board (the same one, too) at a position, and the
   * cards around take the places left and made: several cards saved at once, all or
   * none. Whoever moved one of them meanwhile, this card too, makes it run again from
   * the start, with the columns as they are then: two people dragging the same card
   * at once both get their move, one after the other.
   */
  @UseCase()
  async move(id: string, input: CardMoveDTO): Promise<CardDTO> {
    const { columnId, position } = CardMoveSchema.parse(input)
    const card = await this.load(id)
    const from = card.columnId
    if (columnId !== from) await this.assertColumnOf(card.boardId, columnId)
    const left = (await this.repo.inColumn(from)).filter(each => each.id !== id)
    const target = columnId === from ? left : await this.repo.inColumn(columnId)
    const at = Math.min(position ?? target.length, target.length)
    target.splice(at, 0, card)
    if (target !== left) left.forEach((each, index) => each.reposition(index))
    target.forEach((each, index) => each === card ? card.moveTo(columnId, index) : each.reposition(index))
    await this.repo.persistOrder(target === left ? target : [...left, ...target], [from, columnId])
    return card.toDTO()
  }
```

`left` es la columna que deja la tarjeta, sin ella; `target` es donde aterriza, la misma
lista cuando se queda en su columna. Cada lista se renumera desde 0, y todas las
tarjetas de ellas van a un solo guardado.

Esta es la historia de Ana y Bob con este código. Los dos cargan la tarjeta #1 en
*To do*, en la misma versión. El guardado de Ana confirma primero. El de Bob encuentra
la tarjeta #1 en una versión más nueva: un `ConcurrencyConflict`, nada escrito. `move`
se ejecuta otra vez desde el principio, carga la tarjeta #1, ya en *Doing*, la saca de
*Doing* y la pone en *Done*. Las dos peticiones responden 200; la tarjeta acaba donde la
puso la segunda, y ninguna columna tiene un hueco.

`delete` y `removeColumn` van después de `unassign`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /** Deletes it, and the cards under it move one place up. Its number is not given again. */
  @UseCase()
  async delete(id: string): Promise<void> {
    const card = await this.load(id)
    const others = (await this.repo.inColumn(card.columnId)).filter(each => each.id !== id)
    others.forEach((each, index) => each.reposition(index))
    card.delete()
    await this.repo.persistOrder([card, ...others], [card.columnId])
  }

  /**
   * Removes a column of a board, only if no card is in it. The cards answer, since a
   * card points at its column and a column knows nothing of the cards: the column
   * module cannot ask them without the two needing each other. So this use
   * case asks, and has the column module remove it: a write to another module outside
   * a worker, said where it is seen. It is the only write it makes, so a failure leaves
   * nothing halfway.
   */
  @UseCase({ writesTo: ['column'] })
  async removeColumn(columnId: string): Promise<void> {
    const column = await this.deps.column.get(columnId)
    const cards = await this.repo.count({ columnId })
    if (cards > 0) throw new ColumnNotEmpty(columnId, cards)
    await this.deps.column.remove(column.id)
  }
```

### Escribir en otro módulo: `writesTo`

`removeColumn` es el primer caso de uso de cooper que escribe en **otro módulo**:
`column.remove` guarda, y se le llama desde el módulo de tarjetas. newt lo rechaza por
defecto. El guardado de cada módulo es una transacción propia; un caso de uso que
guardara en dos módulos y fallara entre los guardados dejaría el primero guardado, sin
nada que termine el trabajo. Así que una escritura en otro módulo ocurre desde un worker
que reacciona a un evento, cuyo job se repite hasta completarse (capítulo
[11](./11-reacting)). newt lo comprueba mientras se ejecutan los casos de uso: un caso
de uso de `column` que guarda, llamado bajo un caso de uso de `card` fuera de un worker,
lanza un error que empieza por `[write rule] card.removeColumn writes to
boards.column outside a worker`.

Aquí la excepción está justificada. El módulo de columnas no puede preguntar a las
tarjetas si la columna está vacía: `card` depende de `column`, y al revés sería un
ciclo. El módulo de tarjetas pregunta, y después hace que se quite la columna. La
preocupación de la regla no se aplica: `column.remove` es la única escritura, así que un
fallo no deja nada a medias.

`@UseCase({ writesTo: ['column'] })` lo dice donde se ve, con el motivo en el comentario
de arriba. Vale para todo lo que se escriba por debajo de ese caso de uso, a la
profundidad que sea.

Queda un hueco. Una tarjeta movida a la columna, o creada en ella, entre el recuento y
el borrado apunta a una columna que ya no existe; el capítulo
[13](./13-another-context) lo cierra con un worker que lleva esas tarjetas a la primera
columna del tablero, que siempre está ahí.

### Las rutas

`card.routes.ts` importa `CardMoveDTO`, y recibe `POST /cards/:cardId/move`,
`DELETE /cards/:cardId` y el quitar la columna, `DELETE /columns/:columnId`:

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { CardAssignDTO, CardCreateDTO, CardEditDTO, CardMoveDTO } from './card'
import type { Card_Deps } from './card.deps'
import type { Card_Module } from './card.module'

export function registerCardRoutes(base: BoardsBase, cards: Card_Module, deps: Card_Deps): void {
  const workspace = workspaceRoutes(base, deps.member)

  workspace.get('/boards/:boardId/cards', async request => Response.json(await cards.listInBoard(request.params.boardId)))

  workspace.post('/boards/:boardId/cards', async request => {
    const input = await request.json() as CardCreateDTO
    return Response.json(await cards.create(request.params.boardId, input), { status: 201 })
  })

  workspace.get('/cards/:cardId', async request => Response.json(await cards.get(request.params.cardId)))

  workspace.patch('/cards/:cardId', async request => {
    const input = await request.json() as CardEditDTO
    return Response.json(await cards.edit(request.params.cardId, input))
  })

  workspace.post('/cards/:cardId/move', async request => {
    const input = await request.json() as CardMoveDTO
    return Response.json(await cards.move(request.params.cardId, input))
  })

  workspace.post('/cards/:cardId/assign', async request => {
    const input = await request.json() as CardAssignDTO
    return Response.json(await cards.assign(request.params.cardId, input))
  })

  workspace.post('/cards/:cardId/unassign', async request => Response.json(await cards.unassign(request.params.cardId)))

  workspace.delete('/cards/:cardId', async request => {
    await cards.delete(request.params.cardId)
    return new Response(null, { status: 204 })
  })

  // A column is removed by the cards, which know whether it is empty.
  workspace.delete('/columns/:columnId', async request => {
    await cards.removeColumn(request.params.columnId)
    return new Response(null, { status: 204 })
  })
}
```

Dos módulos pueden registrar rutas bajo el mismo grupo; `/columns/:columnId` con
`DELETE` es del módulo de tarjetas, con `PATCH` del módulo de columnas.

## Tests

En `column.test.ts`, añade dos tests después del que solo deja entrar las columnas que
caben:

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
  test('moves a column, and the others take the places left', async () => {
    const [, , done] = [await add('To do'), await add('Doing'), await add('Done')]

    await inAcme(() => t.modules.column.move(done.id, { position: 0 }))
    expect(await names()).toEqual(['0:Done', '1:To do', '2:Doing'])

    await inAcme(() => t.modules.column.move(done.id, { position: 99 }))
    expect(await names()).toEqual(['0:To do', '1:Doing', '2:Done'])
  })

  test('gives each of two moves at once its turn, and leaves no gap', async () => {
    const [todo, doing, done] = [await add('To do'), await add('Doing'), await add('Done')]

    await Promise.all([
      inAcme(() => t.modules.column.move(done.id, { position: 0 })),
      inAcme(() => t.modules.column.move(todo.id, { position: 2 })),
    ])

    const order = await names()
    expect(order.map(name => name.split(':')[0])).toEqual(['0', '1', '2'])
    expect(order.map(name => name.split(':')[1]).sort()).toEqual([todo.name, doing.name, done.name].sort())
  })
```

y uno después de `renames a column`:

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
  test('removes a column only when no card is in it, and the others move left', async () => {
    const [todo, doing] = [await add('To do'), await add('Doing'), await add('Done')]
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo.id, title: 'Write the plan' }))

    await expect(inAcme(() => t.modules.card.removeColumn(todo.id))).rejects.toMatchObject({ code: 'card.column_not_empty' })

    await inAcme(() => t.modules.card.move(card.id, { columnId: doing.id }))
    await inAcme(() => t.modules.card.removeColumn(todo.id))
    expect(await names()).toEqual(['0:Doing', '1:Done'])
  })
```

y, después de él, uno para la última columna. Dos borrados de las dos últimas columnas
de un tablero a la vez: una de ellas se va, la otra responde `column.last`, y la que
queda no se quita nunca:

```ts
// cooper/backend/contexts/boards/modules/column/column.test.ts
  test('keeps a board\'s last column, where its cards go when another one is removed', async () => {
    const [todo, doing] = [await add('To do'), await add('Doing')]

    // Its last two removed at once: one of them is.
    const removed = await Promise.allSettled([todo, doing].map(column => inAcme(() => t.modules.card.removeColumn(column.id))))

    expect(removed.filter(each => each.status === 'fulfilled')).toHaveLength(1)
    expect(removed.find(each => each.status === 'rejected')?.reason).toMatchObject({ code: 'column.last' })
    const [last] = await inAcme(() => t.modules.column.list(boardId))
    expect(await names()).toEqual([`0:${last!.name}`])
    await expect(inAcme(() => t.modules.card.removeColumn(last!.id))).rejects.toMatchObject({ code: 'column.last' })
  })
```

En `card.test.ts`, el test del contador ahora también borra la última tarjeta y
comprueba que su número no se da otra vez. Añade las líneas al final, y dos tests
después:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
    expect(sorted(created.map(card => card.position))).toEqual(Array.from({ length: 20 }, (_, i) => i))

    // The last one deleted, its number stays taken: five more at once get #21 to #25.
    await inAcme(() => t.modules.card.delete(created.find(card => card.number === 20)!.id))
    const more = await Promise.all(Array.from({ length: 5 }, (_, i) => create(`More ${i}`)))
    expect(sorted(more.map(card => card.number))).toEqual([21, 22, 23, 24, 25])
  })

  test('never gives a deleted card\'s number again, and closes the gap it leaves', async () => {
    const [, second] = [await create('Plan'), await create('Design'), await create('Build')]

    await inAcme(() => t.modules.card.delete(second.id))
    await create('Ship')

    expect(await columns()).toEqual({ todo: ['#1@0', '#3@1', '#4@2'], doing: [], done: [] })
  })

  test('never gives the number of the last card again, once it is deleted', async () => {
    const [, , build] = [await create('Plan'), await create('Design'), await create('Build')]

    await inAcme(() => t.modules.card.delete(build.id))
    await create('Ship')

    expect(await columns()).toEqual({ todo: ['#1@0', '#2@1', '#4@2'], doing: [], done: [] })
  })
```

Luego sustituye el test `creates a card only in a column of its board` (después del de
`MAX_CARDS`) por tres:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('moves a card to another column, or within its own, and the others make room', async () => {
    const [plan, design, build] = [await create('Plan'), await create('Design'), await create('Build')]

    await inAcme(() => t.modules.card.move(design.id, { columnId: doing }))
    await inAcme(() => t.modules.card.move(build.id, { columnId: doing, position: 0 }))
    await inAcme(() => t.modules.card.move(plan.id, { columnId: doing, position: 1 }))
    expect(await columns()).toEqual({ todo: [], doing: ['#3@0', '#1@1', '#2@2'], done: [] })

    await inAcme(() => t.modules.card.move(design.id, { columnId: doing, position: 0 }))
    expect(await columns()).toEqual({ todo: [], doing: ['#2@0', '#3@1', '#1@2'], done: [] })
  })

  test('gives each of two moves of the same card at once its turn, and leaves no gap', async () => {
    const [plan] = [await create('Plan'), await create('Design'), await create('Build')]

    const moved = await Promise.all([
      inAcme(() => t.modules.card.move(plan.id, { columnId: doing })),
      inAcme(() => t.modules.card.move(plan.id, { columnId: done })),
    ])

    expect(moved.map(card => card.columnId).sort()).toEqual([doing, done].sort())
    const after = await columns()
    expect(after.todo).toEqual(['#2@0', '#3@1'])
    expect([...after.doing, ...after.done]).toEqual(['#1@0'])
  })

  test('moves a card only to a column of its board', async () => {
    const plan = await create('Plan')
    const other = await inAcme(() => t.modules.board.create({ name: 'Other' }))
    const elsewhere = await inAcme(() => t.modules.column.add(other.id, { name: 'To do' }))

    await expect(inAcme(() => t.modules.card.move(plan.id, { columnId: elsewhere.id }))).rejects.toMatchObject({ code: 'card.column_not_in_board' })
    await expect(create('Lost', { columnId: elsewhere.id })).rejects.toMatchObject({ code: 'card.column_not_in_board' })
  })
```

El segundo es el de Ana y Bob: los dos movimientos tienen éxito, uno de ellos se
ejecutó dos veces, y la tarjeta está en una columna en la posición 0, sin hueco en
*To do*.

En `boards.context.test.ts`, el primer test de tarjetas guarda el id de la columna
*Done* y mueve la tarjeta allí por HTTP:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
    const done = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'Done' })).body.id
    const card = await call<{ id: string, number: number }>('POST', `/acme/boards/${id}/cards`, { columnId: todo, title: 'Plan' })
    expect(card).toMatchObject({ status: 201, body: { number: 1 } })

    expect((await call('POST', `/acme/cards/${card.body.id}/move`, { columnId: done })).body).toMatchObject({ columnId: done, position: 0 })
```

y un test después quita columnas por HTTP: una con una tarjeta se rechaza, después se
vacía y se quita, y la última que queda responde 409 `column.last`:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
  test('removes a column only when it is empty, and never the board\'s last', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id
    const todo = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'To do' })).body.id
    const done = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'Done' })).body.id
    const card = (await call<{ id: string }>('POST', `/acme/boards/${id}/cards`, { columnId: todo, title: 'Plan' })).body.id

    expect(await call('DELETE', `/acme/columns/${todo}`)).toMatchObject({ status: 409, body: { code: 'card.column_not_empty' } })
    expect((await call('DELETE', `/acme/cards/${card}`)).status).toBe(204)
    expect((await call('DELETE', `/acme/columns/${todo}`)).status).toBe(204)
    expect((await call<{ id: string }[]>('GET', `/acme/boards/${id}/columns`)).body.map(column => column.id)).toEqual([done])
    expect(await call('DELETE', `/acme/columns/${done}`)).toMatchObject({ status: 409, body: { code: 'column.last' } })
  })
```

## Compruébalo

```sh
bun install && bun check && bun test cooper && bun run lint
```

Luego, a mano, con el backend en marcha (`bun cooper/backend/index.ts`). Crea un
tablero con tres columnas y una tarjeta, y mueve la tarjeta a dos columnas a la vez:

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
post() { curl -s -X POST "$API$1" -H "$H" -H 'x-user: ana' -d "$2"; }
BOARD=$(post /boards "{\"name\":\"Moves $RANDOM\"}" | jq -r .id)
TODO=$(post /boards/$BOARD/columns '{"name":"To do"}' | jq -r .id)
DOING=$(post /boards/$BOARD/columns '{"name":"Doing"}' | jq -r .id)
DONE=$(post /boards/$BOARD/columns '{"name":"Done"}' | jq -r .id)
CARD=$(post /boards/$BOARD/cards "{\"columnId\":\"$TODO\",\"title\":\"Plan\"}" | jq -r .id)
post /cards/$CARD/move "{\"columnId\":\"$DOING\"}" | jq -c '{columnId, position}' &
post /cards/$CARD/move "{\"columnId\":\"$DONE\"}" | jq -c '{columnId, position}' &
wait
curl -s $API/boards/$BOARD/cards -H 'x-user: ana' | jq -c '.[] | {columnId, position}'
```

Los dos movimientos responden con la tarjeta en la posición 0, uno en *Doing* y otro en
*Done*; la lista la muestra una vez, en la columna del movimiento que se ejecutó en
segundo lugar. Ahora intenta quitar *Done*, o la columna que la tenga:

```sh
curl -s -X DELETE $API/columns/$DONE -H 'x-user: ana'
```

```text
{"error":"Column … has 1 card(s): move them to another column first","code":"card.column_not_empty"}
```

si la tarjeta está ahí, y nada (un 204) si no.

## En resumen

- Cada fila tiene una versión. Guardar una fila que alguien ha guardado desde que la
  leíste es un `ConcurrencyConflict` (409), y no se escribe nada.
- Un caso de uso se ejecuta otra vez ante un conflicto, desde el principio, hasta tres
  veces más. Solo lo hace el primero de una cadena, con todo lo que llama. Así que un
  caso de uso carga, decide y guarda al final, y no hace nada que no se pueda deshacer
  antes de guardar; `retryOnConflict: false`, con su motivo, es para el que no puede.
- Una fila creada entre medias no tiene versión: comprueba el orden entero en `after`,
  bajo un guard, y llama a `this.conflict()` cuando alguien se haya colado. Una regla
  que dos personas pueden romper a la vez (un tablero conserva una columna) se cuenta
  ahí también, después de escribir.
- Varias entidades de un módulo guardadas a la vez son un solo `save`: todas o ninguna.
- Un caso de uso escribe en otro módulo solo desde un worker. Una excepción justificada
  dice `writesTo`, con el motivo al lado.

Siguiente: [Preguntar dos veces: POST idempotentes](./09-idempotent-posts).
