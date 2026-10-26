# Búsquedas

Un tablero con cuarenta cards se repasa de un vistazo. Un espacio de trabajo con
cuatrocientas, no. La gente quiere preguntar: las cards que hablan de "launch", en
Doing, asignadas a Bob. El staff quiere encontrar una cuenta por su email, o un espacio
por su nombre.

El peligro está en lo que puede enviar un cliente. Si una búsqueda aceptara cualquier
criterio, un cliente podría filtrar por cualquier columna (un hash de contraseña, el id
de otro espacio) y montar una consulta tan lenta que atascara la base de datos. Este
capítulo enseña cómo deja newt buscar a un cliente, y solo dentro de lo que tú decides.

## Criterios con grupos

Los criterios que has usado hasta ahora piden que todo se cumpla a la vez:
`{ boardId, number }` es "este tablero **y** este número". Para decir "esto **o**
aquello", los criterios se agrupan: `and` (todos) y `or` (al menos uno).

```ts
{ or: [{ assigneeId: 'bea' }, { number: 4 }] }
{ and: [criteria, { id: { in: ids } }] }
```

Todos los stores los responden igual. `allOf(a, b)`, de newt, es la segunda forma ya
escrita:

```ts
// packages/newt/core/criteria/all-of.ts
/** Both at once: what `a` asks, and what `b` asks. */
export function allOf<Row>(a: Criteria<Row>, b: Criteria<Row>): Criteria<Row> {
  return { and: [a, b] } as Criteria<Row>
}
```

Los criterios son para el código del módulo, y pueden preguntar por cualquier cosa de la
fila. Lo que envía un cliente es otra cosa.

## Lo que un cliente puede pedir: `defineFilter`

Un **filtro** es lo que envía un cliente. Forma parte del contrato público del módulo,
así que va en `card.schema.ts`, junto a los DTOs, y está cerrado: dice qué campos puede
filtrar un cliente, con qué operadores cada uno, y hasta qué tamaño.

```ts
// cooper/backend/contexts/boards/modules/card/card.schema.ts
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

// …
/** A filter as a client sends it: groups of conditions on the fields of `CardFilter`. */
export type CardFilterDTO = z.infer<typeof CardFilter.schema>
export type CardSearchDTO = z.input<typeof CardSearchSchema>
```

- Cada **nombre público** (`column`) apunta a un campo de la fila (`columnId`). El
  contrato no enseña cómo guardas los datos, y puedes renombrar un campo sin romper a
  los clientes.
- Un campo o un operador que no esté declarado es un **400**. `workspaceId` y `title` no
  están en la lista, así que nadie filtra por ellos.
- **`maxDepth`** limita cuántos grupos anidados caben, y **`maxConditions`**, cuántas
  condiciones tiene un filtro en total. Por defecto son 3 y 20. Un `in` lleva como mucho
  100 valores. Los límites se comprueban sobre la entrada tal cual llega, antes de que
  zod la recorra, así que un filtro anidado mil niveles se rechaza sin coste.

Un cliente envía un árbol como este:

```json
{
  "or": [
    { "field": "assignee", "op": "eq", "value": "bea" },
    { "field": "number", "op": "eq", "value": 4 }
  ]
}
```

## El caso de uso

`card.search` valida la entrada, convierte el filtro en criterios y le pide una página al
repositorio:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
/**
 * A page of the workspace's cards that have the text and pass the filter: only the
 * fields and operators `CardFilter` allows.
 */
@UseCase()
async search(input: CardSearchDTO, page: PageRequest): Promise<Page<CardDTO>> {
  const { text, filter } = CardSearchSchema.parse(input)
  const criteria = filter ? CardFilter.toCriteria<CardRow>(filter) : {}
  const found = await this.repo.search(criteria, text, page)
  return {
    items: found.items.map(card => card.toDTO()),
    hasMore: found.hasMore,
    total: found.total,
  }
}
```

Lo que impone el sistema va siempre **al lado** del filtro del cliente, nunca dentro, así
no hay filtro que lo esquive. Aquí el sistema impone el espacio de trabajo, y ni siquiera
aparece en el caso de uso: la búsqueda del repositorio escribe
`where('workspaceId', '=', currentWorkspaceId())` antes de los criterios del cliente, y
los une con un `and` (más abajo). Un cliente que filtra por `board` con el id de un
tablero de otro espacio no encuentra nada.

Cuando un módulo tiene una regla propia (solo los tableros sin archivar, por ejemplo),
añádela con `allOf(criteria, { … })` antes de preguntar al repositorio.

## La ruta

Un árbol de condiciones no cabe bien en una URL, así que una búsqueda viaja en el cuerpo
de un `POST`. La página (`size`, `cursor`) se queda en la query string, como en todas las
listas:

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
// A search sends its filter in the body: groups of conditions do not fit in a URL.
workspace.post('/cards/search', async request => {
  const input = await request.json() as CardSearchDTO
  return Response.json(await cards.search(input, pageRequestFrom(request)))
})
```

Está registrada en el grupo del espacio de trabajo, así que vive en
`/api/workspaces/:workspaceId/cards/search`, y solo llegan a ella sus miembros.

### Compruébalo

El test de la API de boards envía una búsqueda con texto y filtro, y después una con un
campo que el filtro no permite:

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

Con cooper en marcha, puedes lanzar la misma búsqueda a mano. Entra en boards desde un
navegador y copia su cookie `cooper_boards_session`:

```bash
curl -X POST "http://localhost:5172/api/workspaces/$WORKSPACE/cards/search?size=20" \
  -H 'content-type: application/json' -b "cooper_boards_session=$SESSION" \
  -d '{"text":"launch","filter":{"field":"assignee","op":"eq","value":"'"$BOB"'"}}'
```

## El texto: lo que un criterio no sabe decir

Los operadores de los criterios son `eq`, `ne`, `in`, `gt`, `gte`, `lt`, `lte` e `ieq`
(igual, sin importar mayúsculas de la A a la Z). No hay "contiene". `ieq` encuentra
"Plan the launch" si escribes "plan the LAUNCH", no si escribes "launch".

Así que una búsqueda de cards con texto es una consulta de Kysely, el segundo paso de la
regla de la portabilidad ([capítulo 22](./22-backoffice)). Una sola consulta lo hace
todo: el espacio de trabajo, los criterios del cliente, el texto, la página y el total.

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/**
 * A page of the current workspace's cards that meet the criteria and, if `text` is
 * given, have it in their title or description, whatever its case: one query of
 * Kysely, since criteria have no "contains", with the criteria in it too, and paged
 * by id as `page` pages (the cursor is the last id of the page before). Nothing is
 * read whole, however many cards match.
 *
 * What is portable to SQLite, Postgres and MySQL: `lower` on both sides of `like`,
 * so each database folds the column and the text alike (SQLite only A to Z; Postgres
 * and MySQL other letters too), and `!` as the escape character of `like`, which
 * none of them reads specially in a string (a backslash is one in MySQL's).
 */
async search(criteria: Criteria<CardRow>, text: string | undefined, page: PageRequest): Promise<Page<Card>> {
  const pattern = text ? `%${text.replace(/[!%_]/g, '!$&')}%` : undefined
  const matching = this.base.db
    .selectFrom('card')
    .where('workspaceId', '=', currentWorkspaceId())
    .where(eb => whereOf(eb, criteriaTree(criteria)))
    .$if(pattern !== undefined, query => query.where(eb => eb.or([
      sql<SqlBool>`lower(${eb.ref('title')}) like lower(${pattern}) escape '!'`,
      sql<SqlBool>`lower(${eb.ref('description')}) like lower(${pattern}) escape '!'`,
    ])))
  const [rows, counted] = await Promise.all([
    matching.selectAll().$if(page.cursor !== undefined, query => query.where('id', '>', page.cursor!)).orderBy('id').limit(page.size + 1).execute(),
    matching.select(eb => eb.fn.countAll<number>().as('total')).executeTakeFirstOrThrow(),
  ])
  return toPage(rows.map(row => this.toEntity(row)), page.size, Number(counted.total))
}
```

`matching` es la consulta hasta sus `where`. Se ejecuta dos veces, en paralelo: una para
la página (`selectAll`, después del cursor, por id, una más que la página para saber
`hasMore`) y otra para el total (`countAll`). `toPage`, de newt, monta la `Page` con las
dos, como hace `TableRepository.page` en cualquier otra lista.

Los criterios del cliente entran en la consulta gracias a `criteriaTree`, de
`newt/core`. Convierte unos criterios en un árbol que un store puede traducir: `all`
(todos), `any` (al menos uno) y `field` (una condición sobre un campo). cooper traduce
ese árbol a Kysely, para lo que `CardFilter` permite y nada más:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
/**
 * Criteria as a condition of Kysely on the cards: what `CardFilter` lets a client send
 * (every one, at least one, `eq` and `in` on a field of the card). Anything else is a
 * mistake of the code, not of the client.
 */
function whereOf(eb: ExpressionBuilder<BoardsDatabase, 'card'>, node: CriteriaNode): Expression<SqlBool> {
  if (node.kind === 'all') return eb.and(node.of.map(each => whereOf(eb, each)))
  if (node.kind === 'any') return eb.or(node.of.map(each => whereOf(eb, each)))
  const field = node.field as 'boardId' | 'columnId' | 'assigneeId' | 'number' | 'id'
  return eb.and(Object.entries(node.condition).map(([operator, operand]) => {
    if (operator === 'eq') return operand === null ? eb(field, 'is', null) : eb(field, '=', operand as string)
    // `in` with nothing in it holds for no card: an empty `or`.
    if (operator === 'in') return (operand as string[]).length === 0 ? eb.or([]) : eb(field, 'in', operand as string[])
    throw new Error(`A card search has no ${operator} on ${field}`)
  }))
}
```

La función es pequeña porque el filtro es cerrado. Un cliente no puede mandar `gt` sobre
una card, así que `whereOf` no tiene por qué conocerlo. Si algún día `CardFilter`
ofrece otro operador, el test que lo pruebe fallará aquí antes que en ningún otro sitio.

Detalles que importan:

- **El espacio de trabajo se escribe a mano.** Kysely no conoce el ámbito del
  repositorio. Olvida ese `where`, y la búsqueda encuentra cards de todos los espacios.
- **`%`, `_` y `!` se escapan, con `!`.** En `like`, `%` significa "lo que sea" y `_`
  "cualquier carácter". Una búsqueda de `100%` tiene que encontrar el texto `100%`, no
  todo lo que empieza por `100`. El carácter de escape es `!` y no la barra invertida
  de siempre, porque MySQL lee una barra invertida dentro de una cadena como un escape
  suyo, y SQLite y Postgres no: `!` no significa nada especial para ninguno de los
  tres.
- **`lower` a los dos lados.** La columna y el texto los pasa a minúsculas la misma
  base de datos, de la misma forma. En SQLite eso es solo de la A a la Z; en Postgres
  y MySQL, también otras letras. Así `ÄRGER IM` encuentra `Ärger im Büro` en todos los
  stores: SQLite deja la `Ä` tal cual a los dos lados y pasa el resto a minúsculas.
  (`ärger` no lo encontraría en SQLite.) Un test lo comprueba.
- **Una consulta, coincidan las cards que coincidan.** Una versión anterior buscaba
  primero los ids de las cards que coincidían, y después pedía una página con
  `{ id: { in: ids } }`. Eso se rompe cuando el texto coincide con más cards de los
  parámetros que admite una consulta: SQLite en Bun admite 250.000. Con todo en una
  consulta, la base de datos nunca devuelve los ids para que se los vuelvas a mandar.

Los tests del módulo cubren texto, filtro y grupos a la vez:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
expect(titles(await search({ text: 'PLAN' }))).toEqual(['Write the plan', 'Plan the party'])
expect(titles(await search({ text: 'people' }))).toEqual(['Write the plan'])
expect(titles(await search({ text: '%' }))).toEqual(['100% done_ish'])
expect(titles(await search({ text: 'plan', filter: { field: 'column', op: 'eq', value: doing } }))).toEqual(['Plan the party'])
expect(titles(await search({ filter: { or: [{ field: 'assignee', op: 'eq', value: 'bea' }, { field: 'number', op: 'eq', value: 4 }] } }))).toEqual(['Design the logo', '100% done_ish'])
```

Y un test cruza el límite a propósito. Escribe 250.001 cards directamente como filas
(ningún caso de uso dejaría a un tablero tener tantas: un tablero tiene como mucho 500),
y luego las recorre por páginas:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('searches by pages however many cards match, more than a query takes parameters (SQLite in Bun takes 250,000)', async () => {
  // Written as rows, past what any use case would let in: 250,001 cards of 501 boards.
  const now = new Date().toISOString()
  const rows = Array.from({ length: 250_001 }, (_, i) => ({
    id: Bun.randomUUIDv7(), workspaceId: 'acme', boardId: `board-${Math.floor(i / 500)}`, columnId: todo, number: i % 500 + 1,
    title: `Task ${i}`, description: '', assigneeId: i % 2 === 0 ? 'bea' : null, position: i % 500, createdAt: now, updatedAt: now, version: 1,
  }))
  await t.writeCards(rows)
  const search = (input: object, cursor?: string) => inAcme(() => t.modules.card.search(input, { size: 2, cursor }))

  const first = await search({ text: 'TASK' })
  expect(first).toMatchObject({ hasMore: true, total: 250_001 })
  expect(first.items.map(card => card.title)).toEqual(['Task 0', 'Task 1'])
  expect((await search({ text: 'task' }, first.items[1]!.id)).items.map(card => card.title)).toEqual(['Task 2', 'Task 3'])
  expect(await search({ text: 'task', filter: { field: 'assignee', op: 'eq', value: 'bea' } })).toMatchObject({ total: 125_001 })
  // `!`, `%` and `_` are only themselves.
  expect(await search({ text: '5!%' })).toMatchObject({ total: 0 })
}, 30_000)
```

Un test de un límite tiene que cruzarlo. Con 249.999 filas, la versión anterior habría
pasado.

## La misma herramienta en auth

El staff busca cuentas y espacios en el backoffice, pero las cuentas y los espacios son
de auth. Así que es auth quien declara los filtros, en sus esquemas:

```ts
// cooper/backend/contexts/auth/modules/user/user.schema.ts
export const UserFilter = defineFilter({
  email: { field: 'email', value: z.string(), ops: ['eq', 'ieq'] },
  name: { field: 'name', value: z.string(), ops: ['eq', 'ieq'] },
  signedUp: { field: 'createdAt', value: z.string(), ops: ['gte', 'lt'] },
}, { maxDepth: 2, maxConditions: 10 })
```

```ts
// cooper/backend/contexts/auth/modules/tenant/tenant.schema.ts
export const TenantFilter = defineFilter({
  name: { field: 'name', value: z.string(), ops: ['eq', 'ieq'] },
  admin: { field: 'createdBy', value: z.string(), ops: ['eq', 'in'] },
  created: { field: 'createdAt', value: z.string(), ops: ['gte', 'lt'] },
}, { maxDepth: 2, maxConditions: 10 })
```

`passwordHash` no está en `UserFilter`. Nadie, ni siquiera otro contexto, filtra cuentas
por él. `user.list` de auth recibe el filtro como `unknown` y lo valida él mismo, porque
no puede fiarse de lo que le dan:

```ts
// cooper/backend/contexts/auth/modules/user/user.module.ts
/** Every account, newest first, as the staff look them up: only what `UserFilter` allows. */
@UseCase()
async list(filter: unknown, page: PageRequest): Promise<Page<UserDTO>> {
  const criteria = filter === undefined ? {} : UserFilter.toCriteria<UserRow>(UserFilter.schema.parse(filter))
  const found = await this.repo.page(criteria, page, { newestFirst: true })
  return { items: found.items.map(user => user.contract()), hasMore: found.hasMore, total: found.total }
}
```

El backoffice convierte la única caja de texto de su pantalla en un filtro de auth: un
email **o** un nombre, entero, sin importar mayúsculas:

```ts
// cooper/backend/contexts/backoffice/modules/user/user.module.ts
/** Every account, the newest first, each saying whether it is staff; with a text, those whose email or name it is. */
@UseCase()
async list(input: UserSearchDTO, page: PageRequest): Promise<Page<UserSummaryDTO>> {
  const { text } = UserSearchSchema.parse(input)
  const filter: UserFilterDTO | undefined = text
    ? { or: [{ field: 'email', op: 'ieq', value: text }, { field: 'name', op: 'ieq', value: text }] }
    : undefined
  const users = await this.deps.user.list(filter, page)
  // One question to auth per account of the page: a page is short, and auth says it fresh.
  const items = await Promise.all(users.items.map(async user => ({ ...user, staff: await this.deps.staff.isStaff(user.id) })))
  return { ...users, items }
}
```

Del esquema de auth, el backoffice importa solo el tipo `UserFilterDTO`: el contrato,
nunca el código que guarda las cuentas.

## Cuidado con el rendimiento

Cada operador que ofreces es una consulta que cualquiera puede lanzar. Algunos cuestan
más de lo que parece:

- **Un `or` entre campos distintos** impide a la base de datos usar un índice: puede
  acabar leyendo todas las filas. `CardFilter` lo permite, pero con `maxDepth: 2` y
  `maxConditions: 10`.
- **`like '%texto%'`** tampoco puede usar un índice: lee el título y la descripción de
  todas las cards del espacio. Para las cards de un espacio está bien. Para las de todo
  cooper no lo estaría. Una búsqueda sobre millones de filas pide un índice de texto
  completo (el paso 3 de la regla de la portabilidad, marcado como tal) o un motor de
  búsqueda alimentado por workers.
- **Los índices siguen a los filtros que ofreces.** La migración de boards tiene un
  índice para cada forma en que `CardFilter` llega a las cards, siempre detrás del
  espacio de trabajo, que toda consulta lleva:

```sql
-- cooper/backend/contexts/boards/migrations/00001_boards_up.sql
CREATE UNIQUE INDEX card_number ON card (board_id, number);
CREATE INDEX card_column ON card (workspace_id, column_id, position);
CREATE INDEX card_assignee ON card (workspace_id, assignee_id);
```

Ofrece lo que tus datos pueden responder deprisa, con límites bajos, y amplíalos cuando
un caso real lo pida. Ampliar un contrato es fácil. Quitar un operador que los clientes
ya usan, no.

## En resumen

- Los criterios se agrupan con `and` y `or`. Son para el código del módulo.
- Un cliente filtra solo por lo que `defineFilter` permite: nombres públicos, operadores
  por campo, `maxDepth` y `maxConditions`. Lo demás es un 400.
- Las reglas del sistema van al lado del filtro del cliente (`allOf`, el ámbito del
  repositorio o un `where` propio), nunca dentro.
- Una búsqueda viaja en el cuerpo de un `POST`; su página, en la query string.
- Los criterios no tienen "contiene": la búsqueda de texto es una sola consulta de
  Kysely en el repositorio, con el espacio escrito a mano, los criterios dentro gracias
  a `criteriaTree`, `%`, `_` y `!` escapados con `escape '!'`, y la página y el total
  sacados de la misma consulta.
- Nunca pidas unos ids para devolverlos en un `in`: una consulta admite un número
  limitado de parámetros. Prueba un límite cruzándolo.
- Cada operador que ofreces es una consulta que cualquiera puede lanzar. Ofrece poco,
  ponle índice, amplía después.
