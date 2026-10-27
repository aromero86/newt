# E. Index of newt's exports

Every export of every entry of newt (the `exports` of `packages/newt/package.json`),
and where the tutorial teaches it. **Imported in** lists the chapters whose code
imports it from that entry; **Also in** the chapters and appendices that name it, or
teach it under the name you use it by (`base.http.group` is `HttpGroup`,
`base.jobs` is `JobQueue`). A dash marks an export no chapter teaches: what it is
for is in its doc comment, and in the [reference](../reference/rules).

The same class is sometimes exported by two entries: `newt/contract` re-exports the
parts of `newt/core` a browser may load ([chapter 23](./23-frontends)), and each
adapter re-exports `SqlTable`. Import a value object or an error's base class from
`newt/contract` in a schema, from either elsewhere.

## `newt/core`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `Module` | value | [2](./02-first-module), [3](./03-pages-and-errors), [4](./04-who-and-where), [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [10](./10-events), [11](./11-reacting), [12](./12-failures), [14](./14-sagas), [15](./15-kysely), [16](./16-search-port), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [20](./20-wiring-contexts), [22](./22-web-session), [25](./25-backoffice), [26](./26-dead-jobs-and-analytics) | [B](./b-module-anatomy), [C](./c-common-problems), [H](./h-describe-application) |
| `Ref` | type |   | — |
| `RefFinder` | type |   | — |
| `Entity` | value | [2](./02-first-module), [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [10](./10-events), [11](./11-reacting), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [22](./22-web-session) | [B](./b-module-anatomy), [C](./c-common-problems) |
| `EntityInput` | type | [2](./02-first-module), [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [10](./10-events), [11](./11-reacting), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [22](./22-web-session) |   |
| `EntitySchema` | type |   | — |
| `InvalidEntity` | value |   | [3](./03-pages-and-errors) |
| `UseCase` | value | [2](./02-first-module), [3](./03-pages-and-errors), [4](./04-who-and-where), [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [10](./10-events), [11](./11-reacting), [12](./12-failures), [14](./14-sagas), [15](./15-kysely), [16](./16-search-port), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [20](./20-wiring-contexts), [22](./22-web-session), [25](./25-backoffice), [26](./26-dead-jobs-and-analytics) | [1](./01-project-and-context), [8](./08-two-people-one-card), [29](./29-shipping), [B](./b-module-anatomy), [C](./c-common-problems), [F](./f-aggregates) |
| `UseCaseOptions` | type |   | [8](./08-two-people-one-card), [17](./17-auth) |
| `WriteRule` | type |   | [14](./14-sagas) |
| `GuardRule` | type |   | [6](./06-rules-over-rows) |
| `Invocations` | type |   | — |
| `Actor` | type | [17](./17-auth), [19](./19-invitations-and-time), [22](./22-web-session) | [4](./04-who-and-where), [10](./10-events), [C](./c-common-problems) |
| `currentActor` | value | [4](./04-who-and-where), [10](./10-events), [15](./15-kysely), [16](./16-search-port), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [20](./20-wiring-contexts), [22](./22-web-session), [25](./25-backoffice) | [13](./13-another-context), [21](./21-oauth-server), [24](./24-mcp-server), [C](./c-common-problems) |
| `findCurrentActor` | value |   | [4](./04-who-and-where), [21](./21-oauth-server), [C](./c-common-problems) |
| `runAsActor` | value | [4](./04-who-and-where), [5](./05-sqlite), [10](./10-events), [12](./12-failures), [16](./16-search-port), [18](./18-tenants-and-access), [20](./20-wiring-contexts), [21](./21-oauth-server), [25](./25-backoffice), [27](./27-postgres), [28](./28-observability) | [24](./24-mcp-server), [C](./c-common-problems) |
| `NoActor` | value |   | [4](./04-who-and-where), [21](./21-oauth-server), [C](./c-common-problems) |
| `defineScope` | value | [4](./04-who-and-where) |   |
| `Scope` | type |   | [4](./04-who-and-where) |
| `Clock` | type | [19](./19-invitations-and-time), [20](./20-wiring-contexts), [21](./21-oauth-server), [22](./22-web-session), [25](./25-backoffice), [27](./27-postgres), [28](./28-observability) |   |
| `systemClock` | value |   | [19](./19-invitations-and-time) |
| `now` | value | [10](./10-events), [13](./13-another-context), [14](./14-sagas), [16](./16-search-port), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [21](./21-oauth-server), [22](./22-web-session), [26](./26-dead-jobs-and-analytics), [B](./b-module-anatomy) | [2](./02-first-module), [4](./04-who-and-where), [20](./20-wiring-contexts), [27](./27-postgres), [29](./29-shipping), [C](./c-common-problems), [D](./d-writing-a-store) |
| `DomainError` | value | [21](./21-oauth-server), [22](./22-web-session) | [3](./03-pages-and-errors), [23](./23-frontends), [28](./28-observability) |
| `ErrorBody` | type |   | [3](./03-pages-and-errors), [23](./23-frontends), [B](./b-module-anatomy), [C](./c-common-problems) |
| `ValidationError` | value | [7](./07-cards-and-a-counter), [22](./22-web-session) | [2](./02-first-module), [3](./03-pages-and-errors), [23](./23-frontends) |
| `UnauthorizedError` | value | [17](./17-auth), [22](./22-web-session) | [3](./03-pages-and-errors), [23](./23-frontends) |
| `ForbiddenError` | value | [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [22](./22-web-session), [25](./25-backoffice) | [3](./03-pages-and-errors), [23](./23-frontends) |
| `NotFoundError` | value | [2](./02-first-module), [4](./04-who-and-where), [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [12](./12-failures), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [25](./25-backoffice) | [3](./03-pages-and-errors), [23](./23-frontends) |
| `ConflictError` | value | [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [8](./08-two-people-one-card), [12](./12-failures), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time) | [3](./03-pages-and-errors), [9](./09-idempotent-posts), [23](./23-frontends) |
| `ConcurrencyConflict` | value | [3](./03-pages-and-errors), [D](./d-writing-a-store) | [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [8](./08-two-people-one-card), [14](./14-sagas), [18](./18-tenants-and-access), [22](./22-web-session), [27](./27-postgres), [C](./c-common-problems), [F](./f-aggregates) |
| `DuplicateValue` | value | [3](./03-pages-and-errors), [18](./18-tenants-and-access), [D](./d-writing-a-store) | [6](./06-rules-over-rows), [11](./11-reacting), [14](./14-sagas), [17](./17-auth), [C](./c-common-problems), [F](./f-aggregates) |
| `ReferenceNotFound` | value | [3](./03-pages-and-errors) | [18](./18-tenants-and-access) |
| `Messages` | type | [3](./03-pages-and-errors) |   |
| `setMessages` | value | [3](./03-pages-and-errors) | [9](./09-idempotent-posts), [23](./23-frontends), [C](./c-common-problems) |
| `DomainEvent` | type | [10](./10-events), [13](./13-another-context), [14](./14-sagas), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [21](./21-oauth-server) |   |
| `Json` | type |   | [10](./10-events) |
| `DomainEventClass` | type |   | — |
| `DomainEventEmitter` | value |   | [10](./10-events) |
| `EventSource` | type | [13](./13-another-context), [14](./14-sagas), [20](./20-wiring-contexts) |   |
| `Subscription` | type |   | [10](./10-events) |
| `eventsOf` | value | [10](./10-events), [13](./13-another-context), [14](./14-sagas), [15](./15-kysely), [16](./16-search-port), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time) | [B](./b-module-anatomy) |
| `EmittersOf` | type |   | [10](./10-events) |
| `EventBus` | type |   | — |
| `EventHandler` | type |   | [10](./10-events), [11](./11-reacting) |
| `EventMeta` | type | [11](./11-reacting) | [12](./12-failures), [C](./c-common-problems) |
| `EventPublisher` | type |   | — |
| `SubscribeOptions` | type |   | [10](./10-events), [11](./11-reacting), [12](./12-failures) |
| `Criteria` | type | [15](./15-kysely), [16](./16-search-port), [B](./b-module-anatomy), [D](./d-writing-a-store) |   |
| `Condition` | type |   | — |
| `Operator` | type |   | — |
| `allOf` | value |   | — |
| `isCondition` | value |   | — |
| `CriteriaNode` | type |   | [D](./d-writing-a-store) |
| `criteriaTree` | value |   | [16](./16-search-port), [D](./d-writing-a-store) |
| `matches` | value | [16](./16-search-port), [D](./d-writing-a-store) |   |
| `compare` | value | [D](./d-writing-a-store) |   |
| `defineFilter` | value |   | [15](./15-kysely), [18](./18-tenants-and-access), [23](./23-frontends), [B](./b-module-anatomy) |
| `FilterLimits` | type |   | [23](./23-frontends) |
| `Filter` | type |   | [23](./23-frontends) |
| `FilterField` | type |   | [23](./23-frontends) |
| `FilterNode` | type |   | [23](./23-frontends) |
| `Page` | type | [3](./03-pages-and-errors), [4](./04-who-and-where), [10](./10-events), [11](./11-reacting), [12](./12-failures), [15](./15-kysely), [16](./16-search-port), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [24](./24-mcp-server), [25](./25-backoffice), [26](./26-dead-jobs-and-analytics) | [20](./20-wiring-contexts), [23](./23-frontends), [B](./b-module-anatomy) |
| `PageRequest` | type | [3](./03-pages-and-errors), [4](./04-who-and-where), [10](./10-events), [11](./11-reacting), [12](./12-failures), [15](./15-kysely), [16](./16-search-port), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [24](./24-mcp-server), [25](./25-backoffice), [26](./26-dead-jobs-and-analytics) | [20](./20-wiring-contexts), [23](./23-frontends), [B](./b-module-anatomy) |
| `toPage` | value | [12](./12-failures), [15](./15-kysely), [16](./16-search-port) |   |
| `mapPage` | value | [3](./03-pages-and-errors), [4](./04-who-and-where), [10](./10-events), [11](./11-reacting), [15](./15-kysely), [16](./16-search-port), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [24](./24-mcp-server), [25](./25-backoffice) |   |
| `allPages` | value | [16](./16-search-port), [20](./20-wiring-contexts) |   |
| `ValueObject` | type |   | [2](./02-first-module), [23](./23-frontends) |
| `Email` | value | [12](./12-failures), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [20](./20-wiring-contexts) | [23](./23-frontends) |
| `InvalidEmail` | value |   | [23](./23-frontends) |
| `SecretToken` | value | [17](./17-auth), [19](./19-invitations-and-time), [22](./22-web-session) | [21](./21-oauth-server), [23](./23-frontends) |
| `InvalidSecretToken` | value |   | [23](./23-frontends) |
| `Tracer` | type | [28](./28-observability) |   |
| `Span` | type | [28](./28-observability) |   |
| `SpanAttributes` | type | [28](./28-observability) |   |
| `NoopTracer` | value | [28](./28-observability) |   |
| `setTracer` | value | [28](./28-observability) |   |
| `filterSpans` | value | [28](./28-observability) |   |

## `newt/contract`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `DomainError` | value |   | [3](./03-pages-and-errors), [21](./21-oauth-server), [22](./22-web-session), [23](./23-frontends), [28](./28-observability) |
| `ValidationError` | value | [2](./02-first-module) | [3](./03-pages-and-errors), [22](./22-web-session), [23](./23-frontends) |
| `UnauthorizedError` | value |   | [3](./03-pages-and-errors), [17](./17-auth), [22](./22-web-session), [23](./23-frontends) |
| `ForbiddenError` | value |   | [3](./03-pages-and-errors), [22](./22-web-session), [23](./23-frontends), [25](./25-backoffice) |
| `NotFoundError` | value |   | [2](./02-first-module), [3](./03-pages-and-errors), [18](./18-tenants-and-access), [23](./23-frontends) |
| `ConflictError` | value |   | [3](./03-pages-and-errors), [6](./06-rules-over-rows), [9](./09-idempotent-posts), [17](./17-auth), [23](./23-frontends) |
| `ValueObject` | type | [2](./02-first-module) | [23](./23-frontends) |
| `Email` | value | [4](./04-who-and-where), [13](./13-another-context), [14](./14-sagas), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [20](./20-wiring-contexts) | [12](./12-failures), [23](./23-frontends) |
| `InvalidEmail` | value |   | [23](./23-frontends) |
| `SecretToken` | value |   | [17](./17-auth), [19](./19-invitations-and-time), [21](./21-oauth-server), [22](./22-web-session), [23](./23-frontends) |
| `InvalidSecretToken` | value |   | [23](./23-frontends) |
| `defineFilter` | value | [15](./15-kysely), [18](./18-tenants-and-access) | [23](./23-frontends), [B](./b-module-anatomy) |
| `FilterLimits` | type |   | [23](./23-frontends) |
| `Filter` | type |   | [23](./23-frontends) |
| `FilterField` | type |   | [23](./23-frontends) |
| `FilterNode` | type |   | [23](./23-frontends) |
| `Page` | type | [23](./23-frontends), [26](./26-dead-jobs-and-analytics) | [3](./03-pages-and-errors), [15](./15-kysely), [20](./20-wiring-contexts), [24](./24-mcp-server), [B](./b-module-anatomy) |
| `PageRequest` | type |   | [3](./03-pages-and-errors), [15](./15-kysely), [16](./16-search-port), [20](./20-wiring-contexts), [23](./23-frontends), [B](./b-module-anatomy) |
| `ErrorBody` | type | [23](./23-frontends) | [3](./03-pages-and-errors), [B](./b-module-anatomy), [C](./c-common-problems) |

## `newt/port-store`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `Store` | type | [D](./d-writing-a-store) | [1](./01-project-and-context), [23](./23-frontends) |
| `Table` | type | [D](./d-writing-a-store) | [7](./07-cards-and-a-counter) |
| `TableOptions` | type | [D](./d-writing-a-store) |   |
| `FieldType` | type |   | — |
| `FindOptions` | type | [D](./d-writing-a-store) |   |
| `NewRow` | type | [D](./d-writing-a-store) |   |
| `StoredRow` | type | [D](./d-writing-a-store) |   |
| `Migrations` | type | [D](./d-writing-a-store) |   |
| `MigrationStatus` | type | [D](./d-writing-a-store) | [27](./27-postgres) |
| `migrationName` | value |   | [D](./d-writing-a-store) |
| `migrationChecksum` | value |   | [D](./d-writing-a-store) |
| `TransactionScope` | value | [D](./d-writing-a-store) |   |
| `noteRead` | value | [D](./d-writing-a-store) |   |

## `newt/port-store/contract`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `describeStoreContract` | value | [D](./d-writing-a-store) | [16](./16-search-port), [26](./26-dead-jobs-and-analytics) |
| `StoreFixture` | type |   | [D](./d-writing-a-store) |
| `ThingRow` | type |   | [D](./d-writing-a-store) |

## `newt/port-outbox`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `Outbox` | type | [D](./d-writing-a-store) | [12](./12-failures), [26](./26-dead-jobs-and-analytics) |
| `Job` | type | [12](./12-failures), [D](./d-writing-a-store) |   |
| `JobClosing` | type | [D](./d-writing-a-store) |   |
| `JobQuery` | type | [D](./d-writing-a-store) | [26](./26-dead-jobs-and-analytics) |
| `JobQueueRegistration` | type | [D](./d-writing-a-store) |   |
| `isSameClaim` | value | [D](./d-writing-a-store) |   |

## `newt/port-analytics`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `Analytics` | type | [26](./26-dead-jobs-and-analytics) |   |
| `AnalyticsRow` | type | [26](./26-dead-jobs-and-analytics) |   |

## `newt/port-analytics/contract`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `describeAnalyticsContract` | value | [26](./26-dead-jobs-and-analytics), [27](./27-postgres) |   |
| `AnalyticsFixture` | type |   | — |
| `MemoryAnalytics` | value |   | [26](./26-dead-jobs-and-analytics) |

## `newt/repository`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `Repository` | value |   | [6](./06-rules-over-rows), [F](./f-aggregates) |
| `RepositoryBase` | type |   | — |
| `SaveHooks` | type |   | [6](./06-rules-over-rows), [7](./07-cards-and-a-counter) |
| `TableRepository` | value | [2](./02-first-module), [4](./04-who-and-where), [6](./06-rules-over-rows), [7](./07-cards-and-a-counter), [11](./11-reacting), [15](./15-kysely), [16](./16-search-port), [17](./17-auth), [18](./18-tenants-and-access), [19](./19-invitations-and-time), [22](./22-web-session) | [3](./03-pages-and-errors), [8](./08-two-people-one-card), [14](./14-sagas), [B](./b-module-anatomy), [C](./c-common-problems), [D](./d-writing-a-store) |
| `RepositoryScope` | type |   | [2](./02-first-module), [4](./04-who-and-where), [B](./b-module-anatomy) |
| `TableRepositoryOptions` | type |   | [2](./02-first-module), [4](./04-who-and-where), [C](./c-common-problems) |

## `newt/runtime`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `Base` | value | [1](./01-project-and-context), [4](./04-who-and-where), [5](./05-sqlite), [13](./13-another-context), [14](./14-sagas), [20](./20-wiring-contexts), [27](./27-postgres) | [6](./06-rules-over-rows), [12](./12-failures), [19](./19-invitations-and-time), [28](./28-observability), [D](./d-writing-a-store) |
| `BaseOptions` | type |   | [1](./01-project-and-context), [19](./19-invitations-and-time) |
| `BoundedContext` | value | [1](./01-project-and-context), [21](./21-oauth-server), [23](./23-frontends) |   |
| `JobQueue` | type |   | [11](./11-reacting), [14](./14-sagas), [D](./d-writing-a-store) |
| `JobQueueOptions` | type |   | — |
| `Schedules` | type |   | [19](./19-invitations-and-time) |
| `ScheduleTick` | type |   | [19](./19-invitations-and-time) |
| `describeApplication` | value |   | [H](./h-describe-application) |
| `ApplicationDescription` | type |   | [H](./h-describe-application) |
| `ContextDescription` | type |   | [H](./h-describe-application) |
| `ModuleDescription` | type |   | [H](./h-describe-application) |
| `UseCaseDescription` | type |   | [H](./h-describe-application) |
| `EventDescription` | type |   | [H](./h-describe-application) |
| `ModuleDependency` | type |   | [H](./h-describe-application) |
| `SubscriptionDescription` | type |   | [H](./h-describe-application) |

## `newt/sql`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `SqlDialect` | type |   | [D](./d-writing-a-store) |
| `SqlExecutor` | type |   | — |
| `SqlTable` | value |   | [D](./d-writing-a-store) |
| `SqlTableOptions` | type |   | — |
| `splitStatements` | value |   | [D](./d-writing-a-store) |
| `SqlStore` | value |   | [D](./d-writing-a-store) |
| `SqlStoreOptions` | type |   | — |
| `SqlServerDialect` | type |   | — |
| `SqlOutbox` | value |   | [D](./d-writing-a-store) |
| `SqlMigrationRunner` | value |   | [D](./d-writing-a-store) |
| `errorCode` | value |   | — |

## `newt/adapter-sqlite`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `SqliteStore` | value | [5](./05-sqlite), [13](./13-another-context), [14](./14-sagas), [17](./17-auth), [19](./19-invitations-and-time), [21](./21-oauth-server), [22](./22-web-session), [25](./25-backoffice), [26](./26-dead-jobs-and-analytics), [27](./27-postgres) | [11](./11-reacting), [C](./c-common-problems), [D](./d-writing-a-store) |
| `SqliteStoreOptions` | type |   | [5](./05-sqlite) |
| `SqliteTable` | value |   | — |
| `SqliteTableOptions` | type |   | — |
| `SqliteOutbox` | value |   | — |
| `MigrationRunner` | value |   | — |

## `newt/adapter-postgres`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `PostgresStore` | value | [27](./27-postgres) | [D](./d-writing-a-store) |
| `PostgresStoreOptions` | type |   | — |
| `SqlTable` | value |   | [D](./d-writing-a-store) |

## `newt/adapter-mysql`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `MySqlStore` | value |   | [27](./27-postgres), [D](./d-writing-a-store) |
| `MySqlStoreOptions` | type |   | — |
| `SqlTable` | value |   | [D](./d-writing-a-store) |

## `newt/adapter-files`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `FileStore` | value | [1](./01-project-and-context), [4](./04-who-and-where) | [5](./05-sqlite), [27](./27-postgres), [D](./d-writing-a-store) |
| `FileStoreOptions` | type |   | — |
| `FileTable` | value |   | — |
| `FileCollection` | value |   | — |
| `FileRecord` | type |   | — |
| `FileOutbox` | value |   | — |
| `FileMigration` | type |   | — |
| `FileMigrations` | value |   | — |

## `newt/kysely`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `kyselyFor` | value | [15](./15-kysely), [26](./26-dead-jobs-and-analytics), [27](./27-postgres) |   |
| `whereOf` | value | [15](./15-kysely), [16](./16-search-port) |   |
| `SqliteRow` | type | [15](./15-kysely) |   |

## `newt/http`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `HttpRouter` | value | [1](./01-project-and-context), [4](./04-who-and-where), [5](./05-sqlite), [21](./21-oauth-server), [24](./24-mcp-server), [27](./27-postgres) |   |
| `HttpRouterOptions` | type |   | [21](./21-oauth-server) |
| `HttpRoute` | type |   | — |
| `HttpMethod` | type |   | — |
| `RouteOptions` | type | [21](./21-oauth-server) | [24](./24-mcp-server) |
| `Cors` | type | [21](./21-oauth-server) |   |
| `Authenticator` | type |   | [2](./02-first-module), [22](./22-web-session) |
| `bearerAuthenticator` | value | [24](./24-mcp-server) |   |
| `ErrorHandler` | type |   | [21](./21-oauth-server) |
| `Idempotency` | type |   | [9](./09-idempotent-posts), [23](./23-frontends), [27](./27-postgres), [29](./29-shipping), [C](./c-common-problems) |
| `KeptAnswer` | type | [9](./09-idempotent-posts), [15](./15-kysely) | [27](./27-postgres) |
| `IdempotencyKeyInUse` | value |   | [9](./09-idempotent-posts) |
| `IdempotencyKeyReused` | value |   | [9](./09-idempotent-posts) |
| `serve` | value | [1](./01-project-and-context), [2](./02-first-module), [3](./03-pages-and-errors), [4](./04-who-and-where), [5](./05-sqlite), [12](./12-failures), [17](./17-auth), [18](./18-tenants-and-access), [20](./20-wiring-contexts), [22](./22-web-session), [25](./25-backoffice) | [0](./00-introduction), [21](./21-oauth-server), [23](./23-frontends), [28](./28-observability), [29](./29-shipping) |
| `ServeOptions` | type | [1](./01-project-and-context), [21](./21-oauth-server), [23](./23-frontends) |   |
| `serveFrontend` | value |   | — |
| `handle` | value |   | — |
| `toErrorResponse` | value | [3](./03-pages-and-errors), [21](./21-oauth-server), [24](./24-mcp-server) |   |
| `toOauthErrorResponse` | value | [21](./21-oauth-server) | [24](./24-mcp-server) |
| `pageRequestFrom` | value | [3](./03-pages-and-errors), [4](./04-who-and-where), [11](./11-reacting), [15](./15-kysely), [25](./25-backoffice), [26](./26-dead-jobs-and-analytics) | [16](./16-search-port), [23](./23-frontends) |
| `ApiRouteNotFound` | value | [3](./03-pages-and-errors) |   |
| `MethodNotAllowed` | value |   | — |
| `NotSignedIn` | value | [3](./03-pages-and-errors), [24](./24-mcp-server) |   |
| `MalformedBody` | value |   | [3](./03-pages-and-errors) |
| `UnsupportedMediaType` | value |   | — |
| `HttpGroup` | value |   | [4](./04-who-and-where) |
| `Middleware` | type |   | [4](./04-who-and-where) |

## `newt/application`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `runContexts` | value | [17](./17-auth), [20](./20-wiring-contexts), [22](./22-web-session), [28](./28-observability), [29](./29-shipping) | [1](./01-project-and-context), [21](./21-oauth-server), [23](./23-frontends), [C](./c-common-problems) |
| `ContextToRun` | type |   | — |
| `RunContextsOptions` | type |   | [28](./28-observability) |
| `RunningContexts` | type |   | — |

## `newt/otel`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `OtlpTracer` | value | [28](./28-observability) |   |
| `OtlpTracerOptions` | type |   | — |

## `newt/testing`

| Export | Kind | Imported in | Also in |
|---|---|---|---|
| `freePort` | value | [20](./20-wiring-contexts), [22](./22-web-session), [25](./25-backoffice) | [21](./21-oauth-server) |
| `browser` | value | [20](./20-wiring-contexts), [22](./22-web-session), [25](./25-backoffice) | [21](./21-oauth-server), [24](./24-mcp-server), [29](./29-shipping), [C](./c-common-problems) |
| `Browser` | type | [20](./20-wiring-contexts), [25](./25-backoffice) |   |
| `BrowserRequest` | type |   | — |
