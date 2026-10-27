# A search port of your own

The search of [chapter 15](./15-kysely) is a `like` in the card table. It reads every
card of the workspace, finds letters rather than words, and folds case as each
database does: on SQLite, *ärger* does not find *Ärger im Büro*. A database's own
full-text index would fix some of that, and tie boards to that database.

Text search is a job of its own. Search engines (Elasticsearch, OpenSearch, Meilisearch,
Typesense…) do it well: words and their forms, any alphabet's case, relevance, millions
of documents. None of them is a table, and none of them answers newt's criteria the way
a store must.

This is why newt's criteria have no "contains", and will not get one. Criteria are what
**every** store answers alike: the files store, SQLite, Postgres and MySQL give the same
rows for the same criteria, and `describeStoreContract` checks that they do. A
"contains" would be either a slow `like` on every store, or a different answer on each.
Text search belongs to an adapter that specializes in it, behind a port.

newt has no search port to give you, because what a search finds is your
application's: cooper searches cards by their title and description, a shop searches
products by name and brand. So boards declares a port of its own, `CardSearch`, writes
its contract as a suite of tests, and gives it an adapter in memory. The cards keep the
index up to date from their events. This chapter is that port, from end to end, and
what changes when a search is a moment behind the table.

## The port

A port is an interface the application declares, in its own words, for something
outside it: the `Mailer` of chapter [12](./12-failures) is one. The search gets a folder
of its own in boards, `search/`, beside `modules/`: it is not a module, it has no use
cases, and more than one adapter will live there. Create
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
  /**
   * Keeps the card as it is now, in place of what it kept of it before, unless that
   * is newer (a later `updatedAt`): two jobs indexing one card at once may hand it
   * an older copy last.
   */
  index(card: CardDTO): Promise<void>
  /**
   * Forgets a card for good: nothing happens if it never had it, and a copy of it
   * indexed afterwards is not kept if it is older than the removal, as a job that read
   * the card before it was deleted may hand it over after.
   */
  remove(id: string): Promise<void>
  /** Forgets every card of a workspace. */
  removeWorkspace(workspaceId: string): Promise<void>
  /** A page of the ids of the workspace's cards that match, by id, as `PageRequest` pages. */
  search(workspaceId: string, query: CardQuery, page: PageRequest): Promise<Page<string>>
}
```

What the port says, and what it leaves out:

- **It is handed `CardDTO`s**, whole. The adapter keeps what it needs of them.
- **A search gives back ids, not cards.** The index is a copy, kept a moment behind the
  table (below). The table is the truth: the use case reads the cards it found from
  there, as they are now.
- **The query is text plus `Criteria<CardDTO>`.** The client's filter becomes criteria
  in the use case, as in chapter 15, and the adapter receives those. It does not know
  `CardFilter`: it must answer any criteria on a card's fields, groups included.
- **It pages as every list does**: by id, the cursor being the last id of the page
  before, with the total. A client that pages through a search cannot tell which
  adapter answers.
- **The workspace is an argument of its own**, not a criterion: an adapter cannot
  forget it.
- **`index` keeps the newer copy.** Handed a card older than the one it keeps (an
  earlier `updatedAt`), it keeps what it has. Why an adapter must, comes with the
  worker that keeps the index, below.
- **`remove` is for good.** A copy of the card handed over after the removal, older
  than it, is not kept: the card does not come back to the search.

## Its contract, as a suite

An interface says the methods' names and types. It does not say what `search` must
find for *ÄRGER*, or what `remove` does with an id it never had. newt's stores have the
same problem, and solve it with a suite: `describeStoreContract`, from
`newt/port-store/contract`, is a set of tests every store runs against itself. A new
store is done when the suite passes.

Do the same for your port. Create `search/card-search.contract.ts`:

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

    test('keeps the newer of two copies of a card, whichever is indexed last', async () => {
      const card = cardOf({ title: 'Plan', updatedAt: '2026-01-01T10:00:00.000Z' })
      const edited = { ...card, title: 'Design', updatedAt: '2026-01-01T10:00:01.000Z' }
      await search.index(edited)
      await search.index(card)

      expect(await ids('plan')).toEqual([])
      expect(await ids('design')).toEqual([card.id])
    })

    test('keeps a removed card out when a copy from before its removal comes late', async () => {
      const card = cardOf({ title: 'Plan', updatedAt: new Date(Date.now() - 1000).toISOString() })
      await search.index(card)
      await search.remove(card.id)
      await search.index(card)

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

It is a function, not a test file: its name ends in `.contract.ts`, so `bun test` does
not run it alone. Each adapter's test calls it with a name and a way to open a fresh
adapter, and `beforeEach` opens one per test. What it pins down:

- **Text**: in the title or the description, any case, letters beyond A to Z too
  (*ärger IM* finds *Ärger im Büro*, which SQLite's `like` could not), `%` and `_` as
  themselves.
- **Criteria**: alone or with text, `or` groups, `in`.
- **Workspaces**: a search sees one.
- **Writes**: `index` replaces what it kept of a card, unless what it kept is newer,
  whichever copy comes last; `remove` forgets it, and twice is the same as once, and a
  copy from before the removal that comes late stays out; `removeWorkspace` forgets one
  workspace's cards and no other's.
- **Pages**: by id, whatever order the cards were indexed in, the total counting every
  match.

The suite is the port's real definition. It is also how you compare adapters: if a
search server finds *planet* for *plan* and the suite says it must, every adapter must.

## In memory: `MemoryCardSearch`

The first adapter keeps every card in a map, and looks at all of them on each search.
Create `search/memory-card-search.ts`:

```ts
// cooper/backend/contexts/boards/search/memory-card-search.ts
import { matches, now, toPage, type Page, type PageRequest } from 'newt/core'
import type { CardDTO } from '../modules/card/card.schema'
import type { CardQuery, CardSearch } from './card-search'

/**
 * The cards' search in memory: every card in a map, each search a look at all of them.
 * Enough for one process; what it keeps is lost when the process ends, so boards
 * indexes every card again when it opens. A removed card leaves its id and the time
 * it went, so a copy from before that comes too late is not kept.
 */
export class MemoryCardSearch implements CardSearch {

  private readonly cards = new Map<string, CardDTO>()
  /** The cards removed, by id: when each went. */
  private readonly removed = new Map<string, string>()

  async index(card: CardDTO): Promise<void> {
    const kept = this.cards.get(card.id)
    if (kept && kept.updatedAt > card.updatedAt) return
    const removedAt = this.removed.get(card.id)
    if (removedAt !== undefined && removedAt >= card.updatedAt) return
    this.cards.set(card.id, card)
  }

  async remove(id: string): Promise<void> {
    this.cards.delete(id)
    this.removed.set(id, now().toISOString())
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

Two pieces of newt do most of it:

- **`matches(row, criteria)`**, from `newt/core`, says whether a row meets criteria:
  every operator and group, answered as SQL would (a comparison with `null` holds for
  nothing; `ieq` folds A to Z only). It is what the files store uses to check rows one
  by one, and it is there for any adapter of yours that checks rows in memory.
- **`toPage(rows, size, total)`**, as in chapter 15: it takes one row more than the
  page, drops it, and says `hasMore`.

`index` compares `updatedAt` before it replaces: a copy older than the one kept is
dropped. The two are ISO timestamps of the same clock, so comparing them as strings
compares them in time.

`remove` deletes the card and leaves a tombstone: its id in `removed`, with the time it
went, by `now()` (newt's clock, which tests can set). `index` then refuses a copy whose
`updatedAt` is not later than that time: it was read before the card was deleted. The
tombstones are an id and a date each, and stay until the process ends, like the rest
of the map.

The text is JavaScript's `toLowerCase` and `includes`: every letter's case is folded,
and `%` is a character like any other. Searching is linear in the number of cards, and
the ids are sorted on every search. That is fine for one process's cards; it is not a
search engine.

Its test is one line, the suite:

```ts
// cooper/backend/contexts/boards/search/memory-card-search.test.ts
import { describeCardSearchContract } from './card-search.contract'
import { MemoryCardSearch } from './memory-card-search'

describeCardSearchContract('MemoryCardSearch', () => new MemoryCardSearch())
```

## The cards get the search

The card module is configured with the search, as it is with the mailer. In
`card-options.ts`, add it:

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

The context receives it from whoever opens it, with its other dependencies. In
`initialize-modules.ts`, import the port's type:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
import { Workspace_Module } from './modules/workspace/workspace.module'
import type { CardSearch } from './search/card-search'
```

add it to `Boards_ModuleDeps`, and say so in its comment:

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

and hand it to the cards:

```ts
// cooper/backend/contexts/boards/initialize-modules.ts
  const card = Card_Module.initialize(base, { board, column, member, access: deps.access }, { mailer: deps.mailer, publicUrl: config.publicUrl, search: deps.search })
```

In `index.ts`, the backend opens boards with a `MemoryCardSearch`:

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

Tests open boards with one too, and keep it at hand as `t.search`, to look at the
index directly. They also get `writeCards`, which writes card rows straight into the
table, past every use case and its events: a test of very many cards, or of an index
that lost them. Replace `testing/open-test-boards.ts`:

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
import { runAsActor } from 'newt/core'
import { config } from '../../../config'
import type { ActorVia } from '../../../shared/actor'
import { RecordingMailer } from '../../../shared/mail/recording-mailer'
import type { BoardsBase } from '../boards-base'
import { Boards_Context } from '../boards.context'
import type { CardRow } from '../modules/card/card.repository'
import { MemoryCardSearch } from '../search/memory-card-search'
import { inWorkspace } from '../workspace-scope'
import { FakeAuth } from './fake-auth'

/**
 * `boards` for a test: its database and its cards' search in memory, a fake auth
 * behind its ports, its emails and its log's lines in lists, and who sends a request
 * told by an `x-user` header.
 */
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const mailer = new RecordingMailer()
  const lines: string[] = []
  const search = new MemoryCardSearch()
  const boards = await Boards_Context.open({ ...config.boards, database: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
    tenants: auth.tenants,
    access: auth.access,
    mailer,
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
    mails: mailer.mails,
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

`writeCards` uses the Kysely of chapter 15 to insert, inside `store.transaction`, as a
write must, 500 rows at a time.

## The search, through the port

In `card.module.ts`, the first import takes `allPages`, and the workspace scope gives
`currentWorkspaceId` too:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
import { allPages, currentActor, eventsOf, mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
import type { BoardsBase } from '../../boards-base'
import { currentWorkspaceId, runInWorkspace } from '../../workspace-scope'
```

Replace `search`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * A page of the workspace's cards that have the text and pass the filter: only the
   * fields and operators `CardFilter` allows. The search finds their ids, a moment
   * behind; the cards are read as they are now, and one gone since is left out.
   */
  @UseCase()
  async search(input: unknown, page: PageRequest): Promise<Page<CardDTO>> {
    const { text, filter } = CardSearchSchema.parse(input)
    const criteria = filter ? CardFilter.toCriteria<CardDTO>(filter) : {}
    const found = await this.options.search.search(currentWorkspaceId(), { text, criteria }, page)
    const cards = new Map((await this.repo.find({ id: { in: found.items } })).map(card => [card.id, card]))
    // The next page starts after the last id the search found, whether or not its card is still there.
    return mapPage({ ...found, nextCursor: found.items.at(-1) }, id => cards.get(id)?.toDTO())
  }
```

The filter is parsed and checked as before; what reaches the port is criteria, and the
workspace the request is in. The port answers ids; one `find` reads those cards from
the table, through the repository and its scope.

Chapter 15 said never to fetch ids and send them back in an `in`. That rule is about a
list of ids that grows with the data. Here the list is one page, at most 100 ids
(`pageRequestFrom` keeps `size` between 1 and 100): it does not grow.

`mapPage` makes each id the card's DTO, in the order the search gave, and leaves out
the ones it makes `undefined`: a card deleted after the index last saw it. The page may
then be one card short; its `total` is the index's. The next page must start after the
last id the **search** found, not after the last card kept, so `nextCursor` is said
explicitly: `mapPage` keeps a cursor it is given, and drops it on the last page.

## Keeping the index: a worker on every change

The index is a copy of the cards. Something has to update it each time a card changes,
and that something is the cards themselves, reacting to their own events. Add a use
case after `countByBoard`:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /**
   * The search finds a card as it is now: read again, it is indexed, or removed if it
   * is gone. What a worker calls on every change of a card, in any order, as many
   * times as it takes: each run indexes what is there then, and two at once that
   * hand the search their copies in the wrong order leave it the newer one, or none
   * once the card is deleted.
   */
  @UseCase()
  async indexCard(workspaceId: string, id: string): Promise<void> {
    const card = await runInWorkspace(workspaceId, () => this.repo.first({ id }))
    if (card) await this.options.search.index(card.toDTO())
    else await this.options.search.remove(id)
  }
```

and subscribe it to every event of a card, in `card.workers.ts`, after the
notifications:

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

Each one is a `'handler'` (chapter [11](./11-reacting)): a job saved in the same
transaction as the change, run by the worker until it succeeds. Not
`'fire-and-forget'`: a change lost on the way would leave the card wrong in the
search until boards opens again. Each queue is named after what it calls and what it
hears, as the lint asks.

**Why read the card again**, rather than index what the event carries? Every event has
the card's DTO in it; indexing that would save a read. But the jobs do not run in the
order the changes happened:

- Each subscription is a queue of its own, and the worker runs up to ten jobs at a
  time, from any queue.
- A job that fails is tried again later, with backoff (chapter
  [12](./12-failures)), while the jobs after it run.

So the job of an `edited` can run after the job of the `moved` that came later, or
after the card was deleted. Indexing the event's DTO would put back an old title, or a
card that no longer exists. Reading the card again makes each run index what is in the
table **then**, or remove it if it is gone, whatever event woke it. The order stops
mattering, and so does running twice: that is what makes it safe to retry. The same
idea as chapter [14](./14-sagas)'s steps: each run converges on what is there.

Reading again leaves one case. Two jobs of the same card can run at the very same
moment, and cross: the first reads the card, the second reads it after a newer change
and indexes it, and only then does the first index the copy it read, older. Each job
read the truth of its moment; the search would end with the older one, and keep it
until the card changes again.

The same crossing happens with a deletion. A job reads the card, the card is deleted,
the job of the `deleted` event finds it gone and removes it; then the first job
indexes the copy it read. Without more, the deleted card would be back in the search,
and nothing would ever remove it again: no event of that card is left to come.

That is why the port asks `index` to keep the newer copy. Every change of a card moves
its `updatedAt` forward, so of two copies the later `updatedAt` is the newer card.
Handed the older one last, the adapter keeps what it has. And it asks `remove` to be
for good: a removal is newer than any copy read before it, so a late copy is dropped.
Whichever job writes last, the search ends with the newer copy, or with none once the
card is deleted: the same convergence as the followers of chapter
[13](./13-another-context), each job doing its part and the order not mattering. An
adapter on a search server does the same with the server's own tool: a version given
with each document (its `updatedAt`, say), so that the server itself refuses an older
write.

`purgeWorkspace` removes a deleted workspace's cards as rows, all at once, and that
tells no event per card (chapter 14). So it forgets them in the search itself:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  /** A workspace was deleted in auth: its cards go, and the search forgets them. A step of that deletion, safe to run again. */
  @UseCase()
  async purgeWorkspace(workspaceId: string): Promise<void> {
    await this.repo.purgeWorkspace(workspaceId)
    await this.options.search.removeWorkspace(workspaceId)
  }
```

Both steps are safe to run again: a second run finds nothing to remove in either.

## Indexing every card as boards opens

A `MemoryCardSearch` starts empty. Every time boards opens, every card must be indexed
before anyone searches. That is a read of every card of every workspace, by pages.

In `card.repository.ts`, the LIKE query goes. The imports lose `Criteria` and Kysely's
`sql`:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
import { toPage, type Page, type PageRequest } from 'newt/core'
import { whereOf } from 'newt/kysely'
import { TableRepository } from 'newt/repository'
import type { BoardsBase } from '../../boards-base'
```

and in place of `search`, a page of every workspace's cards:

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

It crosses workspaces on purpose, through `findInEveryScope` (chapter
[4](./04-who-and-where)), behind a name that says so. `find` orders by id unless told
otherwise, so the cursor is the last id of the page before, as in every list.
`whereOf` stays, in `countByWorkspace`.

`boards-base.ts` no longer mentions the search in its comment:

```ts
// cooper/backend/contexts/boards/boards-base.ts
/**
 * What every module of `boards` receives: cooper's base, and Kysely on its store, for
 * the queries a table cannot say (cards counted by workspace and by board). Kysely
 * needs a SQL store: `boards` opens on SQLite, and would open on Postgres or MySQL the
 * same way, never on files.
 */
```

In `card.module.ts`, after `indexCard`:

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

**`allPages(read)`**, from `newt/core`, reads a paged list whole: it asks for pages of
100, each starting after the last item of the one before (or where the page's
`nextCursor` says), until `hasMore` is false. Its own comment says it is for lists that
are never long. All of boards' cards is not such a list, and `reindex` uses it anyway,
knowingly: the memory search keeps every card in memory, so holding them all for a
moment costs no more than the index itself. An adapter on a search server would not
reindex at every start, and would index page by page if it ever did.

The context calls it as it opens, in `boards.context.ts`:

```ts
// cooper/backend/contexts/boards/boards.context.ts
    const modules = initializeModules(base, config, deps)
    // The cards' search starts empty in memory: every card is indexed before anyone searches.
    await modules.card.reindex()
    return new Boards_Context(base, modules, config)
```

`open` returns only once the index is full, so the server is not serving yet.

## A moment behind

The index is now a **projection**: a copy of the cards, shaped for one kind of
question, kept up to date by reacting to what happens. Projections are eventually
consistent. Right after ana creates a card, the job that indexes it may not have run;
a search in that moment does not find it. A moment later it does. The same after an
edit (the old title still matches for a moment) and after a delete (the use case
already leaves the card out, since the table no longer has it, but the total still
counts it).

For a search that is fine: nobody expects a card to show up in a search the very
millisecond they create it. It is not fine for everything. A rule that must hold (a
board's name taken once, a column's ten cards) reads the table, never a projection.

In tests the worker is not running: jobs run when a test waits for them, with
`t.settled()` (chapter [11](./11-reacting)). So a test creates cards, settles, then
searches. Without `settled()`, the search finds nothing, every time. That is not
something to work around; it is what the tests below check.

## Tests

In `card.test.ts`, the two search tests of chapter 15 now wait for the index. In the
first, after its four cards:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
    await create('100% done_ish')
    // The search is a moment behind: each card is indexed by a worker.
    await t.settled()
```

and in the second, which also takes back the name it had before chapter
[15](./15-kysely) renamed it:

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
  test('finds a card by the text of its title as it is written, letters beyond A to Z too', async () => {
    await create('Ärger im Büro')
    await t.settled()
```

On SQLite only A to Z folded, and chapter 15's name said so. The search is the port's
now, and `MemoryCardSearch` folds every letter, as the contract asks: *ärger* would
find *Ärger* too.

After it, two new tests. One follows a card through a create, an edit and a delete,
searching before and after the index catches up. The other writes 1,001 cards as rows,
behind the events' back, as an index that lost them would find them, and indexes them
all again:

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

Look at the delete in the first one: right after it, the use case already finds
nothing, since it reads the cards from the table; only once settled does the index
itself forget the card, which `t.search` shows. 1,001 cards are more than ten pages of
`allPages`, so the second test crosses page boundaries, and globex's card shows that
the reindex covers every workspace.

In `boards.context.test.ts`, the search over HTTP settles after creating its cards:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
    for (const title of ['Plan the launch', 'Design', 'Plan the party']) await call('POST', `/acme/boards/${id}/cards`, { columnId: todo, title })
    await t.settled()
```

And in `workspace.test.ts`, *removes all a workspace has once auth deletes it* checks
the search forgets the deleted workspace's cards, and only those. Each workspace has
its welcome card:

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

## The limit of memory: one process

`MemoryCardSearch` is enough for cooper as it runs today: one process. It stops being
enough the moment there are two.

Run two processes of boards behind a load balancer, on one database. Each has its own
map. A card's `indexCard` job is a row in the outbox; one worker claims it, in one of
the two processes, and only that process's map gets the card. A search answered by the
other does not find it, until that process restarts. And every process keeps every
card of every workspace in its memory, and reads them all each time it starts.

None of this is a bug of the adapter: it is what "in memory" means. The fix is not in
the cards, nor in the port. It is another adapter.

## A search server: what an Elasticsearch adapter would do

cooper does not ship one. This is what it would be, to show that the port holds. An
`ElasticCardSearch implements CardSearch` would live in `search/` beside the memory
one, and be done when `describeCardSearchContract('ElasticCardSearch', …)` passes.

- **The index.** One Elasticsearch index of cards, each document by the card's id, with
  `workspaceId`, `boardId`, `columnId`, `assigneeId` and `id` as `keyword` fields,
  `number` as an `integer`, and `title` and `description` as text.
- **`index(card)`** puts the document by its id, replacing what was there: that is
  already what the contract asks, given the `updatedAt` as an external version so the
  server refuses an older copy. **`remove(id)`** deletes it, with a version too, and
  takes a "not found" as done, since removing twice is the same as once; the server
  keeps the deleted document's version for a while (`index.gc_deletes`) and refuses an
  older copy that comes in that time. **`removeWorkspace`** is a delete
  by query on the `workspaceId` term.
- **`search`** is one `bool` query. Its `filter` takes the workspace as a term, always,
  and the criteria translated: newt's `criteriaTree(criteria)`, from `newt/core`, turns
  them into a tree of `all`, `any` and conditions on one field, which maps onto `bool`
  queries (`all` to `filter`, `any` to `should` with at least one to match, `eq` to a
  `term`, `in` to `terms`, `gt`… to a `range`, `ne` and a `null` to `must_not`). The
  translation must answer as `matches` does; the contract's criteria tests catch it if
  not.
- **Text**, as the contract has it, is "contains, whatever the case": a `wildcard`
  query, case-insensitive, on a `keyword` copy of the title and the description, with
  the text's own `*`, `?` and `\` escaped; or an n-gram field, which answers the same
  far faster. A lowercase normalizer folds *Ä* as JavaScript does, which is the case
  test.
- **Pages**: sorted by `id`, the cursor passed as `search_after`, one document more
  than the page to know `hasMore`, and `track_total_hits` for an exact `total`.
- **Freshness**: a search server shows a write a moment later (its refresh). The index
  is already a moment behind, so in production nothing changes; in the contract,
  which writes then reads at once, the adapter writes with `refresh: 'wait_for'`, or
  its fixture refreshes before each read.
- **The fixture** opens a new index with a random name for each test, and the
  adapter's test is skipped unless an environment variable gives a server's address,
  as chapter [27](./27-postgres) does for Postgres.

What would change outside `search/`: one line in `index.ts`, the adapter handed to
boards instead of `MemoryCardSearch`; and `boards.context.ts` would not `reindex` at
every start, since the server keeps its index. The cards, their workers, the use case
and the route do not change.

And what the server is good at, words and their forms, relevance, typo tolerance, is
not in the contract today: results come by id, and *plan* finds *planet*. Asking for
more is a change to `CardSearch` and its suite, made on purpose, which the memory
adapter would then have to keep up with or give up.

## Check it

```sh
bun install && bun check && bun test cooper/ && bun run lint
```

`bun test cooper/` now runs the contract suite once, as *MemoryCardSearch keeps the
CardSearch contract*.

Then by hand, on a database file. Start the backend (`bun cooper/backend/index.ts`),
make a card, and search it:

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

The server's worker runs the job as soon as the card is saved, so it is usually found
already; if not, it is a moment later. Then stop the server (Ctrl-C), start it again,
and send the same search:

```text
{"titles":["Plan the launch"],"total":1}
```

The map was empty when the process started; boards indexed every card as it opened.
(Your total counts the other cards you made with *plan* in them, in earlier chapters.)

## What to remember

- Text search is not a table's job, and newt's criteria have no "contains": criteria
  are what every store answers alike. Put text search behind a port of your own, for
  an adapter that specializes in it.
- Write the port's contract as a suite (`describeCardSearchContract`), as newt does for
  stores with `describeStoreContract`. An adapter is done when the suite passes.
- The index is a projection: kept by `'handler'` workers on every event of a card,
  each re-reading the card and indexing what is there or removing it. Jobs run out of
  order and run again; re-reading makes both harmless, and an `index` that keeps the
  newer copy (a later `updatedAt`), and a `remove` that keeps a late copy out, make two
  jobs that cross harmless too.
- A projection is a moment behind. The search gives ids; the use case reads the cards
  from the table. Tests wait with `settled()`. Rules that must hold never read a
  projection.
- In memory means one process: rebuilt as boards opens (`allPages` over
  `pageInEveryScope`), and wrong as soon as there are two. A search server is another
  adapter of the same port.

Next: [A second context: auth](./17-auth).
