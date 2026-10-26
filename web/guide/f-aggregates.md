# F. Aggregates

An aggregate is a cluster of data that changes together, under rules that must hold
every time it is saved. The idea comes from Eric Evans' *Domain-Driven Design* (2003).
Vaughn Vernon turned it into four practical rules in his essay *Effective Aggregate
Design* (three parts, 2011) and in chapter 10 of *Implementing Domain-Driven Design*
(2013). newt is built on those rules, and departs from them in one place on purpose.

This appendix states Vernon's rules, shows where each one lives in newt and in
cooper, says where newt does something else and what that costs, and compares newt's
way with the other ways people keep aggregates. It ends with how to find a boundary in
a newt app, and the mistakes that break one.

## Vernon's rules, briefly

1. **Model true invariants in consistency boundaries.** An invariant is a rule that
   must be true after every transaction, not "eventually" (a board never has more
   than ten columns). The aggregate is drawn around the data that rule needs, and
   nothing more. Its root is the one entity outsiders talk to.
2. **Design small aggregates.** A large one loads more than a use case needs, and
   every change to any part of it collides with every other change. Most aggregates
   are a root entity and a few values.
3. **Reference other aggregates by identity.** An aggregate holds the id of another,
   never the object. It cannot then change the other by accident, and it can be
   loaded, stored and scaled on its own.
4. **Use eventual consistency outside the boundary.** When a change in one aggregate
   has a consequence in another, the first publishes a domain event, and the second
   is changed later, in its own transaction.

Behind rules 2 and 4 sits a rule of thumb: **modify one aggregate instance per
transaction**. Vernon treats it as a rule of thumb, not a law. The book lists reasons
teams break it (a user interface that edits several at once, a lack of technical
means such as messaging, a company that requires global transactions, query
performance), and asks you to break it knowingly.

How the root guards the rest is classic object design: callers ask the root to do
something, the root changes its parts and checks its rules. Concurrency is handled
by one version per aggregate: two transactions that loaded the same version cannot
both commit.

## How newt maps to them

| Vernon | newt | Chapter |
|---|---|---|
| An aggregate, with its root | A module, with its entity | [2](./02-first-module) |
| Only the root changes its parts | Only the entity changes itself (`change()` is protected); only the repository touches the store | [2](./02-first-module) |
| One version per aggregate | One `version` per entity's row, checked on every save | [8](./08-two-people-one-card) |
| One aggregate per transaction | A save is one module's; the write rule refuses a use case that saves in two | [6](./06-rules-over-rows), [8](./08-two-people-one-card) |
| Reference by identity | References are ids, checked by asking the other module | [7](./07-cards-and-a-counter) |
| Eventual consistency outside | Events, written to the outbox in the save's transaction; `handler` workers | [10](./10-events), [11](./11-reacting), [13](./13-another-context) |
| Long processes | Sagas, run from workers until they converge | [14](./14-sagas) |

### A module is an aggregate

A module owns one entity, its table and the rules about it. The entity is the root:
its methods are the only way to change it, and each one says what happened with an
event. The rules page says it in one line: what must be saved together, all or
nothing, is one module ([the rules](../reference/rules#how-modules-talk)).

newt adds a constraint Vernon does not need: one entity per module. An aggregate in
Vernon's sense may hold child entities (an order and its lines). In newt, a second
entity is a second module, unless it is stored as part of the first (a value, or rows
its own repository writes, as `Repository` allows). That pushes you towards small
aggregates by construction.

### One aggregate per transaction: the write rule

A transaction in newt is one save, `repo.persist(...)`, never a whole use case. A
repository saves only its own module's entities, so one save never spans two
modules. That leaves the use case: it could call two modules that each save, and
fail between them. The write rule catches that as it runs. A use case of module B
that saves, called under a use case of module A outside a worker, throws:

```text
[write rule] card.create writes to boards.column outside a worker: write it from a worker reacting to an event, or list it in its writesTo
```

(The use case and module names are whichever broke it.) This is Vernon's rule of
thumb turned into a check, with his "break it knowingly" written next to the code.
cooper has a few such exceptions, each with its reason. Removing a column asks the
cards first, since only they know whether any is in it, and then has the column
module remove it:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  @UseCase({ writesTo: ['column'] })
  async removeColumn(columnId: string): Promise<void> {
    const column = await this.deps.column.get(columnId)
    const cards = await this.repo.count({ columnId })
    if (cards > 0) throw new ColumnNotEmpty(columnId, cards)
    await this.deps.column.remove(column.id)
  }
```

It still saves one aggregate: the only write is the column module's. `writesTo` lets
a use case write into another module; it does not make two saves one transaction.
auth's `tenant.create` and `tenant.delete` are the other kind of exception: two saves
on purpose, each with a worker that finishes the second if it fails
([chapter 18](./18-tenants-and-access)).

Everything else that writes into another module runs from a worker, where the rule
does not apply: a job that fails halfway runs again until it completes.

### The version: optimistic concurrency at the boundary

Every entity has a `version`. A save writes only what changed, and only where the row
still has the version it was read with; otherwise it throws `ConcurrencyConflict`
and writes nothing. That is Vernon's optimistic concurrency on the root, one row
instead of one object graph.

newt then does what his book leaves to the application: a use case that hits a
conflict runs again from the start, up to three more times, reading what is stored
now. So a use case is written as "load, decide, change, save", with nothing it
cannot undo before the save:

```ts
// cooper/backend/contexts/boards/modules/card/card.module.ts
  @UseCase()
  async edit(id: string, input: CardEditDTO): Promise<CardDTO> {
    const changes = CardEditSchema.parse(input)
    const card = await this.load(id)
    card.edit(changes, actingAuthor())
    await this.repo.persist(card)
    return card.toDTO()
  }
```

Only the first use case of a chain runs again, with all it calls. One that must not
run twice says `@UseCase({ retryOnConflict: false })`, with its reason
([chapter 8](./08-two-people-one-card)).

### References by identity

A card points at its board, its column and its assignee by id, and its schema says
whose each one is. The card module knows those modules (its deps), and asks them;
it never reads their tables or holds their entities:

```ts
// cooper/backend/contexts/boards/modules/card/card.deps.ts
export interface Card_Deps {
  /** That a card's board exists, in the current workspace. */
  board: Board_Module
  /** That a card's column exists, and is of its board; and where cards left in a removed column go. */
  column: Column_Module
  /** That a card's assignee belongs to its workspace, and where to write to them. */
  member: Member_Module
  access: AccessEvents
}
```

On a write, the use case checks a reference by calling the owner's use case, a read
(`assertColumnOf`, `assertMember`, or `this.resolveRefs` for "does it exist"). That
check is outside the card's transaction, as it must be: the column is another
aggregate. So a reference may point at something removed a moment later. newt
accepts that, and has the module that points at it follow the owner's event, which
is Vernon's fourth rule.

### Eventual consistency: events through the outbox

An entity notes its events as it changes (`trackEvent`); its repository publishes
them in the save. A `handler` subscription writes a job to the store's outbox in the
same transaction, so the change and the job are stored together or not at all. A
worker runs the job after the commit, and again with a backoff until it succeeds.
That is the transactional outbox: the "publish after commit" Vernon's book asks for,
without a message broker or a distributed transaction.

The cards follow the columns this way:

```ts
// cooper/backend/contexts/boards/modules/card/card.workers.ts
  // A card points at its column: when a column goes, no card is left in it.
  deps.column.events.removed.subscribe(column => cards.leaveRemovedColumn(column), {
    strategy: 'handler',
    queue: 'card.leaveRemovedColumn.on.column.removed',
  })
```

A job may run more than once, so every reaction is idempotent: the second time,
`leaveRemovedColumn` finds no card in the removed column and does nothing
([chapter 13](./13-another-context)). The same works across contexts: boards follows
auth's `access.revoked` through a port, and the job is in auth's outbox
([chapter 20](./20-wiring-contexts)).

### Sagas, from workers

A piece of work over several aggregates is a sequence of saves, each its own
transaction. In newt it is a use case a worker runs, each step safe to run again.
boards' welcome board is a board, three columns and a card, written when auth tells
`tenant.created`:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.workers.ts
  deps.tenants.created.subscribe(tenant => workspace.prepare(tenant.id), {
    strategy: 'handler',
    queue: 'workspace.prepare.on.tenant.created',
  })
```

`workspace.prepare` writes in three modules, which only a worker may do. If it stops
halfway, its job runs it again, and each step finds what the earlier run did
(`findByName`, `addMissing`, `createFirst`), so it converges
([chapter 14](./14-sagas)). Vernon would call this a long-running process; the
pattern literature calls it a saga or a process manager.

## Where newt departs

### The boundary of a save is a module, not an instance

Vernon's rule of thumb is about instances: one order per transaction. newt's is about
modules: a save writes entities of one module, as many as it is given, all or none.
cooper uses that every time something has an order. Moving a column rewrites the
positions of its board's other columns; moving a card rewrites the positions of the
cards around it. Each is several rows, each with its own version, in one save.

In Vernon's terms those columns are several aggregates saved in one transaction. In
newt's, they are one module's rows, and the save is the boundary. The question the
save answers is the one Vernon's rule 1 asks: which rows must be consistent together
for this change? Here, the columns of one board.

### Rules over several rows: a named guard

A version protects a row against someone who changed that row. It does not protect a
rule that reads several rows, because nobody changed the rows you read: someone
added another. "A board has at most ten columns" is such a rule. Ten requests that
each add a column to a board of five each count five, and each would save.

Vernon's answer is to put the rule inside one aggregate. Board would own its
columns: `board.addColumn(name)` checks the count, and Board's version makes two
additions collide. That is a sound design, and with at most ten columns, Board stays
small. Or he would accept the rule as eventually consistent, and fix the eleventh
column afterwards.

newt keeps Column a module of its own (cards point at columns by id, and columns have
their own events), and protects the rule inside the column's save. The save names
what the rule protects, its **guard**, counts again inside the transaction, and
throws to roll back:

```ts
// cooper/backend/contexts/boards/modules/column/column.repository.ts
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
```

The guard is a named lock held until the transaction ends. Saves that guard
`columns:<board>` take turns; every other save runs side by side. On SQLite and files
every transaction takes its turn anyway; on Postgres and MySQL the guard is an
advisory lock (`pg_advisory_xact_lock`, `GET_LOCK`) in a READ COMMITTED transaction,
so the count in `after` sees what the guard's last holder committed
([chapter 6](./06-rules-over-rows)).

Read the key as the name of a consistency boundary. `columns:<board>` is exactly the
aggregate Vernon would draw, "a board's columns", without a class for it. The
same shape protects:

- **A name free in its workspace.** `persistWithNameFree` guards
  `boardName:<workspace>:<name in lower case>` and counts boards of that name in
  `after`. Vernon calls this set validation, and it has no good home in one
  aggregate: a Workspace that owned every board would be the large aggregate rule 2
  warns about. The guard is as narrow as the rule: two different names never wait.
- **The next card number.** Each board's last number is a row of `card_counter`,
  taken one up in the card's save, in `before`, under `boardCards:<board>`
  ([chapter 7](./07-cards-and-a-counter)). Vernon would keep the counter on Board, and
  every new card would collide with every other on Board's version. Under the guard,
  they take turns instead, and none is refused.
- **An order.** `persistOrder` guards the columns it touches and checks in `after`
  that positions are 0, 1, 2… without gaps. A card created meanwhile has no version
  in this save, so the check finds it, and `this.conflict()` makes the use case run
  again ([chapter 8](./08-two-people-one-card)).

The number is the clearest case of what the guard is for:

```ts
// cooper/backend/contexts/boards/modules/card/card.repository.ts
  async persistNew(card: Card, options: { first?: boolean } = {}): Promise<void> {
    const { boardId, columnId } = card
    await this.save([card], each => this.write(each), {
      guard: [`boardCards:${boardId}`, `cards:${columnId}`],
      before: async () => card.place(await this.takeNumber(card), await this.count({ columnId })),
      after: async () => {
        const count = await this.count({ boardId })
        if (count > MAX_CARDS) throw new TooManyCards(boardId)
        // Its board's first, and another one got in first: the use case runs again, and finds it.
        if (options.first && count > 1) this.conflict()
      },
    })
  }
```

### The guard rule, and the compiler

A rule that holds on SQLite only because SQLite takes turns breaks, unseen, the day
the context moves to Postgres. newt makes a missing guard loud twice. A save with
`after` does not compile without `guard` (`guard: []` says, where it is read, that
none is needed). And the guard rule fails a save that guards nothing and reads rows
in its transaction, on every store, SQLite too:

```text
error: [guard rule] column.add reads column in a save that guards nothing: on Postgres and MySQL another save may change what it read before it commits. Name what its rule protects in the save's guard
```

What it cannot catch is a guard that names the wrong thing: a key too narrow, or two
saves that protect one rule under two names. The key is yours to choose.

### A unique index has the last word

A value no two rows share (a board's name, a card's number on its board) also has a
unique index. If two saves ever slip past the rule, the second one fails with
`DuplicateValue`, a `ConcurrencyConflict` of its own. The use case runs again once,
its own check finds the value taken, and it answers with its own error
(`board.name_taken`). The guard keeps the rule; the index makes sure a mistake in it
cannot store bad data ([chapter 6](./06-rules-over-rows)).

### The use case checks first, the save checks again

A use case checks a rule before it saves, for a clear answer in the usual case;
the save checks it again where nothing slips in. In Vernon's design the check is
written once, in the aggregate's method. In newt a rule over several rows is written
twice: once in the use case, once in the save's hook.

```ts
// cooper/backend/contexts/boards/modules/column/column.module.ts
    const count = await this.repo.count({ boardId })
    // For a clear answer in the usual case: the save counts again, where nothing slips in.
    if (count >= MAX_COLUMNS) throw new TooManyColumns(boardId)
```

### What it costs

Be clear about the trade:

- **The invariant lives in the repository, not the entity.** `Board` knows nothing
  of "at most ten columns"; `Column_Repository.persistAdded` does. A reader looking
  for a module's rules reads its entity, its use cases and its repository's save
  hooks. Vernon's design puts them all in the root.
- **You test it against a store.** An aggregate's rule is a unit test of one class. A
  guarded rule is a test that runs saves at once on a real store (cooper's column
  tests add eight columns at once to a board of five, and expect five in).
- **A guard waits; a version fails.** Saves under one key queue up. That is better
  than conflicts and retries for a hot key (the card counter), and worse if a save
  holds the key long: everything behind it waits, up to the store's wait limit.
- **The lock is named by convention.** Nothing ties `columns:<board>` to the column
  module but the string. Two repositories could use the same name and wait on each
  other, or two saves of one rule could use different names and not wait at all.
- **A follower must come after what it follows.** A reference checked before the
  owner's change, and saved after it, is fixed only by a follower that runs after
  that save. Eventual consistency is only as good as the reaction that closes it.
- **It is still one store.** A guard works because the rows are in one database. It
  is not a way around rule 4: a rule over two contexts' data is eventually
  consistent, by events, as Vernon says.

What it buys: small aggregates (one entity per module, one row per entity), rules
over sets without a class that holds the set, a hot counter without collisions, and
the same code on every store.

## Other ways to keep aggregates

The same problem, solved seven ways. newt's is one of them.

| | Where invariants live | Concurrency | Across aggregates | Testability | Scaling | Learning curve |
|---|---|---|---|---|---|---|
| **(a) newt** | Entity methods; set rules in the save's hooks | Version per row; named guards for sets; retry on conflict | Events, transactional outbox, workers | Use cases against a real store, at once | One store per context; guards narrow the waits | Moderate: a few rules, enforced |
| **(b) ORM object graphs** | The root's methods, over loaded children | Version on the root, row locks | Often a shared transaction | Unit tests of the graph; integration for mapping | Large graphs load and lock a lot | High: the ORM's behaviour |
| **(c) Transaction scripts** | The service and the database | Row locks, `SELECT … FOR UPDATE`, constraints | One transaction for everything | Mostly integration tests | Fine until lock contention | Low at first |
| **(d) Event sourcing** | The aggregate's command handlers | Expected stream version | Events, subscriptions, process managers | Given events, when command, then events | Streams scale well; reads need projections | High |
| **(e) Decider** | Pure `decide` and `evolve` functions | Whatever runs it (a stream version, a row version) | As (d), or as the host does | Pure functions, no store | As its host | Moderate |
| **(f) Actors** | The actor's message handler | One writer by construction | Messages between actors | Actor test kits | Sharded across a cluster | High |
| **(g) The database only** | Constraints, triggers, SERIALIZABLE | The database | One transaction, or none | SQL tests | One database | Low for simple rules, high for complex ones |

### (a) newt's way

A module per aggregate, an entity as the root, a version per row, a guard for a rule
over several rows, events through the outbox for everything outside.

- **For:** small aggregates by default; the rules are checked at run time (the write
  rule, the guard rule) and at compile time (`after` without `guard`); one model
  for every store; eventual consistency that does not lose events; no infrastructure
  beyond the database.
- **Against:** set rules sit in repositories, not in the domain model; a rule over
  several rows is written twice (the use case's check and the save's); lock names
  are strings; everything is in one database per context, so scaling one aggregate
  type alone means a new context.

### (b) Large aggregates and object graphs with an ORM

JPA and Hibernate with cascades, Entity Framework Core with navigation properties,
lazy loading. The root holds its children as objects, and saving the root saves the
graph:

```java
@Entity
class Board {
  @Version long version;
  @OneToMany(mappedBy = "board", cascade = CascadeType.ALL, orphanRemoval = true)
  List<Column> columns = new ArrayList<>();

  void addColumn(String name) {
    if (columns.size() >= 10) throw new TooManyColumns();
    columns.add(new Column(this, name, columns.size()));
  }
}
```

- **For:** the rule is where a reader looks for it, in the root; the version on the
  root makes two additions collide (with a `mappedBy` collection, as here, Hibernate
  does not move the root's version when a child is added: a lock mode such as
  `OPTIMISTIC_FORCE_INCREMENT` does); mature tooling.
- **Against:** the graph grows. Navigation from one aggregate to another is one
  property away, so references by identity erode, and a transaction ends up changing
  several. Lazy loading hides queries (the N+1 problem) and fails outside a session.
  Every change to any part of a large aggregate collides with every other. Vernon's
  essay is, in good part, about the pain of this approach.

### (c) Transaction scripts and anemic services

The typical Express or NestJS CRUD: a service method opens a transaction, reads,
checks, writes several tables, commits. Martin Fowler named both the Transaction
Script (*Patterns of Enterprise Application Architecture*, 2002) and the Anemic
Domain Model (a 2003 article): entities as bags of fields, rules in services.

```ts
await db.transaction(async tx => {
  await tx.query('SELECT id FROM board WHERE id = $1 FOR UPDATE', [boardId])
  const [{ count }] = await tx.query('SELECT count(*) FROM column WHERE board_id = $1', [boardId])
  if (count >= 10) throw new TooManyColumns()
  await tx.query('INSERT INTO column …')
})
```

(Locking the board row is what makes the count hold, and only if every code path that
adds a column locks it first. Counting alone, even inside the transaction, lets two
requests both see nine. Getting that right in every service method is the point.)

- **For:** little to learn; one transaction makes any change consistent; fast to
  write for simple apps.
- **Against:** no boundary at all, so rules are wherever the last person put them;
  a transaction grows until it locks half the database; events sent from inside the
  transaction are lost or sent twice without an outbox; concurrency is correct only
  if every author knows the database's locking well.

### (d) Event-sourced aggregates

Axon Framework (Java), Eventuous (.NET), EventStoreDB (now KurrentDB), Marten. An
aggregate is a stream of events. A command loads the stream, rebuilds the state,
decides, and appends new events with the version it read as the expected version;
another writer meanwhile makes the append fail.

- **For:** the boundary is the stream, so Vernon's rules are the shape of the
  storage; the events are the history, so audits and new read models come for free;
  concurrency is exactly one number per aggregate; tests read as "given these events,
  when this command, then these events".
- **Against:** reads need projections, which are eventually consistent; an event's
  shape is forever, and changing one means upcasting; set rules (a name unique in a
  workspace) are as hard as in Vernon's design, solved with a reservation stream or
  a lookup table; more infrastructure and more to learn. newt keeps events as
  notifications of a state change, not as the state.

### (e) The functional Decider

Jérémie Chassaing described it in *Functional Event Sourcing Decider* (2021): an
aggregate is three pure things, an initial state, `decide(command, state) → events`
and `evolve(state, event) → state`.

```ts
const decide = (command: AddColumn, board: BoardState): ColumnAdded[] => {
  if (board.columns.length >= 10) throw new TooManyColumns()
  return [{ type: 'ColumnAdded', name: command.name, position: board.columns.length }]
}

const evolve = (board: BoardState, event: ColumnAdded): BoardState =>
  ({ ...board, columns: [...board.columns, event.name] })
```

- **For:** the rules are pure functions, tested without anything else; it runs on
  event sourcing or on a stored state (`evolve` folded once, the state saved with a
  version); it composes.
- **Against:** it says nothing about concurrency or consistency between aggregates:
  the host does. Its aggregate is still one boundary, so a set rule needs the set in
  the state. Teams not used to functional style find it abstract.

newt's entity is close to its object-oriented sibling: a method decides and changes
the state at once, and the event says what changed.

### (f) Actor-model aggregates

Microsoft Orleans grains, Akka persistent actors (`EventSourcedBehavior`, with
Cluster Sharding). Each aggregate instance is an actor; messages to it are handled
one at a time. Two changes to one aggregate never run at once, so there is nothing to
conflict.

- **For:** one writer per aggregate by construction, no optimistic retries; the
  state stays in memory, so hot aggregates are fast; it scales across a cluster.
- **Against:** a rule across aggregates is a conversation between actors, so
  eventual by nature; placement, activation, failover and the persistence plugin are
  infrastructure you run; a slow message blocks its actor; an actor that is called
  by another that it calls deadlocks unless the framework allows reentrancy.

newt's guard gets "one writer at a time" for a key, without the cluster, and only
for as long as the save.

### (g) Invariants in the database only

Check constraints, unique and exclusion constraints, foreign keys, triggers, and
SERIALIZABLE transactions that make any interleaving behave as one after the other.

- **For:** nothing gets past them, whichever program writes; for simple rules
  (unique, not null, a foreign key) nothing is cheaper or safer.
- **Against:** a rule like "at most ten columns" is a trigger, in the database's
  language, out of sight of the domain code; the error that comes back is a database
  error to translate; SERIALIZABLE fails transactions under contention, which must
  then run again, and is one database's semantics (Postgres' differs from others').
  Foreign keys tie tables of different aggregates together, which is the coupling
  rule 3 removes.

newt uses the database for the last word only: a unique index on a value no two rows
share, under a rule the code already checks.

## When to choose what

- **A newt app:** use newt's way. It is what the framework checks.
- **One aggregate with a rule over its children, a small fixed number of them:**
  Vernon's root-owns-children is fine. In newt, store the children as part of the
  entity (a list field, kept as `json`, or rows its own repository writes) when
  nothing outside needs to point at them one by one.
- **Children others point at, or with a life of their own:** a module of their own,
  and the set rule in a guarded save, as cooper's columns.
- **Full history as a requirement** (finance, audit): event sourcing, or newt with an
  append-only module of movements for that one value
  ([the rules](../reference/rules#saving) describe both shapes of a value many change
  at once).
- **Very hot single aggregates across many machines:** actors.
- **A small CRUD with few rules:** transaction scripts are cheaper, until they are
  not.
- **Rules a database says well** (unique, not null): always in the database too.

## Finding a boundary in a newt app

Ask these, in order:

1. **What rule must hold after every save?** Draw the boundary around the data it
   reads. "At most ten columns" reads a board's columns: that set is the boundary,
   and `columns:<board>` its name.
2. **Can it be true a moment later instead?** Then it is not one boundary: the
   second part follows by an event. A card in a removed column goes to the first
   column a moment later (`leaveRemovedColumn`). A card assigned to someone who left
   the workspace loses its assignee a moment later (`unassignMember`).
3. **Does something else point at it by id?** Then it is a module of its own. Cards
   point at columns, so columns are not a field of the board.
4. **Is it changed by many people at once?** Then keep it apart from what changes
   rarely. The card counter is a row of its own, not a field of the board that every
   rename would collide with.
5. **Does describing it need an "and"?** Then it is two modules
   ([chapter 2](./02-first-module)).

Two signs that a boundary is wrong: a use case keeps needing `writesTo` for the same
two modules (they change together, so they may be one), or a module's save guards a
key that another module's save guards too (the rule spans both, so one of them owns
it).

## Common mistakes

**Two modules in one use case.** `card.create` that also updates a board's count of
cards. The write rule refuses it outside a worker. Do the second part from a worker
on `card.created`, or, if the two must always change together, make them one module.
A `writesTo` is for one write into another module, with its reason beside it, not for
a habit.

**Reading, then writing, without a guard.** A use case counts, decides, and saves:

```ts
if (await this.repo.count({ boardId }) >= MAX_COLUMNS) throw new TooManyColumns(boardId)
await this.repo.persist(column)
```

On SQLite this looks right in every test. On Postgres, two requests count nine and
both save. The count must be repeated inside the save, in `after`, under a guard. The
check before is only for the clear answer.

**Calling another module from a save's hook.** A hook runs inside the transaction; a
use case called from it would read, or write, in that transaction, so two
aggregates would share it. A hook reads only its own module's rows.

**An event with no change.** An entity that tracks `card.assigned` when the card
already had that assignee tells something that did not happen. The save refuses it
before writing anything (`EventWithoutChange`). Change what the event tells of along
with it, or tell nothing: cooper's `Card.assign` returns early when the assignee is
the same.

**An aggregate that grows.** A board that starts holding its columns, then its cards,
then each card's activity. Every change then collides with every other, and loading
a board loads everything. Split by question 3 and 4 above: what others point at, and
what many change at once, go apart.

**A guard key wider or narrower than the rule.** `board:<workspace>` for the name
rule makes every board save of a workspace wait for every other. A key with the name
as typed, not in lower case, is too narrow: `Roadmap` and `ROADMAP` take two keys,
run side by side, and both pass the count. Name exactly what the rule reads, in the
form it compares.

**A worker that assumes the event is still true.** A job runs later, maybe after
other changes. It reads again what it is about before acting, as
`notifyAssignee` reads the card again ([chapter 12](./12-failures)).

## In short

- A module is an aggregate; its entity is the root, and only the entity changes
  itself.
- A save is one module's, all or none; the write rule makes a use case write into
  another module only from a worker, or with `writesTo` and its reason.
- A version protects a row; a guard protects a rule over several rows, named as
  narrowly as the rule.
- Other aggregates are ids, checked by asking their module, and followed by their
  events.
- What happens elsewhere happens later, from the outbox, safe to run again.
