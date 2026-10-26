# Un puerto de búsqueda propio

La búsqueda del [capítulo 15](./15-kysely) es un `like` en la tabla de tarjetas. Lee
todas las tarjetas del espacio de trabajo, encuentra letras en lugar de palabras, y
pasa a minúsculas como lo hace cada base de datos: en SQLite, *ärger* no encuentra
*Ärger im Büro*. El índice de texto completo de una base de datos arreglaría parte de
eso, y ataría boards a esa base de datos.

La búsqueda de texto es un trabajo aparte. Los motores de búsqueda (Elasticsearch,
OpenSearch, Meilisearch, Typesense…) lo hacen bien: palabras y sus formas, la
capitalización de cualquier alfabeto, relevancia, millones de documentos. Ninguno es una
tabla, y ninguno responde a los criterios de newt como debe hacerlo un store.

Por eso los criterios de newt no tienen "contiene", y no lo tendrán. Los criterios son
lo que **todos** los stores responden igual: el store de ficheros, SQLite, Postgres y
MySQL dan las mismas filas para los mismos criterios, y `describeStoreContract`
comprueba que lo hacen. Un "contiene" sería o un `like` lento en cada store, o una
respuesta distinta en cada uno. La búsqueda de texto pertenece a un adaptador que se
especializa en ella, detrás de un puerto.

newt no tiene ningún puerto de búsqueda que darte, porque lo que encuentra una búsqueda
es de tu aplicación: cooper busca tarjetas por su título y su descripción, una tienda
busca productos por nombre y marca. Así que boards declara un puerto propio,
`CardSearch`, escribe su contrato como una suite de tests, y le da un adaptador en
memoria. Las tarjetas mantienen el índice al día a partir de sus eventos. Este capítulo
es ese puerto, de punta a punta, y lo que cambia cuando una búsqueda va un momento por
detrás de la tabla.

## El puerto

Un puerto es una interfaz que la aplicación declara, con sus propias palabras, para algo
que está fuera de ella: el `Mailer` del capítulo [12](./12-failures) es uno. La búsqueda
tiene una carpeta propia en boards, `search/`, junto a `modules/`: no es un módulo, no
tiene casos de uso, y allí vivirá más de un adaptador. Crea
`cooper/backend/contexts/boards/search/card-search.ts`:

```ts
// cooper/backend/contexts/boards/search/card-search.ts
import type { Criteria, Page, PageRequest } from 'newt/core'
import type { CardDTO } from '../modules/card/card.schema'

/** What a search asks: text its title or description has (whatever its case), and criteria on its fields. */
export type CardQuery = {
  text?: string
  criteria: Criteria<CardDTO>
}

/**
 * Where the cards are searched, as a port: an index of their text and fields beside
 * the table, kept by a worker as each card changes, so it is a moment behind. The
 * cards own the index: whatever happens to a card, they index it again or remove it.
 *
 * cooper keeps it in memory (`MemoryCardSearch`): one process, built again from the
 * table each time boards opens. Several processes, or more cards than memory holds,
 * need a search server (Elasticsearch, OpenSearch…): an adapter of this same port,
 * which passes `describeCardSearchContract`.
 */
export interface CardSearch {
  /** Keeps the card as it is now, in place of what it kept of it before. */
  index(card: CardDTO): Promise<void>
  /** Forgets a card: nothing happens if it never had it. */
  remove(id: string): Promise<void>
  /** Forgets every card of a workspace. */
  removeWorkspace(workspaceId: string): Promise<void>
  /** A page of the ids of the workspace's cards that match, by id, as `PageRequest` pages. */
  search(workspaceId: string, query: CardQuery, page: PageRequest): Promise<Page<string>>
}
```

Lo que dice el puerto, y lo que deja fuera:

- **Recibe `CardDTO`s**, enteros. El adaptador guarda lo que necesita de ellos.
- **Una búsqueda devuelve ids, no tarjetas.** El índice es una copia, que va un momento
  por detrás de la tabla (más abajo). La tabla es la verdad: el caso de uso lee de allí
  las tarjetas que encontró, tal como están ahora.
- **La consulta es texto más `Criteria<CardDTO>`.** El filtro del cliente se convierte
  en criterios en el caso de uso, como en el capítulo 15, y el adaptador recibe esos. No
  conoce `CardFilter`: tiene que responder a cualquier criterio sobre los campos de una
  tarjeta, grupos incluidos.
- **Pagina como toda lista**: por id, siendo el cursor el último id de la página
  anterior, con el total. Un cliente que pagina una búsqueda no puede saber qué
  adaptador responde.
- **El espacio de trabajo es un argumento aparte**, no un criterio: un adaptador no
  puede olvidarlo.

## Su contrato, como suite

Una interfaz dice los nombres y los tipos de los métodos. No dice qué debe encontrar
`search` para *ÄRGER*, ni qué hace `remove` con un id que nunca tuvo. Los stores de
newt tienen el mismo problema, y lo resuelven con una suite: `describeStoreContract`, de
`newt/port-store/contract`, es un conjunto de tests que cada store ejecuta contra sí
mismo. Un store nuevo está terminado cuando la suite pasa.

Haz lo mismo con tu puerto. Crea `search/card-search.contract.ts`:

```ts
// cooper/backend/contexts/boards/search/card-search.contract.ts
import { beforeEach, describe, expect, test } from 'bun:test'
import type { Criteria } from 'newt/core'
import type { CardDTO } from '../modules/card/card.schema'
import type { CardSearch } from './card-search'

/** A card as the search is handed it: these fields, and the rest as any card has them. */
function cardOf(fields: Partial<CardDTO> & Pick<CardDTO, 'title'>): CardDTO {
  return {
    id: Bun.randomUUIDv7(), workspaceId: 'acme', boardId: 'roadmap', columnId: 'todo', number: 1,
    description: '', assigneeId: null, position: 0, createdAt: '', updatedAt: '', ...fields,
  }
}

/** Checks an adapter of the cards' search keeps what `CardSearch` promises. */
export function describeCardSearchContract(name: string, open: () => CardSearch | Promise<CardSearch>): void {
  describe(`${name} keeps the CardSearch contract`, () => {
    let search: CardSearch

    beforeEach(async () => {
      search = await open()
    })

    const ids = async (text?: string, criteria: Criteria<CardDTO> = {}, workspaceId = 'acme') =>
      (await search.search(workspaceId, { text, criteria }, { size: 10 })).items

    test('finds cards by text in their title or description, whatever its case, by id', async () => {
      const plan = cardOf({ title: 'Write the plan', description: 'Dates and PEOPLE' })
      const party = cardOf({ title: 'Plan the party' })
      const umlaut = cardOf({ title: 'Ärger im Büro' })
      const percent = cardOf({ title: '100% done_ish' })
      for (const card of [plan, party, umlaut, percent]) await search.index(card)

      expect(await ids('PLAN')).toEqual([plan.id, party.id])
      expect(await ids('people')).toEqual([plan.id])
      expect(await ids('ärger IM')).toEqual([umlaut.id])
      // `%` and `_` are only themselves.
      expect(await ids('0%')).toEqual([percent.id])
      expect(await ids('_x')).toEqual([])
    })

    test('finds by criteria on the fields, alone or with text', async () => {
      const design = cardOf({ title: 'Design the logo', columnId: 'doing', assigneeId: 'bea' })
      const party = cardOf({ title: 'Plan the party', columnId: 'doing', number: 2 })
      const launch = cardOf({ title: 'Plan the launch', number: 3 })
      for (const card of [design, party, launch]) await search.index(card)

      expect(await ids('plan', { columnId: 'doing' })).toEqual([party.id])
      expect(await ids(undefined, { or: [{ assigneeId: 'bea' }, { number: 3 }] })).toEqual([design.id, launch.id])
      expect(await ids(undefined, { assigneeId: { in: ['bea', 'cy'] } })).toEqual([design.id])
    })

    test('finds a workspace\'s cards only', async () => {
      const ours = cardOf({ title: 'Plan' })
      await search.index(ours)
      await search.index(cardOf({ title: 'Plan', workspaceId: 'globex' }))

      expect(await ids('plan')).toEqual([ours.id])
    })

    test('keeps a card as it was indexed last, and forgets it when removed', async () => {
      const card = cardOf({ title: 'Plan' })
      await search.index(card)
      await search.index({ ...card, title: 'Design' })

      expect(await ids('plan')).toEqual([])
      expect(await ids('design')).toEqual([card.id])

      await search.remove(card.id)
      await search.remove(card.id)
      expect(await ids()).toEqual([])
    })

    test('forgets every card of a workspace, and only those', async () => {
      const theirs = cardOf({ title: 'Plan', workspaceId: 'globex' })
      await search.index(theirs)
      for (let i = 0; i < 3; i++) await search.index(cardOf({ title: 'Plan' }))

      await search.removeWorkspace('acme')

      expect(await ids()).toEqual([])
      expect(await ids(undefined, {}, 'globex')).toEqual([theirs.id])
    })

    test('pages by id: the cursor is the last id of the page before, the total is every match', async () => {
      const cards = Array.from({ length: 5 }, (_, i) => cardOf({ title: `Task ${i}` }))
      for (const card of cards.toReversed()) await search.index(card)

      const first = await search.search('acme', { text: 'task', criteria: {} }, { size: 2 })
      expect(first).toMatchObject({ items: [cards[0]!.id, cards[1]!.id], hasMore: true, total: 5 })
      const last = await search.search('acme', { text: 'task', criteria: {} }, { size: 2, cursor: cards[3]!.id })
      expect(last).toMatchObject({ items: [cards[4]!.id], hasMore: false, total: 5 })
    })
  })
}
```

Es una función, no un fichero de tests: su nombre acaba en `.contract.ts`, así que
`bun test` no la ejecuta por sí sola. El test de cada adaptador la llama con un nombre y
una forma de abrir un adaptador nuevo, y `beforeEach` abre uno por test. Lo que fija:

- **Texto**: en el título o en la descripción, con cualquier capitalización, también las
  letras más allá de la A a la Z (*ärger IM* encuentra *Ärger im Büro*, lo que el `like`
  de SQLite no podía), `%` y `_` como ellos mismos.
- **Criterios**: solos o con texto, grupos `or`, `in`.
- **Espacios de trabajo**: una búsqueda ve uno.
- **Escrituras**: `index` reemplaza lo que guardaba de una tarjeta; `remove` la olvida,
  y dos veces es igual que una; `removeWorkspace` olvida las tarjetas de un espacio de
  trabajo y de ningún otro.
- **Páginas**: por id, en el orden en que se indexaron las tarjetas, con el total
  contando todas las coincidencias.

La suite es la definición real del puerto. Es también como comparas adaptadores: si un
servidor de búsqueda encuentra *planet* para *plan* y la suite dice que debe, todos los
adaptadores deben.

## En memoria: `MemoryCardSearch`

El primer adaptador guarda todas las tarjetas en un mapa, y las mira todas en cada
búsqueda. Crea `search/memory-card-search.ts`:

```ts
// cooper/backend/contexts/boards/search/memory-card-search.ts
import { matches, toPage, type Page, type PageRequest } from 'newt/core'
import type { CardDTO } from '../modules/card/card.schema'
import type { CardQuery, CardSearch } from './card-search'

/**
 * The cards' search in memory: every card in a map, each search a look at all of them.
 * Enough for one process; what it keeps is lost when the process ends, so boards
 * indexes every card again when it opens.
 */
export class MemoryCardSearch implements CardSearch {

  private readonly cards = new Map<string, CardDTO>()

  async index(card: CardDTO): Promise<void> {
    this.cards.set(card.id, card)
  }

  async remove(id: string): Promise<void> {
    this.cards.delete(id)
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    for (const card of this.cards.values()) if (card.workspaceId === workspaceId) this.cards.delete(card.id)
  }

  async search(workspaceId: string, { text, criteria }: CardQuery, page: PageRequest): Promise<Page<string>> {
    const wanted = text?.toLowerCase()
    const has = (card: CardDTO) => !wanted || card.title.toLowerCase().includes(wanted) || card.description.toLowerCase().includes(wanted)
    const ids = [...this.cards.values()]
      .filter(card => card.workspaceId === workspaceId && matches(card, criteria) && has(card))
      .map(card => card.id)
      .sort()
    const after = page.cursor === undefined ? ids : ids.filter(id => id > page.cursor!)
    return toPage(after.slice(0, page.size + 1), page.size, ids.length)
  }
}
```

Dos piezas de newt hacen casi todo:

- **`matches(row, criteria)`**, de `newt/core`, dice si una fila cumple unos criterios:
  cada operador y grupo, respondido como lo haría SQL (una comparación con `null` no se
  cumple para nada; `ieq` pasa a minúsculas solo de la A a la Z). Es lo que usa el store
  de ficheros para comprobar las filas una a una, y está ahí para cualquier adaptador
  tuyo que compruebe filas en memoria.
- **`toPage(rows, size, total)`**, como en el capítulo 15: toma una fila más que la
  página, la descarta, y dice `hasMore`.

El texto es el `toLowerCase` e `includes` de JavaScript: la capitalización de cada letra
se iguala, y `%` es un carácter como cualquier otro. Buscar es lineal en el número de
tarjetas, y los ids se ordenan en cada búsqueda. Para las tarjetas de un proceso está
bien; no es un motor de búsqueda.

Su test es una línea, la suite:

```ts
// cooper/backend/contexts/boards/search/memory-card-search.test.ts
import { describeCardSearchContract } from './card-search.contract'
import { MemoryCardSearch } from './memory-card-search'

describeCardSearchContract('MemoryCardSearch', () => new MemoryCardSearch())
```

## Las tarjetas reciben la búsqueda

El módulo de tarjetas se configura con la búsqueda, como con el mailer. En
`card-options.ts`, añádela:

```ts
// cooper/backend/contexts/boards/modules/card/card-options.ts
import type { Mailer } from '../../../../shared/mail/mailer'
import type { CardSearch } from '../../search/card-search'

/** What the context configures the cards with. */
export type Card_Options = {
  /** What tells an assignee: the console in development, a list in a test. */
  mailer: Mailer
  /** Where people open boards: the links of its emails start there. */
  publicUrl: string
  /** Where the cards are searched: an index the cards keep as each one changes. */
  search: CardSearch
}
```

El contexto la recibe de quien lo abre, junto con sus otras dependencias. En
`initialize-modules.ts`, importa el tipo del puerto:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import { Workspace_Module } from './modules/workspace/workspace.module'
import type { CardSearch } from './search/card-search'
```

añádela a `Boards_ModuleDeps`, y dilo en su comentario:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
/**
 * What `boards`' modules are given besides its base: what they need of auth, as ports
 * of their own (who belongs to each workspace, and auth's events about workspaces and
 * access), a mailer, and where the cards are searched. Whoever opens the context wires
 * them.
 */
export type Boards_ModuleDeps = {
  workspaces: Workspaces
  tenants: TenantEvents
  access: AccessEvents
  mailer: Mailer
  search: CardSearch
```

y pásasela a las tarjetas:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
  const card = Card_Module.initialize(base, { board, column, member, access: deps.access }, { mailer: deps.mailer, publicUrl: config.publicUrl, search: deps.search })
```

En `index.ts`, el backend abre boards con un `MemoryCardSearch`:

```ts
// cooper/backend/index.ts
import { Boards_Context } from './contexts/boards/boards.context'
import { MemoryCardSearch } from './contexts/boards/search/memory-card-search'
```

```ts
// cooper/backend/index.ts
  mailer: new ConsoleMailer(config.mail.from),
  search: new MemoryCardSearch(),
  log: line => console.log(line),
```

Los tests también abren boards con una, y la tienen a mano como `t.search`, para mirar
el índice directamente. Reciben además `writeCards`, que escribe filas de tarjetas
directamente en la tabla, saltándose cada caso de uso y sus eventos: un test de muchísimas
tarjetas, o de un índice que las perdió. Sustituye `testing/open-test-boards.ts`:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
import { runAsActor } from 'newt/core'
import { config } from '../../../config'
import type { ActorVia } from '../../../shared/actor'
import type { Mail } from '../../../shared/mail/mailer'
import type { BoardsBase } from '../boards-base'
import { Boards_Context } from '../boards.context'
import type { CardRow } from '../modules/card/card.repository'
import { MemoryCardSearch } from '../search/memory-card-search'
import { inWorkspace } from '../workspace-scope'
import { FakeAuth } from './fake-auth'

/**
 * `boards` for a test: its database and its cards' search in memory, a fake auth behind
 * its ports, its emails and its log's lines in lists, and who sends a request told by an
 * `x-user` header.
 */
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const mails: Mail[] = []
  const lines: string[] = []
  const search = new MemoryCardSearch()
  const boards = await Boards_Context.open({ ...config.boards, database: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
    tenants: auth.tenants,
    access: auth.access,
    mailer: { send: async mail => { mails.push(mail) } },
    search,
    log: line => { lines.push(line) },
  })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId, via: 'web' as const } : null
  })
  return {
    auth,
    boards,
    modules: boards.modules,
    mails,
    lines,
    search,
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` does. */
    as<T>(userId: string, workspaceId: string, fn: () => Promise<T>, via: ActorVia = 'web'): Promise<T> {
      return runAsActor({ userId, via }, () => inWorkspace(boards.modules.member, workspaceId, fn))
    },
    /** Cards written as rows, past what any use case would let in and its events: for a test of very many. */
    async writeCards(rows: CardRow[]): Promise<void> {
      const { store, db } = boards.base as BoardsBase
      await store.transaction(async () => {
        for (let i = 0; i < rows.length; i += 500) await db.insertInto('card').values(rows.slice(i, i + 500)).execute()
      })
    },
    /** Until the background work is done: auth's events heard, and what they made boards tell. */
    async settled(): Promise<void> {
      await auth.idle()
      await boards.base.jobs.idle()
    },
    async close(): Promise<void> {
      await boards.stop()
      await auth.close()
    },
  }
}

export type TestBoards = Awaited<ReturnType<typeof openTestBoards>>
```

`writeCards` usa el Kysely del capítulo 15 para insertar, dentro de
`store.transaction`, como debe hacerse una escritura, de 500 filas en 500.

## La búsqueda, a través del puerto

En `card.module.ts`, el primer import recibe `allPages`, y el ámbito del espacio de
trabajo da también `currentWorkspaceId`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
import { allPages, currentActor, eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId, runInWorkspace } from '../../workspace-scope'
```

Sustituye `search`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * A page of the workspace's cards that have the text and pass the filter: only the
   * fields and operators `CardFilter` allows. The search finds their ids, a moment
   * behind; the cards are read as they are now, and one gone since is left out.
   */
  @UseCase()
  async search(input: CardSearchDTO, page: PageRequest): Promise<Page<CardDTO>> {
    const { text, filter } = CardSearchSchema.parse(input)
    const criteria = filter ? CardFilter.toCriteria<CardDTO>(filter) : {}
    const found = await this.options.search.search(currentWorkspaceId(), { text, criteria }, page)
    const cards = new Map((await this.repo.find({ id: { in: found.items } })).map(card => [card.id, card]))
    // The next page starts after the last id the search found, whether or not its card is still there.
    return mapPage({ ...found, nextCursor: found.items.at(-1) }, id => cards.get(id)?.toDTO())
  }
```

El filtro se parsea y se comprueba como antes; lo que llega al puerto son criterios, y
el espacio de trabajo en que está la petición. El puerto responde ids; un `find` lee
esas tarjetas de la tabla, a través del repositorio y su ámbito.

El capítulo 15 dijo que nunca se traigan ids para devolverlos en un `in`. Esa regla es
sobre una lista de ids que crece con los datos. Aquí la lista es una página, de 100 ids
como mucho (`pageRequestFrom` mantiene `size` entre 1 y 100): no crece.

`mapPage` convierte cada id en el DTO de la tarjeta, en el orden en que lo dio la
búsqueda, y deja fuera los que convierte en `undefined`: una tarjeta borrada después de
que el índice la viera por última vez. Entonces la página puede quedarse una tarjeta
corta; su `total` es el del índice. La página siguiente tiene que empezar después del
último id que encontró la **búsqueda**, no después de la última tarjeta conservada, así
que `nextCursor` se dice explícitamente: `mapPage` mantiene un cursor que se le da, y lo
quita en la última página.

## Mantener el índice: un worker en cada cambio

El índice es una copia de las tarjetas. Algo tiene que actualizarlo cada vez que una
tarjeta cambia, y ese algo son las propias tarjetas, reaccionando a sus propios
eventos. Añade un caso de uso después de `countByBoard`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * The search finds a card as it is now: read again, it is indexed, or removed if it
   * is gone. What a worker calls on every change of a card, in any order, as many
   * times as it takes: each run indexes what is there then.
   */
  @UseCase()
  async indexCard(workspaceId: string, id: string): Promise<void> {
    const card = await runInWorkspace(workspaceId, () => this.repo.first({ id }))
    if (card) await this.options.search.index(card.toDTO())
    else await this.options.search.remove(id)
  }
```

y suscríbelo a cada evento de una tarjeta, en `card.workers.ts`, después de las
notificaciones:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
  // The search finds each card as it is now: whatever happened to it, it is indexed again, or removed.
  cards.events.created.subscribe(card => cards.indexCard(card.workspaceId, card.id), { strategy: 'handler', queue: 'card.indexCard.on.card.created' })
  cards.events.edited.subscribe(({ dto }) => cards.indexCard(dto.workspaceId, dto.id), { strategy: 'handler', queue: 'card.indexCard.on.card.edited' })
  cards.events.moved.subscribe(({ dto }) => cards.indexCard(dto.workspaceId, dto.id), { strategy: 'handler', queue: 'card.indexCard.on.card.moved' })
  cards.events.assigned.subscribe(({ dto }) => cards.indexCard(dto.workspaceId, dto.id), { strategy: 'handler', queue: 'card.indexCard.on.card.assigned' })
  cards.events.unassigned.subscribe(({ dto }) => cards.indexCard(dto.workspaceId, dto.id), { strategy: 'handler', queue: 'card.indexCard.on.card.unassigned' })
  cards.events.deleted.subscribe(card => cards.indexCard(card.workspaceId, card.id), { strategy: 'handler', queue: 'card.indexCard.on.card.deleted' })
```

Cada uno es un `'handler'` (capítulo [11](./11-reacting)): un job guardado en la misma
transacción que el cambio, ejecutado por el worker hasta que lo consigue. No
`'fire-and-forget'`: un cambio perdido por el camino dejaría la tarjeta mal en la
búsqueda hasta que boards se abra otra vez. Cada cola se nombra por lo que llama y lo
que escucha, como pide el lint.

**Por qué leer la tarjeta otra vez**, en lugar de indexar lo que lleva el evento. Todo
evento lleva dentro el DTO de la tarjeta; indexar eso ahorraría una lectura. Pero los
jobs no se ejecutan en el orden en que ocurrieron los cambios:

- Cada suscripción es una cola propia, y el worker ejecuta hasta diez jobs a la vez, de
  cualquier cola.
- Un job que falla se reintenta más tarde, con espera creciente (capítulo
  [12](./12-failures)), mientras se ejecutan los jobs que vienen detrás.

Así que el job de un `edited` puede ejecutarse después del job del `moved` que vino más
tarde, o después de que se borrara la tarjeta. Indexar el DTO del evento devolvería un
título viejo, o una tarjeta que ya no existe. Leer la tarjeta otra vez hace que cada
ejecución indexe lo que hay en la tabla **entonces**, o la quite si ya no está, sea cual
sea el evento que la despertó. El orden deja de importar, y también ejecutarlo dos
veces: eso es lo que hace seguro reintentar. La misma idea que los pasos del capítulo
[14](./14-sagas): cada ejecución converge en lo que hay.

(Dos jobs de la misma tarjeta que se ejecuten en el mismo instante todavía pueden
cruzarse: uno lee, el otro lee y escribe, el primero escribe lo que leyó. El siguiente
cambio de la tarjeta lo arregla, y también el siguiente arranque. Un adaptador que
pueda rechazar una escritura más antigua, como un servidor de búsqueda que toma una
versión con cada documento, cerraría incluso eso; `CardSearch` no lo pide.)

`purgeWorkspace` quita las tarjetas de un espacio de trabajo borrado como filas, todas a
la vez, y eso no avisa de ningún evento por tarjeta (capítulo 14). Así que las olvida
en la búsqueda él mismo:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /** A workspace was deleted in auth: its cards go, and the search forgets them. A step of that deletion, safe to run again. */
  @UseCase()
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.repo.purgeWorkspace(workspaceId)
    await this.options.search.removeWorkspace(workspaceId)
  }
```

Los dos pasos son seguros de ejecutar otra vez: una segunda ejecución no encuentra nada
que quitar en ninguno.

## Indexar todas las tarjetas al abrir boards

Un `MemoryCardSearch` empieza vacío. Cada vez que boards se abre, todas las tarjetas
tienen que estar indexadas antes de que nadie busque. Eso es una lectura de todas las
tarjetas de todos los espacios de trabajo, por páginas.

En `card.repository.ts`, la consulta LIKE se va. Los imports pierden `Criteria` y el
`sql` de Kysely:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
import { toPage, type Page, type PageRequest } from 'newt/core'
import { whereOf } from 'newt/kysely'
import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
```

y en lugar de `search`, una página de las tarjetas de todos los espacios de trabajo:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
  /**
   * A page of the cards of every workspace, by id: for indexing them all again, never
   * for a workspace's own work.
   */
  async pageInEveryScope(page: PageRequest): Promise<Page<Card>> {
    const after = page.cursor === undefined ? {} : { id: { gt: page.cursor } }
    const [cards, total] = await Promise.all([this.findInEveryScope(after, { limit: page.size + 1 }), this.table.count({})])
    return toPage(cards, page.size, total)
  }
```

Cruza espacios de trabajo a propósito, a través de `findInEveryScope` (capítulo
[4](./04-who-and-where)), tras un nombre que lo dice. `find` ordena por id salvo que se
le diga otra cosa, así que el cursor es el último id de la página anterior, como en toda
lista. `whereOf` se queda, en `countByWorkspace`.

`boards-base.ts` ya no menciona la búsqueda en su comentario:

```ts
// cooper/backend/contexts/boards/boards-base.ts
/**
 * What every module of `boards` receives: cooper's base, and Kysely on its store, for
 * the queries a table cannot say (cards counted by workspace and by board). Kysely
 * needs a SQL store: `boards` opens on SQLite, and would open on Postgres or MySQL the
 * same way, never on files.
 */
```

En `card.module.ts`, después de `indexCard`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * Every card of every workspace indexed again: what boards does when it opens, since
   * a search in memory starts empty. Read a page at a time, all of them kept, as the
   * search keeps them too.
   */
  @UseCase()
  async reindex(): Promise<void> {
    const cards = await allPages(page => this.repo.pageInEveryScope(page))
    for (const card of cards) await this.options.search.index(card.toDTO())
  }
```

**`allPages(read)`**, de `newt/core`, lee una lista paginada entera: pide páginas de
100, cada una empezando tras el último elemento de la anterior (o donde diga el
`nextCursor` de la página), hasta que `hasMore` es falso. Su propio comentario dice que
es para listas que nunca son largas. Todas las tarjetas de boards no son una lista así,
y `reindex` la usa igualmente, a sabiendas: la búsqueda en memoria guarda todas las
tarjetas en memoria, así que tenerlas todas un momento no cuesta más que el propio
índice. Un adaptador sobre un servidor de búsqueda no reindexaría en cada arranque, e
indexaría página a página si alguna vez lo hiciera.

El contexto la llama al abrirse, en `boards.context.ts`:

```ts
// cooper/backend/contexts/boards/boards.context.ts
    const modules = initializeModules(base, config, deps)
    // The cards' search starts empty in memory: every card is indexed before anyone searches.
    await modules.card.reindex()
    return new Boards_Context(base, modules, config)
```

`open` solo devuelve cuando el índice está lleno, así que el servidor todavía no está
sirviendo.

## Un momento por detrás

El índice es ahora una **proyección**: una copia de las tarjetas, con la forma de un
tipo de pregunta, mantenida al día reaccionando a lo que pasa. Las proyecciones son
consistentes a la larga. Justo después de que ana cree una tarjeta, puede que el job que
la indexa no se haya ejecutado; una búsqueda en ese momento no la encuentra. Un momento
después, sí. Lo mismo tras una edición (el título viejo todavía coincide un momento) y
tras un borrado (el caso de uso ya deja fuera la tarjeta, porque la tabla ya no la
tiene, pero el total todavía la cuenta).

Para una búsqueda eso está bien: nadie espera que una tarjeta aparezca en una búsqueda
en el mismo milisegundo en que la crea. No está bien para todo. Una regla que debe
cumplirse (el nombre de un tablero, tomado una vez; las diez tarjetas de una columna)
lee la tabla, nunca una proyección.

En los tests el worker no está en marcha: los jobs se ejecutan cuando un test los espera,
con `t.settled()` (capítulo [11](./11-reacting)). Así que un test crea tarjetas, espera
a que se asienten, y luego busca. Sin `settled()`, la búsqueda no encuentra nada, cada
vez. No es algo que haya que sortear; es lo que comprueban los tests de abajo.

## Tests

En `card.test.ts`, los dos tests de búsqueda del capítulo 15 ahora esperan al índice. En
el primero, después de sus cuatro tarjetas:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
    await create('100% done_ish')
    // The search is a moment behind: each card is indexed by a worker.
    await t.settled()
```

y en el segundo:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
    await create('Ärger im Büro')
    await t.settled()
```

Después de él, dos tests nuevos. Uno sigue una tarjeta a través de una creación, una
edición y un borrado, buscando antes y después de que el índice se ponga al día. El otro
escribe 1.001 tarjetas como filas, a espaldas de los eventos, como las encontraría un
índice que las perdió, y las indexa todas otra vez:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('finds a card as it is now, a moment after each change, and none once deleted', async () => {
    const card = await create('Plan')
    const search = (text: string) => inAcme(() => t.modules.card.search({ text }, { size: 10 })).then(page => page.items.map(each => each.title))
    expect(await search('plan')).toEqual([])
    await t.settled()
    expect(await search('plan')).toEqual(['Plan'])

    await inAcme(() => t.modules.card.edit(card.id, { title: 'Design' }))
    await t.settled()
    expect(await search('plan')).toEqual([])
    expect(await search('design')).toEqual(['Design'])

    await inAcme(() => t.modules.card.delete(card.id))
    expect(await search('design')).toEqual([])
    await t.settled()
    expect(await t.search.search('acme', { criteria: {} }, { size: 10 })).toMatchObject({ items: [], total: 0 })
  })

  test('indexes again every card of every workspace, page by page, those written past its events too', async () => {
    // Written as rows, as a search that lost its index finds them: 1,001 cards of three boards.
    const now = new Date().toISOString()
    const rows = Array.from({ length: 1_001 }, (_, i) => ({
      id: Bun.randomUUIDv7(), workspaceId: i < 1_000 ? 'acme' : 'globex', boardId: `board-${Math.floor(i / 500)}`, columnId: todo, number: i % 500 + 1,
      title: `Task ${i}`, description: '', assigneeId: i % 2 === 0 ? 'bea' : null, position: i % 500, createdAt: now, updatedAt: now, version: 1,
    }))
    await t.writeCards(rows)
    const search = (input: object, cursor?: string) => inAcme(() => t.modules.card.search(input, { size: 2, cursor }))
    expect(await search({ text: 'task' })).toMatchObject({ total: 0 })

    await t.modules.card.reindex()

    const first = await search({ text: 'TASK' })
    expect(first).toMatchObject({ hasMore: true, total: 1_000 })
    expect(first.items.map(card => card.title)).toEqual(['Task 0', 'Task 1'])
    expect((await search({ text: 'task' }, first.nextCursor)).items.map(card => card.title)).toEqual(['Task 2', 'Task 3'])
    expect(await search({ text: 'task', filter: { field: 'assignee', op: 'eq', value: 'bea' } })).toMatchObject({ total: 500 })
    expect(await t.as('carl', 'globex', () => t.modules.card.search({ text: 'task' }, { size: 2 }))).toMatchObject({ items: [{ title: 'Task 1000' }], total: 1 })
  })
```

Fíjate en el borrado del primero: justo después, el caso de uso ya no encuentra nada,
porque lee las tarjetas de la tabla; solo cuando todo se ha asentado olvida el propio
índice la tarjeta, lo que muestra `t.search`. 1.001 tarjetas son más de diez páginas de
`allPages`, así que el segundo test cruza límites de página, y la tarjeta de globex
muestra que el reindexado cubre todos los espacios de trabajo.

En `boards.context.test.ts`, la búsqueda por HTTP espera a asentarse tras crear sus
tarjetas:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
    for (const title of ['Plan the launch', 'Design', 'Plan the party']) await call('POST', `/acme/boards/${id}/cards`, { columnId: todo, title })
    await t.settled()
```

Y en `workspace.test.ts`, *removes all a workspace has once auth deletes it* comprueba que
la búsqueda olvida las tarjetas del espacio de trabajo borrado, y solo esas. Cada
espacio de trabajo tiene su tarjeta de bienvenida:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
    await t.auth.createWorkspace('acme', 'ana')
    await t.auth.createWorkspace('globex', 'bea')
    await t.settled()
    const indexed = (workspaceId: string) => t.search.search(workspaceId, { criteria: {} }, { size: 10 }).then(page => page.total)
    expect([await indexed('acme'), await indexed('globex')]).toEqual([1, 1])

    await t.auth.deleteWorkspace('acme')
    await t.settled()
    // The search forgets its cards too.
    expect([await indexed('acme'), await indexed('globex')]).toEqual([0, 1])
```

## El límite de la memoria: un proceso

`MemoryCardSearch` basta para cooper tal como corre hoy: un proceso. Deja de bastar en
cuanto hay dos.

Ejecuta dos procesos de boards detrás de un balanceador de carga, sobre una base de
datos. Cada uno tiene su propio mapa. El job `indexCard` de una tarjeta es una fila en
el outbox; un worker lo reclama, en uno de los dos procesos, y solo el mapa de ese
proceso recibe la tarjeta. Una búsqueda respondida por el otro no la encuentra, hasta
que ese proceso se reinicie. Y cada proceso guarda todas las tarjetas de todos los
espacios de trabajo en su memoria, y las lee todas cada vez que arranca.

Nada de esto es un fallo del adaptador: es lo que significa "en memoria". El arreglo no
está en las tarjetas, ni en el puerto. Es otro adaptador.

## Un servidor de búsqueda: lo que haría un adaptador de Elasticsearch

cooper no trae ninguno. Esto es lo que sería, para mostrar que el puerto aguanta. Un
`ElasticCardSearch implements CardSearch` viviría en `search/` junto al de memoria, y
estaría terminado cuando `describeCardSearchContract('ElasticCardSearch', …)` pase.

- **El índice.** Un índice de Elasticsearch de tarjetas, cada documento por el id de la
  tarjeta, con `workspaceId`, `boardId`, `columnId`, `assigneeId` e `id` como campos
  `keyword`, `number` como `integer`, y `title` y `description` como texto.
- **`index(card)`** pone el documento por su id, reemplazando lo que había: eso ya es lo
  que pide el contrato. **`remove(id)`** lo borra, y toma un "no encontrado" como hecho,
  ya que quitar dos veces es igual que una. **`removeWorkspace`** es un borrado por
  consulta sobre el término `workspaceId`.
- **`search`** es una consulta `bool`. Su `filter` toma siempre el espacio de trabajo
  como un término, y los criterios traducidos: `criteriaTree(criteria)` de newt, de
  `newt/core`, los convierte en un árbol de `all`, `any` y condiciones sobre un campo,
  que se corresponde con consultas `bool` (`all` a `filter`, `any` a `should` con al
  menos uno que cumplir, `eq` a un `term`, `in` a `terms`, `gt`… a un `range`, `ne` y un
  `null` a `must_not`). La traducción debe responder como lo hace `matches`; los tests
  de criterios del contrato lo detectan si no.
- **El texto**, como lo tiene el contrato, es "contiene, sea cual sea la
  capitalización": una consulta `wildcard`, sin distinguir mayúsculas, sobre una copia
  `keyword` del título y la descripción, con los `*`, `?` y `\` del propio texto con
  escape; o un campo de n-gramas, que responde lo mismo mucho más rápido. Un normalizador
  a minúsculas pasa la *Ä* a minúsculas como lo hace JavaScript, que es el test de la
  capitalización.
- **Páginas**: ordenadas por `id`, el cursor pasado como `search_after`, un documento
  más que la página para saber `hasMore`, y `track_total_hits` para un `total` exacto.
- **Frescura**: un servidor de búsqueda muestra una escritura un momento después (su
  refresco). El índice ya va un momento por detrás, así que en producción no cambia
  nada; en el contrato, que escribe y luego lee de inmediato, el adaptador escribe con
  `refresh: 'wait_for'`, o su fixture refresca antes de cada lectura.
- **El fixture** abre un índice nuevo con un nombre aleatorio para cada test, y el test
  del adaptador se salta salvo que una variable de entorno dé la dirección de un
  servidor, como hace el capítulo [27](./27-postgres) con Postgres.

Lo que cambiaría fuera de `search/`: una línea en `index.ts`, el adaptador que se da a
boards en lugar de `MemoryCardSearch`; y `boards.context.ts` no haría `reindex` en cada
arranque, ya que el servidor guarda su índice. Las tarjetas, sus workers, el caso de uso
y la ruta no cambian.

Y aquello en lo que es bueno el servidor, las palabras y sus formas, la relevancia, la
tolerancia a erratas, hoy no está en el contrato: los resultados vienen por id, y *plan*
encuentra *planet*. Pedir más es un cambio en `CardSearch` y su suite, hecho a
propósito, al que el adaptador de memoria tendría que ponerse al día o renunciar.

## Compruébalo

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint
```

`bun test cooper` ahora ejecuta la suite del contrato una vez, como *MemoryCardSearch
keeps the CardSearch contract*.

Luego a mano, sobre un fichero de base de datos. Arranca el backend (`bun
cooper/backend/index.ts`), crea una tarjeta, y búscala:

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
BOARD=$(curl -s -X POST $API/boards -H "$H" -H 'x-user: ana' -d "{\"name\":\"Launch $RANDOM\"}" | jq -r .id)
COLUMN=$(curl -s -X POST $API/boards/$BOARD/columns -H "$H" -H 'x-user: ana' -d '{"name":"To do"}' | jq -r .id)
curl -s -X POST $API/boards/$BOARD/cards -H "$H" -H 'x-user: ana' -d "{\"columnId\":\"$COLUMN\",\"title\":\"Plan the launch\"}" > /dev/null
curl -s -X POST $API/cards/search -H "$H" -H 'x-user: ana' -d '{"text":"plan"}' | jq -c '{ titles: [.items[].title], total }'
```

```text
{"titles":["Plan the launch"],"total":1}
```

El worker del servidor ejecuta el job en cuanto se guarda la tarjeta, así que lo normal
es que ya la encuentre; si no, es un momento después. Luego para el servidor (Ctrl-C),
arráncalo otra vez, y envía la misma búsqueda:

```text
{"titles":["Plan the launch"],"total":1}
```

El mapa estaba vacío cuando arrancó el proceso; boards indexó todas las tarjetas al
abrirse. (Tu total cuenta las otras tarjetas con *plan* que hiciste en capítulos
anteriores.)

## Qué recordar

- La búsqueda de texto no es trabajo de una tabla, y los criterios de newt no tienen
  "contiene": los criterios son lo que todos los stores responden igual. Pon la
  búsqueda de texto detrás de un puerto propio, para un adaptador que se especialice en
  ella.
- Escribe el contrato del puerto como una suite (`describeCardSearchContract`), como
  hace newt para los stores con `describeStoreContract`. Un adaptador está terminado
  cuando la suite pasa.
- El índice es una proyección: lo mantienen workers `'handler'` en cada evento de una
  tarjeta, cada uno releyendo la tarjeta e indexando lo que hay o quitándola. Los jobs
  se ejecutan desordenados y se repiten; releer hace inofensivas ambas cosas.
- Una proyección va un momento por detrás. La búsqueda da ids; el caso de uso lee las
  tarjetas de la tabla. Los tests esperan con `settled()`. Las reglas que deben cumplirse
  nunca leen una proyección.
- En memoria significa un proceso: se reconstruye al abrir boards (`allPages` sobre
  `pageInEveryScope`), y falla en cuanto hay dos. Un servidor de búsqueda es otro
  adaptador del mismo puerto.

Siguiente: [Un segundo contexto: auth](./17-auth).
