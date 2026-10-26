# A. The golden rules

Every rule of the guide on one page, grouped by subject, each with the chapter that
explains it. Come back to it now and then: it is shorter than the code it keeps tidy.

## The eleven that never break

1. **One module, one responsibility.** If describing it needs an "and", it is two.
2. **A route does not think.** It reads the request, calls a use case and answers.
3. **Only the entity changes itself**, with methods that say what happened.
4. **Only the repository touches the store.**
5. **A transaction is one save**, not a whole use case.
6. **A module reads from others whenever it wants, but writes into another only from
   a worker**, reacting to an event.
7. **The irreversible (an email, a payment) leaves from a worker**, never from a use
   case.
8. **A worker may run more than once**, so it must not matter if it does.
9. **Dependencies between modules never form a cycle.** Nor between contexts.
10. **A module points at another's things only by id**, never by its entity or its
    table.
11. **No list is returned whole**: it comes by pages.

## Design

- A module's entity has the module's name (`card` → `Card`). An entity named
  otherwise is a second responsibility. ([3](./03-first-module))
- What is saved together, all or nothing, is one module. The rest follows by events.
  ([17](./17-modules-talk))
- A module knows the modules in its `<m>.deps.ts`, and never who depends on it.
  ([17](./17-modules-talk))
- A context reaches another only through its use cases and events, never its
  repositories or its store. Each context is opened after the ones it uses, and
  receives the other's modules as a `Pick` of the ones it needs.
  ([19](./19-several-contexts), [22](./22-backoffice))
- No foreign key, `JOIN` or entity across modules: an id. ([18](./18-references))

## Use cases

- Validate → load → decide → change the entity → save once → return DTOs.
  ([4](./04-use-cases))
- Two validations: the input's, in the use case (`<M>Schema.parse`); the state's, in
  the entity. ([4](./04-use-cases))
- An entity's methods take domain values, not the input DTO. ([3](./03-first-module))
- What only its owner may change takes the actor (`currentActor()`), not an id.
  ([5](./05-who-and-where))
- A list takes a `PageRequest` and returns `items`, `hasMore` and `total`, written out
  one by one. ([4](./04-use-cases))
- A use case runs again on a `ConcurrencyConflict`, up to three more times. One that
  does something before saving that must not happen twice says
  `retryOnConflict: false`, with the reason beside it. ([7](./07-concurrency))
- An exception to the write rule is said where it is seen:
  `@UseCase({ writesTo: ['access'] })`, with the reason beside it.
  ([17](./17-modules-talk))
- The write rule is per context: a use case called from another context is the root
  of what it does in its own. ([19](./19-several-contexts))

## Saving

- A save is one transaction: `persist`, or `save`/`saveRows` inside the repository.
  A module never opens a transaction of its own. ([6](./06-transactions))
- A rule over several rows is checked in the save's `after`, and names what it
  guards with `guard`. It does not compile without it. ([8](./08-rules-over-rows))
- A value everyone changes at once (a counter, a stock) collides with itself if each
  change reads and saves it freely. Derive it from rows only ever added, or take it in
  the save's `before`, under a `guard`, so the changes take turns.
  ([9](./09-shared-counters))

## Events and workers

- An event exists only if its transaction committed. ([10](./10-events))
- One event of each kind per entity and save: two changes before a save make one
  `updated`. ([10](./10-events))
- What matters goes with `strategy: 'handler'`; what may be lost (a log line, a
  cache), with `'fire-and-forget'`. ([11](./11-reacting))
- A handler's queue is `<module>.<use case>.on.<module>.<event>`, and its callback
  calls that one use case. ([11](./11-reacting))
- A worker calls a use case, without an actor (what it needs comes from the event),
  and may run again. ([11](./11-reacting), [13](./13-repeatable-workers))
- What fails halfway is fixed forward: retries, or a compensation.
  ([15](./15-failures), [16](./16-sagas))
- A dead job is someone's to look at: each context offers its dead jobs through use
  cases; fix the cause, then retry. ([22](./22-backoffice))
- An event's shape only grows. ([10](./10-events))

## In and out

- A route does not think. ([3](./03-first-module))
- Data is validated at the door, and value objects normalize it.
  ([3](./03-first-module))
- A client filters only by what `defineFilter` allows. The system's rules go beside
  its filter, never inside. ([23](./23-search))
- Errors are classes with a stable `code`, one per file; their base decides the
  status. ([3](./03-first-module))
- 404 when a 403 would reveal that something exists. ([5](./05-who-and-where),
  [22](./22-backoffice))
- newt's own messages are replaced once, at startup, with `setMessages`. Codes never
  change. ([26](./26-production))

## Data

- `TableRepository` and criteria by default, Kysely for the rest, a store's own SQL
  only when there is no other way, kept in one place and marked.
  ([22](./22-backoffice))
- Kysely does not apply a repository's scope: write it yourself.
  ([22](./22-backoffice), [23](./23-search))
- A read across every scope goes through `findInEveryScope`, behind a method whose
  name says it, bounded, and reached by no route of the scope's own people.
  ([22](./22-backoffice))
- Never fetch ids to send them back in an `in`: one query does it.
  ([23](./23-search))
- Analytics only appends, and every row has its id. ([22](./22-backoffice))
- An applied migration is never edited. A later one takes the rows there are.
  ([24](./24-migrations))

## Tests

- Wait for workers with `jobs.idle()`, never a sleep, in the order the work flows
  across contexts. ([25](./25-tests))
- Test the hard cases: at once, twice, refused, and limits crossed.
  ([25](./25-tests))
- What is set for the whole process is tested in a process of its own.
  ([25](./25-tests))

## Running it

- One tracer for every context of a process: a call across contexts shows inside
  its caller. Without one, nothing is recorded. ([22](./22-backoffice))
