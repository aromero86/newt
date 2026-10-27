# E. Índice de los exports de newt

Cada export de cada entrada de newt (los `exports` de `packages/newt/package.json`),
y dónde lo enseña el tutorial. **Se importa en** lista los capítulos cuyo código lo
importa de esa entrada; **También en**, los capítulos y apéndices que lo nombran, o que
lo enseñan con el nombre con que lo usas (`base.http.group` es `HttpGroup`,
`base.jobs` es `JobQueue`). Un guion marca un export que ningún capítulo enseña:
para qué sirve está en su comentario de documentación, y en la
[referencia](../reference/rules).

A veces dos entradas exportan la misma clase: `newt/contract` reexporta las partes de
`newt/core` que puede cargar un navegador ([capítulo 23](./23-frontends)), y cada
adaptador reexporta `SqlTable`. En un esquema, importa un objeto de valor o la clase
base de un error de `newt/contract`; en cualquier otro sitio, de cualquiera de las dos.

## `newt/core`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `Module` | valor | [2](./02-first-module), [3](./03-pages-and-errors), [4](./04-who-and-where), [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [10](./10-events), [11](./11-reacting), [12](./12-failures), [14](./14-sagas), [15](./15-kysely), [16](./16-search-port), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [20](./20-wiring-contexts), [22](./22-web-session), [25](./25-backoffice), [26](./26-dead-jobs-and-analytics) | [B](./b-module-anatomy), [C](./c-common-problems), [H](./h-describe-application) |
| `Ref` | tipo |   | — |
| `RefFinder` | tipo |   | — |
| `Entity` | valor | [2](./02-first-module), [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [10](./10-events), [11](./11-reacting), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [22](./22-web-session) | [B](./b-module-anatomy), [C](./c-common-problems) |
| `EntityInput` | tipo | [2](./02-first-module), [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [10](./10-events), [11](./11-reacting), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [22](./22-web-session) |   |
| `EntitySchema` | tipo |   | — |
| `InvalidEntity` | valor |   | [3](./03-pages-and-errors) |
| `UseCase` | valor | [2](./02-first-module), [3](./03-pages-and-errors), [4](./04-who-and-where), [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [10](./10-events), [11](./11-reacting), [12](./12-failures), [14](./14-sagas), [15](./15-kysely), [16](./16-search-port), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [20](./20-wiring-contexts), [22](./22-web-session), [25](./25-backoffice), [26](./26-dead-jobs-and-analytics) | [1](./01-project-and-context), [8](./08-two-people-one-card), [29](./29-shipping), [B](./b-module-anatomy), [C](./c-common-problems), [F](./f-aggregates) |
| `UseCaseOptions` | tipo |   | [8](./08-two-people-one-card), [17](./17-auth) |
| `WriteRule` | tipo |   | [14](./14-sagas) |
| `GuardRule` | tipo |   | [6](./06-rules-over-rows) |
| `Invocations` | tipo |   | — |
| `Actor` | tipo | [17](./17-auth), [19](./19-invitations-and-time), [22](./22-web-session) | [4](./04-who-and-where), [10](./10-events), [C](./c-common-problems) |
| `currentActor` | valor | [4](./04-who-and-where), [10](./10-events), [15](./15-kysely), [16](./16-search-port), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [20](./20-wiring-contexts), [22](./22-web-session), [25](./25-backoffice) | [13](./13-another-context), [21](./21-oauth-server), [24](./24-mcp-server), [C](./c-common-problems) |
| `findCurrentActor` | valor |   | [4](./04-who-and-where), [21](./21-oauth-server), [C](./c-common-problems) |
| `runAsActor` | valor | [4](./04-who-and-where), [5](./05-sqlite), [10](./10-events), [12](./12-failures), [16](./16-search-port), [18](./18-tenants-and-access), [20](./20-wiring-contexts), [21](./21-oauth-server), [25](./25-backoffice), [27](./27-postgres), [28](./28-observability) | [24](./24-mcp-server), [C](./c-common-problems) |
| `NoActor` | valor |   | [4](./04-who-and-where), [21](./21-oauth-server), [C](./c-common-problems) |
| `defineScope` | valor | [4](./04-who-and-where) |   |
| `Scope` | tipo |   | [4](./04-who-and-where) |
| `Clock` | tipo | [19](./19-invitations-and-time), [20](./20-wiring-contexts), [21](./21-oauth-server), [22](./22-web-session), [25](./25-backoffice), [27](./27-postgres), [28](./28-observability) |   |
| `systemClock` | valor |   | [19](./19-invitations-and-time) |
| `now` | valor | [10](./10-events), [13](./13-another-context), [14](./14-sagas), [16](./16-search-port), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [21](./21-oauth-server), [22](./22-web-session), [26](./26-dead-jobs-and-analytics), [B](./b-module-anatomy) | [2](./02-first-module), [4](./04-who-and-where), [20](./20-wiring-contexts), [27](./27-postgres), [29](./29-shipping), [C](./c-common-problems), [D](./d-writing-a-store) |
| `DomainError` | valor | [21](./21-oauth-server), [22](./22-web-session) | [3](./03-pages-and-errors), [23](./23-frontends), [28](./28-observability) |
| `ErrorBody` | tipo |   | [3](./03-pages-and-errors), [23](./23-frontends), [B](./b-module-anatomy), [C](./c-common-problems) |
| `ValidationError` | valor | [7](./07-cards-and-a-counter), [22](./22-web-session) | [2](./02-first-module), [3](./03-pages-and-errors), [23](./23-frontends) |
| `UnauthorizedError` | valor | [17](./17-auth), [22](./22-web-session) | [3](./03-pages-and-errors), [23](./23-frontends) |
| `ForbiddenError` | valor | [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [22](./22-web-session), [25](./25-backoffice) | [3](./03-pages-and-errors), [23](./23-frontends) |
| `NotFoundError` | valor | [2](./02-first-module), [4](./04-who-and-where), [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [12](./12-failures), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [25](./25-backoffice) | [3](./03-pages-and-errors), [23](./23-frontends) |
| `ConflictError` | valor | [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [8](./08-two-people-one-card), [12](./12-failures), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time) | [3](./03-pages-and-errors), [9](./09-idempotent-posts), [23](./23-frontends) |
| `ConcurrencyConflict` | valor | [3](./03-pages-and-errors), [D](./d-writing-a-store) | [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [8](./08-two-people-one-card), [14](./14-sagas), [18](./18-tenants-and-access), [22](./22-web-session), [27](./27-postgres), [C](./c-common-problems), [F](./f-aggregates) |
| `DuplicateValue` | valor | [3](./03-pages-and-errors), [18](./18-tenants-and-access), [D](./d-writing-a-store) | [6](./06-rules-over-rows), [11](./11-reacting), [14](./14-sagas), [17](./17-auth), [C](./c-common-problems), [F](./f-aggregates) |
| `ReferenceNotFound` | valor | [3](./03-pages-and-errors) | [18](./18-tenants-and-access) |
| `Messages` | tipo | [3](./03-pages-and-errors) |   |
| `setMessages` | valor | [3](./03-pages-and-errors) | [9](./09-idempotent-posts), [23](./23-frontends), [C](./c-common-problems) |
| `DomainEvent` | tipo | [10](./10-events), [13](./13-another-context), [14](./14-sagas), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [21](./21-oauth-server) |   |
| `Json` | tipo |   | [10](./10-events) |
| `DomainEventClass` | tipo |   | — |
| `DomainEventEmitter` | valor |   | [10](./10-events) |
| `EventSource` | tipo | [13](./13-another-context), [14](./14-sagas), [20](./20-wiring-contexts) |   |
| `Subscription` | tipo |   | [10](./10-events) |
| `eventsOf` | valor | [10](./10-events), [13](./13-another-context), [14](./14-sagas), [15](./15-kysely), [16](./16-search-port), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time) | [B](./b-module-anatomy) |
| `EmittersOf` | tipo |   | [10](./10-events) |
| `EventBus` | tipo |   | — |
| `EventHandler` | tipo |   | [10](./10-events), [11](./11-reacting) |
| `EventMeta` | tipo | [11](./11-reacting) | [12](./12-failures), [C](./c-common-problems) |
| `EventPublisher` | tipo |   | — |
| `SubscribeOptions` | tipo |   | [10](./10-events), [11](./11-reacting), [12](./12-failures) |
| `Criteria` | tipo | [15](./15-kysely), [16](./16-search-port), [B](./b-module-anatomy), [D](./d-writing-a-store) |   |
| `Condition` | tipo |   | — |
| `Operator` | tipo |   | — |
| `allOf` | valor |   | — |
| `isCondition` | valor |   | — |
| `CriteriaNode` | tipo |   | [D](./d-writing-a-store) |
| `criteriaTree` | valor |   | [16](./16-search-port), [D](./d-writing-a-store) |
| `matches` | valor | [16](./16-search-port), [D](./d-writing-a-store) |   |
| `compare` | valor | [D](./d-writing-a-store) |   |
| `defineFilter` | valor |   | [15](./15-kysely), [18](./18-tenants-and-access), [23](./23-frontends), [B](./b-module-anatomy) |
| `FilterLimits` | tipo |   | [23](./23-frontends) |
| `Filter` | tipo |   | [23](./23-frontends) |
| `FilterField` | tipo |   | [23](./23-frontends) |
| `FilterNode` | tipo |   | [23](./23-frontends) |
| `Page` | tipo | [3](./03-pages-and-errors), [4](./04-who-and-where), [10](./10-events), [11](./11-reacting), [12](./12-failures), [15](./15-kysely), [16](./16-search-port), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [24](./24-mcp-server), [25](./25-backoffice), [26](./26-dead-jobs-and-analytics) | [20](./20-wiring-contexts), [23](./23-frontends), [B](./b-module-anatomy) |
| `PageRequest` | tipo | [3](./03-pages-and-errors), [4](./04-who-and-where), [10](./10-events), [11](./11-reacting), [12](./12-failures), [15](./15-kysely), [16](./16-search-port), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [24](./24-mcp-server), [25](./25-backoffice), [26](./26-dead-jobs-and-analytics) | [20](./20-wiring-contexts), [23](./23-frontends), [B](./b-module-anatomy) |
| `toPage` | valor | [12](./12-failures), [15](./15-kysely), [16](./16-search-port) |   |
| `mapPage` | valor | [3](./03-pages-and-errors), [4](./04-who-and-where), [10](./10-events), [11](./11-reacting), [15](./15-kysely), [16](./16-search-port), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [24](./24-mcp-server), [25](./25-backoffice) |   |
| `allPages` | valor | [16](./16-search-port), [20](./20-wiring-contexts) |   |
| `ValueObject` | tipo |   | [2](./02-first-module), [23](./23-frontends) |
| `Email` | valor | [12](./12-failures), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [20](./20-wiring-contexts) | [23](./23-frontends) |
| `InvalidEmail` | valor |   | [23](./23-frontends) |
| `SecretToken` | valor | [17](./17-auth), [19](./19-invitations-and-time), [22](./22-web-session) | [21](./21-oauth-server), [23](./23-frontends) |
| `InvalidSecretToken` | valor |   | [23](./23-frontends) |
| `Tracer` | tipo | [28](./28-observability) |   |
| `Span` | tipo | [28](./28-observability) |   |
| `SpanAttributes` | tipo | [28](./28-observability) |   |
| `NoopTracer` | valor | [28](./28-observability) |   |
| `setTracer` | valor | [28](./28-observability) |   |
| `filterSpans` | valor | [28](./28-observability) |   |

## `newt/contract`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `DomainError` | valor |   | [3](./03-pages-and-errors), [21](./21-oauth-server), [22](./22-web-session), [23](./23-frontends), [28](./28-observability) |
| `ValidationError` | valor | [2](./02-first-module) | [3](./03-pages-and-errors), [22](./22-web-session), [23](./23-frontends) |
| `UnauthorizedError` | valor |   | [3](./03-pages-and-errors), [17](./17-auth), [22](./22-web-session), [23](./23-frontends) |
| `ForbiddenError` | valor |   | [3](./03-pages-and-errors), [22](./22-web-session), [23](./23-frontends), [25](./25-backoffice) |
| `NotFoundError` | valor |   | [2](./02-first-module), [3](./03-pages-and-errors), [18](./18-tenants-and-access), [23](./23-frontends) |
| `ConflictError` | valor |   | [3](./03-pages-and-errors), [6](./06-rules-over-rows), [9](./09-idempotent-posts), [17](./17-auth), [23](./23-frontends) |
| `ValueObject` | tipo | [2](./02-first-module) | [23](./23-frontends) |
| `Email` | valor | [4](./04-who-and-where), [13](./13-another-context), [14](./14-sagas), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [20](./20-wiring-contexts) | [12](./12-failures), [23](./23-frontends) |
| `InvalidEmail` | valor |   | [23](./23-frontends) |
| `SecretToken` | valor |   | [17](./17-auth), [19](./19-invitations-and-time), [21](./21-oauth-server), [22](./22-web-session), [23](./23-frontends) |
| `InvalidSecretToken` | valor |   | [23](./23-frontends) |
| `defineFilter` | valor | [15](./15-kysely), [18](./18-tenants-and-access) | [23](./23-frontends), [B](./b-module-anatomy) |
| `FilterLimits` | tipo |   | [23](./23-frontends) |
| `Filter` | tipo |   | [23](./23-frontends) |
| `FilterField` | tipo |   | [23](./23-frontends) |
| `FilterNode` | tipo |   | [23](./23-frontends) |
| `Page` | tipo | [23](./23-frontends), [26](./26-dead-jobs-and-analytics) | [3](./03-pages-and-errors), [15](./15-kysely), [20](./20-wiring-contexts), [24](./24-mcp-server), [B](./b-module-anatomy) |
| `PageRequest` | tipo |   | [3](./03-pages-and-errors), [15](./15-kysely), [16](./16-search-port), [20](./20-wiring-contexts), [23](./23-frontends), [B](./b-module-anatomy) |
| `ErrorBody` | tipo | [23](./23-frontends) | [3](./03-pages-and-errors), [B](./b-module-anatomy), [C](./c-common-problems) |

## `newt/port-store`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `Store` | tipo | [D](./d-writing-a-store) | [1](./01-project-and-context), [23](./23-frontends) |
| `Table` | tipo | [D](./d-writing-a-store) | [7](./07-cards-and-a-counter) |
| `TableOptions` | tipo | [D](./d-writing-a-store) |   |
| `FieldType` | tipo |   | — |
| `FindOptions` | tipo | [D](./d-writing-a-store) |   |
| `NewRow` | tipo | [D](./d-writing-a-store) |   |
| `StoredRow` | tipo | [D](./d-writing-a-store) |   |
| `Migrations` | tipo | [D](./d-writing-a-store) |   |
| `MigrationStatus` | tipo | [D](./d-writing-a-store) | [27](./27-postgres) |
| `migrationName` | valor |   | [D](./d-writing-a-store) |
| `migrationChecksum` | valor |   | [D](./d-writing-a-store) |
| `TransactionScope` | valor | [D](./d-writing-a-store) |   |
| `noteRead` | valor | [D](./d-writing-a-store) |   |

## `newt/port-store/contract`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `describeStoreContract` | valor | [D](./d-writing-a-store) | [16](./16-search-port), [26](./26-dead-jobs-and-analytics) |
| `StoreFixture` | tipo |   | [D](./d-writing-a-store) |
| `ThingRow` | tipo |   | [D](./d-writing-a-store) |

## `newt/port-outbox`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `Outbox` | tipo | [D](./d-writing-a-store) | [12](./12-failures), [26](./26-dead-jobs-and-analytics) |
| `Job` | tipo | [12](./12-failures), [D](./d-writing-a-store) |   |
| `JobClosing` | tipo | [D](./d-writing-a-store) |   |
| `JobQuery` | tipo | [D](./d-writing-a-store) | [26](./26-dead-jobs-and-analytics) |
| `JobQueueRegistration` | tipo | [D](./d-writing-a-store) |   |
| `isSameClaim` | valor | [D](./d-writing-a-store) |   |

## `newt/port-analytics`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `Analytics` | tipo | [26](./26-dead-jobs-and-analytics) |   |
| `AnalyticsRow` | tipo | [26](./26-dead-jobs-and-analytics) |   |

## `newt/port-analytics/contract`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `describeAnalyticsContract` | valor | [26](./26-dead-jobs-and-analytics), [27](./27-postgres) |   |
| `AnalyticsFixture` | tipo |   | — |
| `MemoryAnalytics` | valor |   | [26](./26-dead-jobs-and-analytics) |

## `newt/repository`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `Repository` | valor |   | [6](./06-rules-over-rows), [F](./f-aggregates) |
| `RepositoryBase` | tipo |   | — |
| `SaveHooks` | tipo |   | [6](./06-rules-over-rows), [7](./07-cards-and-a-counter) |
| `TableRepository` | valor | [2](./02-first-module), [4](./04-who-and-where), [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [11](./11-reacting), [15](./15-kysely), [16](./16-search-port), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [22](./22-web-session) | [3](./03-pages-and-errors), [8](./08-two-people-one-card), [14](./14-sagas), [B](./b-module-anatomy), [C](./c-common-problems), [D](./d-writing-a-store) |
| `RepositoryScope` | tipo |   | [2](./02-first-module), [4](./04-who-and-where), [B](./b-module-anatomy) |
| `TableRepositoryOptions` | tipo |   | [2](./02-first-module), [4](./04-who-and-where), [C](./c-common-problems) |

## `newt/runtime`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `Base` | valor | [1](./01-project-and-context), [4](./04-who-and-where), [5](./05-sqlite), [13](./13-another-context), [14](./14-sagas), [20](./20-wiring-contexts), [27](./27-postgres) | [6](./06-rules-over-rows), [12](./12-failures), [19](./19-invitations-and-time), [28](./28-observability), [D](./d-writing-a-store) |
| `BaseOptions` | tipo |   | [1](./01-project-and-context), [19](./19-invitations-and-time) |
| `BoundedContext` | valor | [1](./01-project-and-context), [21](./21-oauth-server), [23](./23-frontends) |   |
| `JobQueue` | tipo |   | [11](./11-reacting), [14](./14-sagas), [D](./d-writing-a-store) |
| `JobQueueOptions` | tipo |   | — |
| `Schedules` | tipo |   | [19](./19-invitations-and-time) |
| `ScheduleTick` | tipo |   | [19](./19-invitations-and-time) |
| `describeApplication` | valor |   | [H](./h-describe-application) |
| `ApplicationDescription` | tipo |   | [H](./h-describe-application) |
| `ContextDescription` | tipo |   | [H](./h-describe-application) |
| `ModuleDescription` | tipo |   | [H](./h-describe-application) |
| `UseCaseDescription` | tipo |   | [H](./h-describe-application) |
| `EventDescription` | tipo |   | [H](./h-describe-application) |
| `ModuleDependency` | tipo |   | [H](./h-describe-application) |
| `SubscriptionDescription` | tipo |   | [H](./h-describe-application) |

## `newt/sql`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `SqlDialect` | tipo |   | [D](./d-writing-a-store) |
| `SqlExecutor` | tipo |   | — |
| `SqlTable` | valor |   | [D](./d-writing-a-store) |
| `SqlTableOptions` | tipo |   | — |
| `splitStatements` | valor |   | [D](./d-writing-a-store) |
| `SqlStore` | valor |   | [D](./d-writing-a-store) |
| `SqlStoreOptions` | tipo |   | — |
| `SqlServerDialect` | tipo |   | — |
| `SqlOutbox` | valor |   | [D](./d-writing-a-store) |
| `SqlMigrationRunner` | valor |   | [D](./d-writing-a-store) |
| `errorCode` | valor |   | — |

## `newt/adapter-sqlite`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `SqliteStore` | valor | [5](./05-sqlite), [13](./13-another-context), [14](./14-sagas), [17](./17-auth), [19](./19-invitations-and-time), [21](./21-oauth-server), [22](./22-web-session), [25](./25-backoffice), [26](./26-dead-jobs-and-analytics), [27](./27-postgres) | [11](./11-reacting), [C](./c-common-problems), [D](./d-writing-a-store) |
| `SqliteStoreOptions` | tipo |   | [5](./05-sqlite) |
| `SqliteTable` | valor |   | — |
| `SqliteTableOptions` | tipo |   | — |
| `SqliteOutbox` | valor |   | — |
| `MigrationRunner` | valor |   | — |

## `newt/adapter-postgres`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `PostgresStore` | valor | [27](./27-postgres) | [D](./d-writing-a-store) |
| `PostgresStoreOptions` | tipo |   | — |
| `SqlTable` | valor |   | [D](./d-writing-a-store) |

## `newt/adapter-mysql`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `MySqlStore` | valor |   | [27](./27-postgres), [D](./d-writing-a-store) |
| `MySqlStoreOptions` | tipo |   | — |
| `SqlTable` | valor |   | [D](./d-writing-a-store) |

## `newt/adapter-files`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `FileStore` | valor | [1](./01-project-and-context), [4](./04-who-and-where) | [5](./05-sqlite), [27](./27-postgres), [D](./d-writing-a-store) |
| `FileStoreOptions` | tipo |   | — |
| `FileTable` | valor |   | — |
| `FileCollection` | valor |   | — |
| `FileRecord` | tipo |   | — |
| `FileOutbox` | valor |   | — |
| `FileMigration` | tipo |   | — |
| `FileMigrations` | valor |   | — |

## `newt/kysely`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `kyselyFor` | valor | [15](./15-kysely), [26](./26-dead-jobs-and-analytics), [27](./27-postgres) |   |
| `whereOf` | valor | [15](./15-kysely), [16](./16-search-port) |   |
| `SqliteRow` | tipo | [15](./15-kysely) |   |

## `newt/http`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `HttpRouter` | valor | [1](./01-project-and-context), [4](./04-who-and-where), [5](./05-sqlite), [21](./21-oauth-server), [24](./24-mcp-server), [27](./27-postgres) |   |
| `HttpRouterOptions` | tipo |   | [21](./21-oauth-server) |
| `HttpRoute` | tipo |   | — |
| `HttpMethod` | tipo |   | — |
| `RouteOptions` | tipo | [21](./21-oauth-server) | [24](./24-mcp-server) |
| `Cors` | tipo | [21](./21-oauth-server) |   |
| `Authenticator` | tipo |   | [2](./02-first-module), [22](./22-web-session) |
| `bearerAuthenticator` | valor | [24](./24-mcp-server) |   |
| `ErrorHandler` | tipo |   | [21](./21-oauth-server) |
| `Idempotency` | tipo |   | [9](./09-idempotent-posts), [23](./23-frontends), [27](./27-postgres), [29](./29-shipping), [C](./c-common-problems) |
| `KeptAnswer` | tipo | [9](./09-idempotent-posts), [15](./15-kysely) | [27](./27-postgres) |
| `IdempotencyKeyInUse` | valor |   | [9](./09-idempotent-posts) |
| `IdempotencyKeyReused` | valor |   | [9](./09-idempotent-posts) |
| `serve` | valor | [1](./01-project-and-context), [2](./02-first-module), [3](./03-pages-and-errors), [4](./04-who-and-where), [5](./05-sqlite), [12](./12-failures), [17](./17-auth), [18](./18-tenants-and-access), [20](./20-wiring-contexts), [22](./22-web-session), [25](./25-backoffice) | [0](./00-introduction), [21](./21-oauth-server), [23](./23-frontends), [28](./28-observability), [29](./29-shipping) |
| `ServeOptions` | tipo | [1](./01-project-and-context), [21](./21-oauth-server), [23](./23-frontends) |   |
| `serveFrontend` | valor |   | — |
| `handle` | valor |   | — |
| `toErrorResponse` | valor | [3](./03-pages-and-errors), [21](./21-oauth-server), [24](./24-mcp-server) |   |
| `toOauthErrorResponse` | valor | [21](./21-oauth-server) | [24](./24-mcp-server) |
| `pageRequestFrom` | valor | [3](./03-pages-and-errors), [4](./04-who-and-where), [11](./11-reacting), [15](./15-kysely), [25](./25-backoffice), [26](./26-dead-jobs-and-analytics) | [16](./16-search-port), [23](./23-frontends) |
| `ApiRouteNotFound` | valor | [3](./03-pages-and-errors) |   |
| `MethodNotAllowed` | valor |   | — |
| `NotSignedIn` | valor | [3](./03-pages-and-errors), [24](./24-mcp-server) |   |
| `MalformedBody` | valor |   | [3](./03-pages-and-errors) |
| `UnsupportedMediaType` | valor |   | — |
| `HttpGroup` | valor |   | [4](./04-who-and-where) |
| `Middleware` | tipo |   | [4](./04-who-and-where) |

## `newt/application`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `runContexts` | valor | [17](./17-auth), [20](./20-wiring-contexts), [22](./22-web-session), [28](./28-observability), [29](./29-shipping) | [1](./01-project-and-context), [21](./21-oauth-server), [23](./23-frontends), [C](./c-common-problems) |
| `ContextToRun` | tipo |   | — |
| `RunContextsOptions` | tipo |   | [28](./28-observability) |
| `RunningContexts` | tipo |   | — |

## `newt/otel`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `OtlpTracer` | valor | [28](./28-observability) |   |
| `OtlpTracerOptions` | tipo |   | — |

## `newt/monitor`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `serveMonitor` | valor |   | [H](./h-describe-application) |
| `signMonitorRequest` | valor |   | [H](./h-describe-application) |
| `MonitorOptions` | tipo |   | — |
| `MonitorIdentity` | tipo |   | [H](./h-describe-application) |

## `newt/testing`

| Export | Tipo | Se importa en | También en |
|---|---|---|---|
| `freePort` | valor | [20](./20-wiring-contexts), [22](./22-web-session), [25](./25-backoffice) | [21](./21-oauth-server) |
| `browser` | valor | [20](./20-wiring-contexts), [22](./22-web-session), [25](./25-backoffice) | [21](./21-oauth-server), [24](./24-mcp-server), [29](./29-shipping), [C](./c-common-problems) |
| `Browser` | tipo | [20](./20-wiring-contexts), [25](./25-backoffice) |   |
| `BrowserRequest` | tipo |   | — |
