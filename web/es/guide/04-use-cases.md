# Casos de uso con criterio

Ya tienes un módulo funcionando. Antes de seguir, merece la pena detenerse en cómo se
escribe un buen caso de uso, porque todos siguen la misma forma. Este capítulo mira los
casos de uso de `board` y de `card` y las decisiones que hay detrás: dónde se comprueba
la entrada, qué error es que algo falte y cómo se devuelve una lista.

## La forma de un caso de uso

Vuelve a leer `board.update`:

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
```

Todo caso de uso son los mismos seis pasos, en este orden:

1. **Validar en la puerta**: `BoardUpdateSchema.parse(input)`. A partir de aquí, los
   datos son de fiar.
2. **Cargar** lo que haga falta: la entidad, o datos de otros módulos a través de sus
   casos de uso.
3. **Decidir**: comprobar las reglas ("¿está libre el nombre?").
4. **Cambiar la entidad** con sus propios métodos (`board.update(changes)`).
5. **Guardar una vez, al final**: `this.repo.persist…`.
6. **Devolver DTOs**, nunca entidades.

Cuando un caso de uso no encaja en esta forma (guarda dos veces, o cambia una entidad a
mano), suele ser que está haciendo dos cosas, o el trabajo de la entidad.

## Validar dos veces, a propósito

El nombre de un tablero se comprueba **dos veces**. El caso de uso pasa la entrada por
`BoardCreateSchema`; después la entidad comprueba el tablero entero contra
`BoardSchema`, cada vez que se construye o cambia. No es un descuido. Son dos
comprobaciones distintas, con dos trabajos distintos:

| | En el caso de uso | En la entidad |
|---|---|---|
| Qué comprueba | Lo que **entra**: la petición del cliente | Su **estado**: qué es un tablero válido |
| Cómo | Indulgente: recorta, limpia, pone valores por defecto | Estricta: un valor inválido no entra nunca |
| Cuándo | Una vez, al llegar | En cada cambio, y también al leer del store |
| Si falla | Un 400 para el cliente, con lo que está mal | `InvalidEntity`, un error de programación: algo se coló. El cliente recibe un 500 que no cuenta nada; el log, el campo y el motivo |

La primera es para el cliente: le dice qué ha mandado mal. La segunda es la garantía de
que **ninguna** entidad inválida existe, venga de donde venga el cambio (una ruta, un
worker, un script, una fila vieja del store).

En `board`, los dos lados del nombre son las dos mitades de su value object:

```ts
// cooper/backend/contexts/boards/modules/board/value-objects/board-name.ts
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
```

`from` es indulgente: `'  Road   map '` pasa a ser `'Road map'`, y solo se rechaza lo
que no tiene arreglo, con un 400 que el cliente entiende. `schema` es estricto: no
arregla nada, rechaza un nombre que no esté ya limpio. `BoardSchema` usa `schema`;
`Board.create` y `Board.update` usan `from`.

Y aun así, **cada regla se escribe una sola vez**. Los esquemas indulgentes se derivan
del estricto. `card` lo enseña bien:

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export const CardSchema = z.object({
  // …
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5_000),
  // …
})

const description = z.string().trim().pipe(CardSchema.shape.description)

export const CardCreateSchema = CardSchema.pick({ columnId: true, title: true }).extend({
  description: description.default(''),
  assigneeId: CardSchema.shape.assigneeId.default(null),
})
export const CardEditSchema = z.object({ title: CardSchema.shape.title, description }).partial()
```

`pick` toma la regla del título tal cual; `pipe` primero recorta y después aplica la
regla de la descripción. Si mañana un título puede tener 300 caracteres, lo cambias en
`CardSchema` y las dos comprobaciones se enteran.

## Uno o ninguno: `resolve`

`this.resolve(buscar, siNoHay)` convierte una búsqueda en un resultado o en un error.
El error lo eliges tú, porque depende de qué significa la falta:

- Si el id **es** lo que se pide (`GET /boards/:boardId`), lo que falta es la cosa: un
  `NotFoundError`, 404.
- Si el id va **dentro** de lo que se manda (una tarjeta que se manda a una columna), lo
  que está mal es la petición: un 400.

`board` tiene el primer caso:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
private load(id: string): Promise<Board> {
  return this.resolve(() => this.repo.find({ id }), () => new BoardNotFound(id))
}
```

`card` tiene el segundo. Una tarjeta se crea en un tablero que nombra el camino, y en
una columna que nombra el cuerpo:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
@UseCase()
async create(boardId: string, input: CardCreateDTO): Promise<CardDTO> {
  const { columnId, title, description, assigneeId } = CardCreateSchema.parse(input)
  const board = await this.deps.board.get(boardId)
  await this.assertColumnOf(boardId, columnId)
  // …
}

// …

/** The column a card goes to is one of its board's: asked to the column module, a read. */
private async assertColumnOf(boardId: string, columnId: string): Promise<void> {
  const columns = await this.deps.column.list(boardId)
  if (!columns.some(column => column.id === columnId)) throw new ColumnNotInBoard(columnId, boardId)
}
```

Un tablero que no existe es un 404 (`board.not_found`, de `board.get`): el camino no
apuntaba a nada. Una columna que no es del tablero es un 400:

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

Cuando solo necesitas "este id existe en aquel módulo", hay un atajo: `resolveRefs`
busca cada id a través del `find` del otro módulo, y lanza el `ReferenceNotFound` de
newt (400, `reference_not_found`) por el primero que no apunta a nada. `access.grant`,
en `auth`, comprueba así el producto que le dan:

```ts
// cooper/backend/contexts/auth/modules/access/access.module.ts
@UseCase()
async grant(input: AccessGrantDTO): Promise<AccessDTO> {
  const { userId, productId, tenantId } = AccessGrantSchema.parse(input)
  await this.resolveRefs({ productId }, { productId: this.deps.product })
  // …
}
```

```ts
// cooper/backend/contexts/auth/auth.test.ts
await expect(as(staff, () => modules().access.grant({ userId: ana.id, productId: 'nope' }))).rejects.toMatchObject({ code: 'reference_not_found' })
```

`card` escribe su propio error en su lugar, porque "la columna existe, pero en otro
tablero" merece su propio `code`. El capítulo [18](./18-references) trata de las
referencias.

### O ninguno, a propósito

No toda falta es un error. Cuando otro módulo pregunta "¿hay un tablero con este
nombre?", "no" es una respuesta, no un fallo. Entonces el caso de uso devuelve `null`:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
/** For other modules: the board with this name, whatever its case, if there is one. */
@UseCase()
async findByName(name: string): Promise<BoardDTO | null> {
  const board = await this.repo.first({ name: { ieq: BoardName.from(name) } })
  return board?.toDTO() ?? null
}
```

`get` dice "dame este": que falte es un 404. `findByName` dice "¿hay alguno?": que
falte es `null`. Ponles nombres que dejen ver la diferencia a quien llama.

## Listas: por páginas

Ninguna lista se devuelve entera salvo que una regla del dominio la acote (como mucho
10 columnas, 500 cards); las demás van por páginas. Un caso de uso que lista recibe un `PageRequest`
(`size`, `cursor`) y devuelve un `Page` (`items`, `hasMore`, `total`):

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
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
```

El repositorio devuelve una página de **entidades**; el caso de uso la convierte en una
página de **DTOs**, escribiendo los tres campos uno a uno. Se podría abreviar, pero así
se lee exactamente lo que sale.

La ruta lee la página con `pageRequestFrom(request)`: `?size=20&cursor=<id>`. El tamaño
es 20 si no se dice, y se mantiene entre 1 y 100 pida lo que pida el cliente:

```ts
// cooper/backend/contexts/boards/modules/board/board.routes.ts
workspace.get('/boards', async request => Response.json(await boards.list(pageRequestFrom(request))))
```

El cursor es el id del último elemento que el cliente ya tiene. Los ids son UUIDv7, que
se ordenan por fecha de creación, así que las páginas son estables aunque se añadan
tableros mientras tanto.

Las páginas van de lo más antiguo a lo más nuevo por defecto. Para listas que se leen al
revés (los últimos tableros, la actividad), pasa `{ newestFirst: true }`: empieza por lo
más nuevo y el cursor va hacia atrás. Es lo que hacen los tableros, y el test lo enseña:

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
test('lists a workspace\'s boards by pages, the newest first', async () => {
  for (const name of ['Roadmap', 'Bugs', 'Launch']) await create(name)

  const first = await inAcme(() => t.modules.board.list({ size: 2 }))
  expect(first.items.map(board => String(board.name))).toEqual(['Launch', 'Bugs'])
  expect(first).toMatchObject({ hasMore: true, total: 3 })

  const next = await inAcme(() => t.modules.board.list({ size: 2, cursor: first.items[1]!.id }))
  expect(next.items.map(board => String(board.name))).toEqual(['Roadmap'])
  expect(next.hasMore).toBe(false)
})
```

Por HTTP:

```http
GET /api/workspaces/acme/boards?size=2
→ { "items": [Launch, Bugs], "hasMore": true, "total": 3 }

GET /api/workspaces/acme/boards?size=2&cursor=<id de Bugs>
→ { "items": [Roadmap], "hasMore": false, "total": 3 }
```

### Las listas que van enteras, y por qué

Dos listas de `boards` se devuelven enteras, y cada una dice por qué en su comentario:

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
/**
 * A board's columns, from left to right: whole, since a board has at most
 * `MAX_COLUMNS`. A board the workspace does not have has none.
 */
@UseCase()
async list(boardId: string): Promise<ColumnDTO[]> {
  return (await this.repo.ofBoard(boardId)).map(column => column.toDTO())
}
```

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * A board's cards, column by column and from the top: whole, since a board is read
 * as one screen and holds at most `MAX_CARDS`. The list that grows without end, the
 * search, comes by pages.
 */
@UseCase()
async listInBoard(boardId: string): Promise<CardDTO[]> {
  const cards = await this.repo.find({ boardId }, { orderBy: [{ field: 'columnId' }, { field: 'position' }] })
  return cards.map(card => card.toDTO())
}
```

Los dos límites son reglas del dominio, y las guardan sus módulos (capítulo
[8](./08-rules-over-rows)):

```ts
// cooper/backend/contexts/boards/modules/column/column.schema.ts
export const MAX_COLUMNS = 10
```

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export const MAX_CARDS = 500
```

Un tablero tiene como mucho diez columnas y como mucho 500 tarjetas; la 501 se rechaza
con `card.too_many`, por mucha gente que cree tarjetas a la vez. Así cada lista tiene
un límite, y su tamaño se sabe antes de que nadie pregunte. La regla no es "nunca un
array"; es "nunca una lista sin límite". Cuando el tamaño de una lista lo fija una
regla del dominio, puede ir entera; cuando crece con el uso (los tableros de un
workspace, la búsqueda en todas las tarjetas), se pagina.

Un test sostiene juntos el límite y la lista: pasado el límite, crear falla, y la lista
se queda en su tamaño.

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('holds up to MAX_CARDS cards in a board, however many are created at once', async () => {
  await Promise.all(Array.from({ length: MAX_CARDS - 3 }, (_, i) => create(`Task ${i}`)))

  const created = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => create(`More ${i}`)))

  expect(created.filter(each => each.status === 'fulfilled')).toHaveLength(3)
  for (const each of created.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'card.too_many' })
  expect(await inAcme(() => t.modules.card.listInBoard(boardId))).toHaveLength(MAX_CARDS)
})
```

::: tip Consejo
Si haces una lista entera, dale su límite en el mismo cambio: el máximo en el esquema,
su error y la comprobación donde se guarda la entidad. Una lista entera sin límite es
una página que se te olvidó escribir.
:::

## Casos de uso para otros

Un caso de uso no sirve solo a una ruta. `board` tiene algunos que solo llaman otros
módulos, workers o contextos:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
/** For other contexts (the backoffice): a page of a workspace's boards, the newest first. */
@UseCase()
async listOf(workspaceId: string, page: PageRequest): Promise<Page<BoardDTO>> {
  return runInWorkspace(workspaceId, () => this.list(page))
}
```

El caso de uso de una ruta toma el workspace del ámbito en el que entró su ruta. El
backoffice no está en ningún workspace: nombra uno, y `listOf` entra en él y llama a
`list`. La regla (lo más nuevo primero, por páginas) sigue escrita una sola vez, en
`list`.

## En resumen

- Un caso de uso valida, carga, decide, cambia la entidad, guarda una vez y devuelve
  DTOs.
- Valida dos veces a propósito: indulgente en la puerta (un 400 para el cliente),
  estricto en la entidad (nunca existe una entidad inválida). Escribe cada regla una
  vez, y deriva los esquemas de entrada del de la entidad.
- `resolve` convierte "uno o ninguno" en una entidad o en el error que elijas: 404 si
  el id es lo que se pide, 400 si va dentro de la petición. `resolveRefs` hace lo
  segundo por ti. Cuando que falte es una respuesta, devuelve `null`.
- Toda lista que crece se pagina: entra un `PageRequest`, sale un `Page`, y
  `newestFirst` para las que se leen al revés. Una lista solo puede ir entera cuando
  una regla del dominio la limita.
