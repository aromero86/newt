# Consultas que una tabla no sabe decir: Kysely

El tablero de acme tiene cuarenta tarjetas, y ana las ve todas a la vez. El espacio de
trabajo tiene cuatrocientas, repartidas en muchos tableros, y no puede. Quiere
preguntar: las tarjetas que dicen "plan", en *Doing*, asignadas a bea. El personal,
más adelante, quiere saber cuántas tarjetas tiene cada espacio de trabajo, todo en una
lista.

Los criterios te han llevado hasta aquí. Saben decir "igual", "uno de estos", "mayor
que", "igual sea cual sea la capitalización". No saben decir "contiene", y no saben
decir "cuéntalas por tablero". Este capítulo añade la herramienta para lo que no
saben decir: **Kysely**, un constructor de consultas con tipos, que se ejecuta sobre el
store propio de boards. Con él llegan dos cosas que necesita una búsqueda: los grupos
en que se anidan los criterios, y una forma de decir qué filtros puede enviar un
*cliente*, y de responder 400 al resto.

La búsqueda de texto que escribes aquí es una primera versión, a propósito. Funciona, y
enseña dónde se queda corto el `like` de una base de datos. El [capítulo
16](./16-search-port) la saca de la tabla.

## Los criterios, todos

Hasta ahora los criterios pedían todo a la vez: `{ boardId, number }` es "este tablero
**y** este número". Un campo puede tomar un valor (igual, `null` para "no tiene")
o una condición con operadores:

| Operador | Significa |
| --- | --- |
| `eq` | igual |
| `ne` | distinto, `null` incluido: `{ ne: null }` es "tiene uno" |
| `in` | uno de una lista |
| `gt`, `gte`, `lt`, `lte` | mayor, al menos, menor, como mucho |
| `ieq` | igual sea cual sea la capitalización de la A a la Z |

Para decir "este **o** aquel", los criterios se anidan en grupos: `and` (todos) y `or`
(al menos uno), tan hondo como quieras:

```ts
{ or: [{ assigneeId: 'bea' }, { number: 4 }] }
{ boardId, and: [{ number: { gte: 10 } }, { number: { lt: 20 } }] }
```

Todos los stores los responden igual: SQLite escribe un `WHERE`, el store de ficheros
comprueba cada fila. Los criterios son para el código del propio módulo, y pueden
preguntar por cualquier campo de la fila. Lo que envía un cliente es otra cosa, y
viene más abajo.

Ninguno de ellos es "contiene". `ieq` encuentra *Plan the launch* cuando escribes *plan
the LAUNCH*, no cuando escribes *launch*. Y nada en los criterios agrupa ni cuenta.

## Kysely sobre el store

Añade Kysely al proyecto, en la versión que usa cooper:

```sh
bun add --exact kysely@0.29.6
```

newt no ejecuta Kysely sobre una base de datos propia. `kyselyFor(store)`, de
`newt/kysely`, te da Kysely sobre la conexión **del store**:

- Sus sentencias se ejecutan dentro de `store.transaction` cuando hay una en curso, así
  que una consulta tuya en un hook de un guardado lee y escribe en la misma transacción.
  Las transacciones propias de Kysely se rechazan: no serían las del store.
- Los nombres de campo son los de las filas (`workspaceId`), y por el camino se
  convierten en los de las columnas (`workspace_id`). Nunca escribes el nombre de una
  columna.
- La misma consulta se ejecuta en SQLite, Postgres y MySQL. Necesita un store SQL: con
  ficheros no hay Kysely.
- Fuera de una transacción, SQLite rechaza una escritura. Usa Kysely para leer; escribe
  a través del repositorio, o dentro de `store.transaction`.

La base de boards es donde todos los módulos lo reciben. Sustituye `boards-base.ts`:

```ts
// cooper/backend/contexts/boards/boards-base.ts
import { kyselyFor } from 'newt/kysely'
import { CooperBase } from '../../shared/cooper-base'
import type { BoardsDatabase } from './boards-database'

/**
 * What every module of `boards` receives: cooper's base, and Kysely on its store, for
 * the queries a table cannot say (cards counted by workspace and by board, and searched
 * by their text). Kysely needs a SQL store: `boards` opens on SQLite, and would open on
 * Postgres or MySQL the same way, never on files.
 */
export class BoardsBase extends CooperBase {
  readonly db = kyselyFor<BoardsDatabase>(this.store)
}
```

`kyselyFor` toma la forma de la base de datos como un tipo: cada tabla por su nombre,
con los campos de sus filas. Esas filas ya las declaraste, una por repositorio. Un
fichero nuevo las lista:

```ts
// cooper/backend/contexts/boards/boards-database.ts
import type { SqliteRow } from 'newt/kysely'
import type { ActivityRow } from './modules/activity/activity.repository'
import type { BoardRow } from './modules/board/board.repository'
import type { CardCounterRow, CardRow } from './modules/card/card.repository'
import type { ColumnRow } from './modules/column/column.repository'

/**
 * The tables of `boards`, as its repositories query them with Kysely: each one by its
 * name, with the fields of its rows (`workspaceId`, never `workspace_id`). A
 * repository queries only its own table.
 */
export type BoardsDatabase = {
  board: SqliteRow<BoardRow>
  column: SqliteRow<ColumnRow>
  card: SqliteRow<CardRow>
  card_counter: SqliteRow<CardCounterRow>
  activity: SqliteRow<ActivityRow>
}
```

`SqliteRow<Row>` dice una fila tal como SQLite se la devuelve a una consulta tuya: un
booleano como 0 o 1, un objeto o una lista como su texto JSON. El `detail` de una
actividad es un objeto en su fila; en `BoardsDatabase` es un `string`, que es lo que
lee una consulta tuya.

Todas las tablas de boards están en el tipo, pero la regla del capítulo
[6](./06-rules-over-rows) sigue en pie: un repositorio consulta solo su propia tabla.
Kysely dejaría que `Card_Repository` leyera `column`; la revisión no debería.

## Por qué campos puede filtrar un cliente: `CardFilter`

Una búsqueda recibe un filtro del cliente. Si aceptara cualquier criterio, un cliente
podría filtrar por cualquier campo: `workspaceId` con el id de otro espacio de trabajo,
o un grupo de mil `or` hecho para ahogar la base de datos. Así que el cliente envía un
**filtro**, y el módulo declara cuáles acepta.

`defineFilter`, de `newt/contract`, declara uno. Un filtro es parte del contrato
público del módulo, así que va en `card.schema.ts`, junto a los DTO; `newt/contract` es
seguro en un navegador, y el frontend también recibe su tipo. Añade su import arriba:

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
import { defineFilter } from 'newt/contract'
import { z } from 'zod'
```

Después de `CardAssignSchema`, declara el filtro y la entrada de la búsqueda:

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export const CardAssignSchema = z.object({ assigneeId: z.string() })

/** What a client may search cards by: these fields, these operators, nothing else. */
export const CardFilter = defineFilter({
  board: { field: 'boardId', value: z.string(), ops: ['eq', 'in'] },
  column: { field: 'columnId', value: z.string(), ops: ['eq', 'in'] },
  assignee: { field: 'assigneeId', value: z.string(), ops: ['eq', 'in'] },
  number: { field: 'number', value: z.number().int(), ops: ['eq'] },
}, { maxDepth: 2, maxConditions: 10 })

/** A search: words its title or description has (whatever their case), and a filter on the fields above. */
export const CardSearchSchema = z.object({
  text: z.string().trim().max(100).optional(),
  filter: CardFilter.schema.optional(),
})
```

y, después de los otros tipos DTO, los tipos que usa un cliente, y dos para los
recuentos de más abajo:

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
export type CardAssignDTO = z.input<typeof CardAssignSchema>
/** A filter as a client sends it: groups of conditions on the fields of `CardFilter`. */
export type CardFilterDTO = z.infer<typeof CardFilter.schema>
export type CardSearchDTO = z.input<typeof CardSearchSchema>

/** How many cards a workspace has, for whoever looks at many (the staff's backoffice). */
export type CardCountByWorkspace = { workspaceId: string, cards: number }
/** How many cards a board has. */
export type CardCountByBoard = { boardId: string, cards: number }
```

Lo que te da `defineFilter`:

- **Nombres públicos.** Cada uno (`column`) apunta a un campo de la fila (`columnId`).
  El contrato no enseña cómo se guardan las tarjetas, y puedes renombrar un campo sin
  romper a ningún cliente.
- **Una lista cerrada.** Un campo que no está declarado, o un operador que un campo no
  permite, no pasa. `workspaceId` y `title` no están en la lista, así que ningún
  cliente filtra por ellos. Tampoco puede una condición llevar claves propias: cada una
  es exactamente `{ field, op, value }`.
- **Límites.** `maxDepth` es cuánto pueden anidarse los grupos, `maxConditions` cuántas
  condiciones tiene un filtro en total; por defecto valen 3 y 20. Un `in` lista como
  mucho 100 valores. Los límites se comprueban primero sobre la entrada tal cual, antes
  de que zod la recorra, así que un filtro anidado a miles de niveles se rechaza barato.
- **`schema`**, un esquema de zod para el árbol, y **`toCriteria(filter)`**, que
  convierte un filtro ya parseado en criterios de los campos de la fila.

Un cliente envía un árbol como este:

```json
{
  "or": [
    { "field": "assignee", "op": "eq", "value": "bea" },
    { "field": "number", "op": "eq", "value": 4 }
  ]
}
```

y `toCriteria` lo convierte en `{ or: [{ assigneeId: { eq: 'bea' } }, { number: { eq: 4 } }] }`.

Cualquier otra cosa hace fallar `CardSearchSchema.parse`, que lanza el error de zod;
newt lo responde como un **400** con `code: 'validation'` y las incidencias de zod,
igual que con cualquier cuerpo que no es correcto ([capítulo 3](./03-pages-and-errors)).

Cada operador que ofreces es una consulta que cualquiera puede ejecutar. Un `or` entre
campos distintos impide que la base de datos use un solo índice, y puede leer todas las
filas. `CardFilter` lo permite, con límites bajos, sobre campos que la migración de
boards ya indexa tras el espacio de trabajo (`card_column`, `card_assignee`,
`card_number`). Ofrece poco y amplíalo cuando lo pida un caso real: ampliar un contrato
es fácil, retirar un operador que usan los clientes no lo es.

## El repositorio: una consulta para texto, filtro y página

La búsqueda necesita "contiene" sobre el título y la descripción, y los criterios no lo
saben decir. Así que es una consulta de Kysely en el repositorio de tarjetas. Arriba de
`card.repository.ts`, los imports crecen:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
import { toPage, type Criteria, type Page, type PageRequest } from 'newt/core'
import { whereOf } from 'newt/kysely'
import { TableRepository } from 'newt/repository'
import { sql, type SqlBool } from 'kysely'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId } from '../../workspace-scope'
import { Card, MAX_CARDS, type CardCountByBoard, type CardCountByWorkspace, type CardDTO } from './card'
```

Añade la búsqueda antes de `purgeWorkspace`:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
  /**
   * A page of the current workspace's cards that meet the criteria and have the text in
   * their title or description, whatever its case: criteria have no "contains", so it
   * is one query of Kysely, with the criteria in it (`whereOf` says them as the store's
   * tables do), paged by id. `%` and `_` are only themselves: `!` escapes them.
   */
  async search(criteria: Criteria<CardDTO>, text: string | undefined, page: PageRequest): Promise<Page<Card>> {
    const pattern = `%${(text ?? '').replace(/[!%_]/g, '!$&')}%`
    const matching = this.base.db
      .selectFrom('card')
      .where('workspaceId', '=', currentWorkspaceId())
      .where(whereOf(this.store, criteria))
      .where(eb => eb.or([
        sql<SqlBool>`lower(${eb.ref('title')}) like lower(${pattern}) escape '!'`,
        sql<SqlBool>`lower(${eb.ref('description')}) like lower(${pattern}) escape '!'`,
      ]))
    const [rows, counted] = await Promise.all([
      matching.selectAll().$if(page.cursor !== undefined, query => query.where('id', '>', page.cursor!)).orderBy('id').limit(page.size + 1).execute(),
      matching.select(eb => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow(),
    ])
    return toPage(rows.map(row => this.toEntity(row)), page.size, Number(counted.total))
  }
```

Léelo de arriba abajo:

- **El espacio de trabajo se escribe a mano.** El ámbito del repositorio (capítulo
  [4](./04-who-and-where)) filtra lo que leen `find`, `count` y `page`. Kysely no pasa
  por ellos, así que no conoce el ámbito. Si olvidas este `where`, la búsqueda
  encuentra las tarjetas de todos los espacios de trabajo.
- **`whereOf(store, criteria)`**, de `newt/kysely`, dice los criterios como una
  condición de Kysely: cada operador y grupo, `null` y capitalización respondidos
  exactamente como los responde `find` en ese store. El filtro del cliente, convertido
  en criterios, entra así en la consulta, junto al espacio de trabajo y nunca en su
  lugar. Un filtro por `board` con el id de un tablero de otro espacio de trabajo no
  encuentra nada.
- **`like`, con escape.** En `like`, `%` significa "cualquier cosa" y `_` "cualquier
  carácter". Una búsqueda de `100%` tiene que encontrar el texto *100%*, no todo lo que
  empieza por *100*. Por eso `!`, `%` y `_` en el texto llevan un `!` delante, y
  `escape '!'` lo dice. `!`, no la barra invertida de siempre: MySQL lee una barra
  invertida dentro de una cadena como un escape propio, y `!` no significa nada para
  ninguna de las tres bases de datos.
- **`lower` en ambos lados.** La columna y el texto los pasa a minúsculas la misma base
  de datos, de la misma manera. En SQLite eso es solo de la A a la Z. Así, *ÄRGER IM*
  encuentra *Ärger im Büro*: SQLite deja la *Ä* tal cual en ambos lados y pasa el resto
  a minúsculas. Pero *ärger* no lo encuentra en SQLite. Es el primer sitio donde `like`
  se queda corto.
- **Una consulta, ejecutada dos veces en paralelo**: `matching` es la consulta hasta sus
  `where`. Una vez para la página (todas las columnas, tras el cursor, por id, una fila
  más que la página para saber si siguen más) y otra para el total (`countAll`).
  `toPage` de newt arma la `Page` con ambas, como hace `TableRepository.page`: descarta
  la fila de más y dice `hasMore`.
- **`Number(counted.total)`**: un recuento vuelve como número en SQLite y como texto en
  Postgres. `Number` lo deja igual en todas partes.

Todo está en una consulta: el espacio de trabajo, el filtro, el texto, la página y el
total. Nunca traigas los ids que coinciden para devolverlos en un `in`: una consulta
admite un número limitado de parámetros (250.000 en SQLite en Bun), y una búsqueda que
coincida con más se rompería.

## Recuentos

Dos consultas más que los criterios no saben decir: cuántas tarjetas tiene cada espacio
de trabajo, y cada tablero. `count(criteria)` es un número; estas son un `GROUP BY`.
Añádelas después de la búsqueda:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
  /**
   * How many cards each of these workspaces has, by one query that groups them.
   * Across workspaces on purpose: for the staff's backoffice, which looks at
   * all of them, never for a workspace's own work.
   */
  async countByWorkspace(workspaceIds: string[]): Promise<CardCountByWorkspace[]> {
    if (workspaceIds.length === 0) return []
    const rows = await this.base.db
      .selectFrom('card')
      .select(eb => ['workspaceId', eb.fn.countAll<number>().as('cards')])
      // Criteria, as a table takes them, said in Kysely's query by `whereOf`.
      .where(whereOf(this.store, { workspaceId: { in: workspaceIds } }))
      .groupBy('workspaceId')
      .execute()
    const counts = new Map(rows.map(row => [row.workspaceId, Number(row.cards)]))
    return workspaceIds.map(workspaceId => ({ workspaceId, cards: counts.get(workspaceId) ?? 0 }))
  }

  /** How many cards each board of the current workspace has: boards without any are not there. */
  async countByBoard(): Promise<CardCountByBoard[]> {
    const rows = await this.base.db
      .selectFrom('card')
      .select(eb => ['boardId', eb.fn.countAll<number>().as('cards')])
      .where('workspaceId', '=', currentWorkspaceId())
      .groupBy('boardId')
      .orderBy('boardId')
      .execute()
    return rows.map(row => ({ boardId: row.boardId, cards: Number(row.cards) }))
  }
```

`countByWorkspace` cruza espacios de trabajo, y lo dice: es para el backoffice del
personal (capítulo [25](./25-backoffice)), que los mira todos. Sus propios criterios
también pasan por `whereOf`: `{ workspaceId: { in: workspaceIds } }`, que `whereOf`
convierte en un `in` con un parámetro por id. Un espacio de trabajo sin tarjetas no
tiene fila en el `GROUP BY`, así que el método le da su 0. `countByBoard` se queda en el
espacio de trabajo actual, escrito a mano como en la búsqueda.

## Los casos de uso

En `card.module.ts`, el primer import recibe `mapPage`, `Page` y `PageRequest`, y el
import de `./card` recibe el filtro, el esquema de la búsqueda y los tipos nuevos:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
import { currentActor, eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { runInWorkspace } from '../../workspace-scope'
import type { ColumnDTO } from '../column/column.schema'
import {
  Card,
  CardAssignSchema,
  CardCreateSchema,
  CardEditSchema,
  CardFilter,
  CardMoveSchema,
  CardSearchSchema,
  MAX_CARDS,
  type CardAssignDTO,
  type CardAuthor,
  type CardCountByBoard,
  type CardCountByWorkspace,
  type CardCreateDTO,
  type CardDTO,
  type CardEditDTO,
  type CardMoveDTO,
  type CardSearchDTO,
} from './card'
```

`listInBoard` lee un tablero entero, ya que contiene como mucho `MAX_CARDS`. Su
comentario ahora dice adónde va la lista que crece:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * A board's cards, column by column and from the top: whole, since a board is read
   * as one screen and holds at most `MAX_CARDS`. The list that grows without end, the
   * search, comes by pages.
   */
```

Después de `getByNumber`, la búsqueda:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * A page of the workspace's cards that have the text and pass the filter: only the
   * fields and operators `CardFilter` allows.
   */
  @UseCase()
  async search(input: CardSearchDTO, page: PageRequest): Promise<Page<CardDTO>> {
    const { text, filter } = CardSearchSchema.parse(input)
    const criteria = filter ? CardFilter.toCriteria<CardDTO>(filter) : {}
    return mapPage(await this.repo.search(criteria, text, page), card => card.toDTO())
  }
```

Parsea lo que envió el cliente, convierte el filtro en criterios de los campos de la
tarjeta (`toCriteria<CardDTO>`), y pide una página al repositorio. Lo que impone el
sistema, el espacio de trabajo, no está en el caso de uso en absoluto: el repositorio lo
añade junto a los criterios, así que ningún filtro puede esquivarlo. Una regla propia
del módulo (digamos, solo las tarjetas no hechas) iría también junto al filtro, como
`{ and: [criteria, { … }] }`, nunca dentro de lo que envió el cliente.

Después de `unassignMember`, los recuentos:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /** For other contexts (the staff's backoffice): how many cards each of these workspaces has. */
  @UseCase()
  async countByWorkspace(workspaceIds: string[]): Promise<CardCountByWorkspace[]> {
    return this.repo.countByWorkspace([...new Set(workspaceIds)])
  }

  /** For other contexts: how many cards each board of a workspace has. */
  @UseCase()
  async countByBoard(workspaceId: string): Promise<CardCountByBoard[]> {
    return runInWorkspace(workspaceId, () => this.repo.countByBoard())
  }
```

Nadie los llama todavía por HTTP: son casos de uso para otros contextos, que cablea el
capítulo [25](./25-backoffice).

## La ruta

Un árbol de grupos no cabe bien en una URL, así que una búsqueda viaja en el cuerpo de
un `POST`. La página (`size`, `cursor`) se queda en la query string, como en toda
lista. En `card.routes.ts`, importa `pageRequestFrom` y el DTO de la búsqueda:

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
import { pageRequestFrom, type KeptAnswer } from 'newt/http'
import type { BoardsBase } from '../../boards-base'
import { workspaceRoutes } from '../../workspace-routes'
import type { CardAssignDTO, CardCreateDTO, CardEditDTO, CardMoveDTO, CardSearchDTO } from './card'
```

y añade la ruta después de la que crea una tarjeta, antes de `/cards/:cardId`:

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
  // A search sends its filter in the body: groups of conditions do not fit in a URL.
  workspace.post('/cards/search', async request => {
    const input = await request.json() as CardSearchDTO
    return Response.json(await cards.search(input, pageRequestFrom(request)))
  })
```

Está en el grupo del espacio de trabajo, así que vive en
`/api/workspaces/:workspaceId/cards/search`, y solo llegan a ella los miembros del
espacio de trabajo. No lleva `idempotency`: una búsqueda no cambia nada, así que
enviarla dos veces es seguro.

## Tests

En `card.test.ts`, importa también `CardDTO`:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
import { MAX_CARDS, type CardCreateDTO, type CardDTO } from './card.schema'
```

y añade tres tests después de *tells nobody of a card they created for themselves, or
took*:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('searches the workspace\'s cards by text, column and assignee, by pages', async () => {
    await create('Write the plan', { description: 'Dates and PEOPLE' })
    await create('Design the logo', { columnId: doing, assigneeId: 'bea' })
    await create('Plan the party', { columnId: doing })
    await create('100% done_ish')
    const search = (input: object, size = 10) => inAcme(() => t.modules.card.search(input, { size }))
    const titles = (page: { items: CardDTO[] }) => page.items.map(card => card.title)

    expect(titles(await search({ text: 'PLAN' }))).toEqual(['Write the plan', 'Plan the party'])
    expect(titles(await search({ text: 'people' }))).toEqual(['Write the plan'])
    expect(titles(await search({ text: '%' }))).toEqual(['100% done_ish'])
    expect(titles(await search({ text: 'plan', filter: { field: 'column', op: 'eq', value: doing } }))).toEqual(['Plan the party'])
    expect(titles(await search({ filter: { or: [{ field: 'assignee', op: 'eq', value: 'bea' }, { field: 'number', op: 'eq', value: 4 }] } }))).toEqual(['Design the logo', '100% done_ish'])

    const first = await search({}, 3)
    expect(first).toMatchObject({ hasMore: true, total: 4 })
    await expect(search({ filter: { field: 'title', op: 'eq', value: 'x' } })).rejects.toThrow()
  })

  test('finds a card by its title whatever the case of A to Z, and other letters as they are written', async () => {
    await create('Ärger im Büro')

    const found = await inAcme(() => t.modules.card.search({ text: 'ÄRGER IM' }, { size: 10 }))

    expect(found.items.map(card => card.title)).toEqual(['Ärger im Büro'])
  })

  test('counts cards by workspace and by board, for the backoffice', async () => {
    await create('Plan')
    await create('Design')
    const other = await inAcme(() => t.modules.board.create({ name: 'Other' }))
    const column = await inAcme(() => t.modules.column.add(other.id, { name: 'To do' }))
    await inAcme(() => t.modules.card.create(other.id, { columnId: column.id, title: 'Elsewhere' }))

    expect(await t.modules.card.countByWorkspace(['acme', 'globex'])).toEqual([{ workspaceId: 'acme', cards: 3 }, { workspaceId: 'globex', cards: 0 }])
    expect(await t.modules.card.countByBoard('acme')).toEqual([{ boardId, cards: 2 }, { boardId: other.id, cards: 1 }].sort((a, b) => a.boardId.localeCompare(b.boardId)))
  })
```

El primero cubre el texto (cualquier capitalización, también en la descripción, `%`
como él mismo), un filtro solo y con texto, un grupo, una página con más por venir, y un
campo que el filtro no permite. El segundo comprueba la capitalización, y su nombre dice lo que
muestra: SQLite pliega solo de la A a la Z. *RGER IM* encuentra *rger im* sea cual sea su
capitalización, y la *Ä* está escrita como la tiene el título, así que SQLite la
encuentra; una *ä* en minúscula no la encontraría.

En `boards.context.test.ts`, después de *removes a column only when it is empty*, una
búsqueda por HTTP, y un filtro por un campo que no permite:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
  test('searches cards with a filter in the body, and refuses one it does not allow', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id
    const todo = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'To do' })).body.id
    for (const title of ['Plan the launch', 'Design', 'Plan the party']) await call('POST', `/acme/boards/${id}/cards`, { columnId: todo, title })

    const found = await call<{ items: { title: string }[], total: number }>('POST', '/acme/cards/search?size=1', { text: 'plan', filter: { field: 'column', op: 'eq', value: todo } })
    expect(found.body).toMatchObject({ items: [{ title: 'Plan the launch' }], total: 2, hasMore: true })

    expect(await call('POST', '/acme/cards/search', { filter: { field: 'workspaceId', op: 'eq', value: 'globex' } })).toMatchObject({ status: 400, body: { code: 'validation' } })
  })
```

Y `workspace.test.ts` comprueba que un espacio de trabajo borrado no deja tarjetas
atrás, ahora que puede contarlas. En *prepares nothing in a workspace auth deleted
before its work ran*, añade la última línea:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
    expect(await t.modules.board.listOf('acme', { size: 10 })).toMatchObject({ items: [], total: 0 })
    expect(await t.modules.card.countByWorkspace(['acme'])).toEqual([{ workspaceId: 'acme', cards: 0 }])
  })
```

y en *removes all a workspace has once auth deletes it, and nothing of any other*, la
línea del medio:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
    expect(await t.modules.board.listOf('acme', { size: 10 })).toMatchObject({ items: [], total: 0 })
    expect(await t.modules.card.countByWorkspace(['acme', 'globex'])).toEqual([{ workspaceId: 'acme', cards: 0 }, { workspaceId: 'globex', cards: 1 }])
    expect((await t.modules.board.listOf('globex', { size: 10 })).total).toBe(1)
```

## Compruébalo

```sh
bun install && bun check && bun test cooper && bun run lint
```

Luego a mano. Arranca el backend (`bun cooper/backend/index.ts`), crea un tablero con
una columna y tres tarjetas, y búscalas de una en una por página:

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
BOARD=$(curl -s -X POST $API/boards -H "$H" -H 'x-user: ana' -d "{\"name\":\"Launch $RANDOM\"}" | jq -r .id)
COLUMN=$(curl -s -X POST $API/boards/$BOARD/columns -H "$H" -H 'x-user: ana' -d '{"name":"To do"}' | jq -r .id)
for title in 'Plan the launch' 'Design' 'Plan the party' 'Ärger im Büro'; do
  curl -s -X POST $API/boards/$BOARD/cards -H "$H" -H 'x-user: ana' -d "{\"columnId\":\"$COLUMN\",\"title\":\"$title\"}" > /dev/null
done
curl -s -X POST "$API/cards/search?size=1" -H "$H" -H 'x-user: ana' \
  -d "{\"text\":\"PLAN\",\"filter\":{\"field\":\"column\",\"op\":\"eq\",\"value\":\"$COLUMN\"}}" \
  | jq '{ titles: [.items[].title], hasMore, total }'
```

```text
{
  "titles": [
    "Plan the launch"
  ],
  "hasMore": true,
  "total": 2
}
```

Un filtro por un campo que `CardFilter` no ofrece:

```sh
curl -s -i -X POST $API/cards/search -H "$H" -H 'x-user: ana' \
  -d '{"filter":{"field":"workspaceId","op":"eq","value":"globex"}}' | head -1
```

```text
HTTP/1.1 400 Bad Request
```

Su cuerpo es `{ "error": …, "code": "validation", "issues": [ … ] }`, con las
incidencias de zod para cada campo y operador que probó. Un filtro anidado más hondo
que `maxDepth` también es un 400, con una sola incidencia: `A filter nests at most 2
groups deep`.

Y el límite de `lower` en SQLite:

```sh
for text in ÄRGER ärger; do
  curl -s -X POST $API/cards/search -H "$H" -H 'x-user: ana' -d "{\"text\":\"$text\"}" | jq -c '[.items[].title]'
done
```

```text
["Ärger im Büro"]
[]
```

## Lo que `like` no puede hacer

La búsqueda funciona, y es el primer paso correcto: una consulta, el espacio de trabajo
a mano, el filtro del cliente a través de `whereOf`, la página y el total juntos.
También enseña dónde una tabla deja de ser el sitio para el texto:

- **`%texto%` no puede usar un índice.** Lee el título y la descripción de cada tarjeta
  del espacio de trabajo. Con cientos está bien; con todas las de cooper no lo estaría.
- **Encuentra letras, no palabras.** *plan* encuentra *planet* y *airplane*. Nadie
  espera que *Plans* encuentre *plan*, porque `like` no puede.
- **La capitalización es la de la base de datos.** SQLite pasa a minúsculas solo de la
  A a la Z; Postgres y MySQL, más. La misma búsqueda responde distinto según dónde se
  ejecute boards.

Cada base de datos tiene un índice de texto completo propio, y el de cada una es
distinto: FTS5 en SQLite, `tsvector` en Postgres, `FULLTEXT` en MySQL. Usar uno ata
boards a ese store. El capítulo siguiente toma el otro camino: la búsqueda de texto sale
de la tabla, detrás de un puerto propio de boards.

## Qué recordar

- Los criterios dicen igual, uno de, mayor y menor, igual sea cual sea la
  capitalización, anidados en `and` y `or`. Son para el código del propio módulo.
- Lo que los criterios no saben decir ("contiene", un `GROUP BY`) es Kysely, desde
  `kyselyFor` en la base del contexto, con tipos por sus tablas (`SqliteRow<Row>`), en el
  repositorio de la tabla que lee. Se ejecuta sobre la conexión y la transacción del
  store.
- Kysely no conoce el ámbito del repositorio: escribe tú el `where` del espacio de
  trabajo. Los criterios entran con `whereOf(store, criteria)`, respondidos como los
  responde `find`.
- Un cliente filtra solo por lo que permite `defineFilter`: nombres públicos,
  operadores por campo, `maxDepth` y `maxConditions`. Cualquier otra cosa es un 400
  `validation`. Las reglas del sistema van junto al filtro del cliente, nunca dentro.
- Una consulta para la página y su total; nunca ids traídos para devolverlos en un `in`.

Siguiente: [Un puerto de búsqueda propio](./16-search-port).
