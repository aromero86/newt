# A. The golden rules

Every rule the tutorial taught, on one page, each in one line with the chapter that
teaches it. Come back to it now and then: it is shorter than the code it keeps tidy.

## The ones that never break

1. **One module, one responsibility.** If describing it needs an "and", it is two. ([2](./02-first-module))
2. **A route does not think.** It reads the request, calls a use case with the body as it came, and answers; the use case parses it (`newt/route-body`). ([2](./02-first-module))
3. **Only the entity changes itself**, with methods that say what happened. ([2](./02-first-module))
4. **Only the repository touches the store.** ([2](./02-first-module))
5. **A transaction is one save**, never a whole use case. ([6](./06-rules-over-rows))
6. **A use case writes into another module only from a worker**, reacting to an event, and a transaction saves one module, a worker's too; an exception says `writesTo`, with its reason. ([8](./08-two-people-one-card), [13](./13-another-context))
7. **What cannot be undone leaves from a worker** (an email, a call to another system), never from the use case that makes the change. ([12](./12-failures))
8. **A job may run more than once**, so a second run must find nothing to do. ([11](./11-reacting))
9. **Modules and contexts never depend on each other in a cycle.** ([1](./01-project-and-context), [20](./20-wiring-contexts))
10. **A module points at another's things only by id**, never by its entity or its table. ([7](./07-cards-and-a-counter))
11. **No list is returned whole unless a rule of the domain bounds it** (at most 10 columns, 500 cards); every other list goes by pages. ([3](./03-pages-and-errors))

## The project and its modules

- The backend is a TypeScript project of its own, importing newt by its name; standard decorators, never `experimentalDecorators`. ([1](./01-project-and-context))
- A context opens its store, creates its base and initializes its modules; it receives its config and never reads the environment. ([1](./01-project-and-context))
- Every module has the same files, named after it ([appendix B](./b-module-anatomy)); the lint keeps them so, and `newt add module` writes them ([appendix G](./g-command-line)). ([2](./02-first-module))
- The application's `AGENTS.md` says what is its own (contexts, conventions, commands) and sends coding agents to newt's rules, which ship with the package; `newt init` writes it. ([1](./01-project-and-context))
- A module's `*.schema.ts` is its contract: input schemas take only what a client sends, and reuse the rules of the whole one; from newt it takes only `newt/contract` (`newt/schema-imports`). ([2](./02-first-module), [23](./23-frontends))
- A value object keeps a value's rules in one place: `from` forgives what someone typed, `schema` is strict about what is kept. ([2](./02-first-module))
- A module reaches another only through its module, schema, events, errors and value objects (`newt/module-boundaries`). ([6](./06-rules-over-rows))
- A module checks its references by calling the other module's use cases, never its tables. ([7](./07-cards-and-a-counter))

## Use cases

- Validate, load, decide, change the entity, save once, return DTOs. ([2](./02-first-module))
- Every public method of a module is a `@UseCase`; what is not one is `private` (`newt/use-case`). ([2](./02-first-module))
- A use case a route calls takes its input as `unknown` and parses it with its input schema. ([2](./02-first-module))
- Validate twice: the input in the use case (a 400), the state in the entity (`InvalidEntity`, a 500: a bug). ([3](./03-pages-and-errors))
- **Who** is the actor: `currentActor()`, never a user id passed by hand. ([4](./04-who-and-where))
- Extend `Actor` for who someone is and how they came in (`via`), never for what they may do. ([4](./04-who-and-where), [24](./24-mcp-server))
- **May they** is asked every time, of the module that knows; a stranger gets a 404, not a 403. ([4](./04-who-and-where))
- A list takes a `PageRequest` and returns a `Page`; `mapPage` turns entities into DTOs. ([3](./03-pages-and-errors))
- A use case runs again on a `ConcurrencyConflict`, up to three more times, so it does nothing that cannot be undone before it saves. ([8](./08-two-people-one-card))
- One that must not run twice says `retryOnConflict: false`, with its reason; what it calls then handles its own conflicts. ([8](./08-two-people-one-card), [18](./18-tenants-and-access))
- A public route runs as nobody; to show more to whoever is signed in it uses `runAsActor`, and the use case asks `findCurrentActor()`. ([21](./21-oauth-server))
- Time is a dependency: ask `now()`, never `new Date()`; a test hands the base a clock. ([19](./19-invitations-and-time))

## Saving

- Every repository states its scope: a tenant's `{ field, current }`, or `'none'` with the reason in a comment; leaving it out does not compile. ([2](./02-first-module), [4](./04-who-and-where))
- Every row has a version; saving one someone saved since is a `ConcurrencyConflict` (409), and nothing is written. ([8](./08-two-people-one-card))
- A rule over several rows is checked in the save's `after`, which names what it protects in `guard`, keys as narrow as the rule. ([6](./06-rules-over-rows))
- A save that reads rows and guards nothing is refused (the guard rule): `guard: []` when nothing needs it. ([6](./06-rules-over-rows))
- Check first in the use case for the clear answer; a unique index has the last word (`DuplicateValue`). ([6](./06-rules-over-rows), [18](./18-tenants-and-access))
- A value everyone changes at once lives in a row of its own, taken in the save's `before` under a `guard`. ([7](./07-cards-and-a-counter))
- A value that must never come back is kept in a row that only grows, not derived from rows that can be deleted. ([7](./07-cards-and-a-counter))
- A row created meanwhile has no version: check the whole order in `after` and call `this.conflict()`. ([8](./08-two-people-one-card))
- Several entities of one module saved at once are one `save`: all or none. ([8](./08-two-people-one-card))
- Rows that will never tell anything go for good with `purge(criteria)`, or `saveRows` around several tables. ([14](./14-sagas))
- An entity with a secret has a public schema; keep a hash, never the secret. ([17](./17-auth))

## Asking twice

- A POST that creates something takes `{ idempotency: { table } }`; the client sends a new `Idempotency-Key` per submit, the same one when it sends it again. ([9](./09-idempotent-posts), [23](./23-frontends))
- What fails is not kept: the same key may try again. ([9](./09-idempotent-posts))

## Events and workers

- An event is `<module>.<verb in past tense>`, noted by the entity with `trackEvent`, only if something changed. ([10](./10-events))
- Whatever a listener needs that only the moment knows (who acted) goes in the payload: a listener has no actor. ([10](./10-events))
- An event is heard only once its save commits. `fire-and-forget` is for what may be lost; what matters is `'handler'`, a job in the outbox. ([10](./10-events), [11](./11-reacting))
- A handler's queue is `<module>.<use case>.on.<module>.<event>`; renaming it leaves its pending jobs behind. ([11](./11-reacting))
- A job runs with no actor and no scope: it reads who from the payload and enters the workspace itself. ([11](./11-reacting), [13](./13-another-context))
- A worker that runs late reads again what it is about before acting. ([12](./12-failures))
- What leaves the process carries a key from its event's id (an email's `key`), so a job run twice sends it once. ([12](./12-failures))
- A module that follows another follows its own events too: each follower checks the other side after its own commit, so whichever runs last sees both. ([13](./13-another-context))
- `when` decides from the payload which events get a job; business rules stay in the use case. ([12](./12-failures), [13](./13-another-context))
- Work over several modules is a saga from a worker: each step finds what an earlier run did, and the saga only goes forward. ([14](./14-sagas))
- A dead job is work stuck halfway: fix the cause, then retry it. ([12](./12-failures), [26](./26-dead-jobs-and-analytics))
- What is due at a time is a schedule (`base.schedules.define`), told once per tick across processes. ([19](./19-invitations-and-time))
- A secret is made where it leaves, never kept in a job. ([19](./19-invitations-and-time))

## Contexts

- What a context needs of another is a port in its own words, in the module's `.deps.ts`; a test hands it a fake. ([4](./04-who-and-where), [13](./13-another-context))
- A context gets ports and a `Pick` of the other's modules, never its context, base or store. ([20](./20-wiring-contexts))
- A subscription on another context's emitter is a job of that context's outbox, run by its worker. ([20](./20-wiring-contexts))
- Writes into another context start at an entry point (a route); a call into another context is like an external API. ([20](./20-wiring-contexts))
- A context that reads two reads them through their use cases, never their stores. ([25](./25-backoffice))
- Each context imports only the contexts its `uses` names (`newt/context-boundaries`). ([17](./17-auth), [20](./20-wiring-contexts))

## Queries

- Criteria are for the module's own code; what they cannot say is Kysely, in the repository of the table it reads. ([15](./15-kysely))
- Kysely does not apply the repository's scope: write the workspace's `where` yourself. ([15](./15-kysely))
- A client filters only by what `defineFilter` allows; the system's rules go beside its filter, never inside. ([15](./15-kysely), [18](./18-tenants-and-access))
- One query for the page and its total; never ids fetched to be sent back in an `in`. ([15](./15-kysely))
- Text search lives behind a port of your own, proved by a contract suite; a projection is a moment behind, and rules never read it. ([16](./16-search-port))
- A projection's jobs may come in any order: it keeps the newer copy, and a removed one leaves a tombstone so a late copy does not bring it back. ([16](./16-search-port))
- A read across every scope is `findInEveryScope`, behind a name that says so. ([4](./04-who-and-where))
- Analytics only appends, and every row has its id. ([26](./26-dead-jobs-and-analytics))

## In and out

- A route never catches: what it throws becomes `{ error, code }` with its base class's status. ([3](./03-pages-and-errors))
- A client acts on `code`, which never changes; `setMessages`, once at startup, puts newt's messages in your words. ([3](./03-pages-and-errors))
- Routes nobody can be signed in for say `{ public: true }`; a session lives in an `httpOnly` cookie. ([17](./17-auth))
- A router has one authenticator, set by the module that knows the sessions. ([22](./22-web-session))
- Addresses with a format of their own are a router at the root (`prefix: ''`), answering errors their way with `onError`, a 405 for a method the path lacks included. ([21](./21-oauth-server), [24](./24-mcp-server))
- A route other origins call says so with `cors`, and never with cookies. ([21](./21-oauth-server))
- The browser loads `newt/contract`, never `newt/core`. ([23](./23-frontends))
- An MCP tool is another door to the same use cases; it adds no rules. ([24](./24-mcp-server))

## Migrations and production

- A change of shape is a new migration; an applied one is never edited (its checksum is checked, and `status` names one that changed). ([5](./05-sqlite), [18](./18-tenants-and-access), [27](./27-postgres))
- Each dialect has its own migrations folder; `open` migrates, `connect` does not. ([27](./27-postgres))
- One tracer for every context of a process. ([28](./28-observability))
- A server drains as it stops: its health answers 503 for `drainMs` before it closes. ([29](./29-shipping))

## Tests

- Wait for workers with `jobs.idle()`, never a sleep, in the order the work flows across contexts. ([11](./11-reacting), [20](./20-wiring-contexts))
- Move time with the base's clock and `schedules.tick()`. ([19](./19-invitations-and-time))
- Test the hard cases: at once, twice, refused, limits crossed. ([7](./07-cards-and-a-counter), [8](./08-two-people-one-card))
- A port is proved by a contract suite every adapter runs. ([16](./16-search-port), [D](./d-writing-a-store))
