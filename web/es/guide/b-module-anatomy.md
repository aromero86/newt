# B. La anatomía de un módulo, y el lint

Todos los módulos de cooper tienen los mismos archivos, con su nombre, para que quien
abre uno sepa dónde está todo. Un módulo es una carpeta en los `modules/` de su contexto,
en kebab case: `cooper/backend/contexts/<context>/modules/<module>/`. Este apéndice lista
los archivos y lo que guarda cada uno, y luego cada regla de `newt-eslint`, con el error
que da.

## Los archivos

| Archivo | Qué guarda | Desde |
|---|---|---|
| `<m>.schema.ts` | Los esquemas zod, los tipos DTO, los esquemas de entrada y los filtros: el **contrato público** del módulo. Lo importan otros módulos, otros contextos y los clientes de la API. Importa solo zod, `newt/contract`, objetos de valor y otros esquemas. | [2](./02-first-module), [23](./23-frontends) |
| `<m>.ts` | La entidad, una clase que extiende `Entity`: el único código que cambia el estado del módulo. Reexporta el esquema. | [2](./02-first-module) |
| `<m>.repository.ts` | El único archivo que toca el store: un `TableRepository` sobre la tabla del módulo, sus guardados con su `guard`, `before` y `after`, y cualquier consulta Kysely. | [2](./02-first-module), [6](./06-rules-over-rows) |
| `<m>.module.ts` | `<M>_Module`: sus casos de uso (`@UseCase`), sus `events` (`eventsOf(base.bus, { … })`), y `static initialize`, que construye el repositorio y registra rutas y workers. | [2](./02-first-module), [10](./10-events) |
| `<m>.routes.ts` | Sus rutas, si tiene alguna: leen la petición, llaman a un caso de uso, responden. | [2](./02-first-module) |
| `<m>.workers.ts` | Sus reacciones a eventos y programaciones (`….subscribe(…, { strategy: 'handler', queue })`), si tiene alguna. | [11](./11-reacting) |
| `<m>.deps.ts` | `<M>_Deps`: los módulos de su contexto a los que llama, y los puertos que necesita de fuera de su contexto, importados como tipos. | [4](./04-who-and-where), [13](./13-another-context) |
| `<m>-options.ts` | `<M>_Options`: con qué lo configura su contexto (un mailer, una URL, un número de días, un adaptador). | [7](./07-cards-and-a-counter), [12](./12-failures) |
| `events/<m>-<verbo>.ts` | Un evento por archivo, su clase llamada `<M>_<Verbo>`. | [10](./10-events) |
| `errors/<error>.ts` | Un error por archivo, con un `code` estable; su clase base decide el estado. | [2](./02-first-module), [3](./03-pages-and-errors) |
| `value-objects/<nombre>.ts` | Sus objetos de valor, si tiene alguno. | [2](./02-first-module) |
| `services/<nombre>.ts` | Lógica que comparten sus casos de uso, un archivo cada una. | |
| `*.test.ts` | Sus tests, junto a lo que prueban. | [2](./02-first-module) |

Solo `<m>.module.ts` está siempre. El `card` de boards tiene casi todos:

```text
cooper/backend/contexts/boards/modules/card/
  card.schema.ts       CardSchema, CardCreateSchema, CardFilter, MAX_CARDS, CardDTO…
  card.ts              Card, the entity; re-exports the schema
  card.repository.ts   persistNew, persistOrder, nextNumber, countByBoard, purgeWorkspace…
  card.module.ts       Card_Module: create, edit, move, assign, search, removeColumn…
  card.routes.ts       under /workspaces/:workspaceId: /boards/:boardId/cards, /cards/…
  card.workers.ts      notify the assignee, index each card, leave a removed column,
                       unassign someone whose access was revoked
  card.deps.ts         board, column, member, and auth's access events (a port)
  card-options.ts      the mailer, boards' public URL, the card search
  card.test.ts
  events/              card-created.ts, card-edited.ts, card-moved.ts, card-assigned.ts,
                       card-unassigned.ts, card-deleted.ts
  errors/              card-not-found.ts, column-not-empty.ts, column-not-in-board.ts,
                       assignee-not-member.ts, too-many-cards.ts
```

`board` es la forma que tienen la mayoría de los módulos, sin workers ni opciones:

```text
cooper/backend/contexts/boards/modules/board/
  board.schema.ts  board.ts  board.repository.ts  board.module.ts  board.routes.ts
  board.deps.ts    board.test.ts
  events/          board-created.ts, board-updated.ts, board-archived.ts
  errors/          board-not-found.ts, board-name-taken.ts, invalid-board-name.ts
  value-objects/   board-name.ts
```

Y un módulo que no guarda nada no tiene entidad ni repositorio: el `workspace` del
backoffice es un módulo, sus deps, sus rutas, su esquema y su test
([capítulo 25](./25-backoffice)).

Un módulo que todos los contextos necesitan por igual vive en
`cooper/backend/shared/<module>/`, con los mismos archivos y nombres, y cada contexto
inicializa el suyo sobre su propio store: `shared/web-session` (las sesiones de cada app
web, [capítulo 22](./22-web-session)) y `shared/outbox` (los jobs muertos de un contexto,
[capítulo 12](./12-failures)). No pertenece a ningún contexto y no importa ninguno. No
está en ninguna carpeta `modules/`, así que las reglas de módulo del lint no lo
comprueban: mantén su anatomía a mano.

## Nombres

Para un módulo sobre concesiones OAuth, como lo tiene auth ([capítulo 21](./21-oauth-server)):

| Qué | Nombre |
|---|---|
| Carpeta | `oauth-grant` |
| Clase del módulo | `OauthGrant_Module` |
| Nombre del módulo (`super('…')`) | `oauthGrant` |
| Entidad | `OauthGrant` |
| Repositorio | `OauthGrant_Repository` |
| Tabla | `oauth_grant` |
| Caso de uso | `oauthGrant.redeem` |
| Evento | `oauthGrant.replayed`, clase `OauthGrant_Replayed`, archivo `events/oauth-grant-replayed.ts` |
| Error | `errors/invalid-grant.ts`, código `oauthGrant.invalid_grant` |
| La cola de un worker | `token.revokeGrant.on.oauthGrant.replayed` |

La cola dice quién reacciona (`token`), con qué (`revokeGrant`), a qué evento
(`oauthGrant.replayed`). Renombrar cualquiera de los tres renombra la cola, y deja los
jobs que ya esperaban bajo el nombre antiguo ([capítulo 11](./11-reacting)).

## Junto a los módulos

Un contexto tiene unos pocos archivos propios junto a `modules/`
([capítulo 1](./01-project-and-context)):

| Archivo | Qué guarda |
|---|---|
| `<context>.context.ts` | `<Context>_Context`: `open` abre su store, crea su base e inicializa sus módulos; `start` y `stop` su worker. |
| `initialize-modules.ts` | Cada módulo, después de los que usa. |
| `<context>-base.ts` | Su base: la base de cooper, con lo que necesitan sus módulos. |
| `<context>-config.ts` | El tipo de aquello con lo que se configura. |
| `migrations/sqlite/`, `migrations/postgres/` | Sus migraciones, una carpeta por dialecto ([capítulo 5](./05-sqlite), [27](./27-postgres)). |
| `testing/` | Con qué lo abren sus tests, y falsos de lo que necesita de fuera. |

## El lint

El `eslint.config.js` de cooper aplica el preset de `newt-eslint` al backend y a los
scripts, con sus contextos y cuáles usa cada uno
([capítulo 1](./01-project-and-context)):

```js
// eslint.config.js
import { newt } from 'newt-eslint'
// …
const BACKEND = newt({
  files: ['cooper/backend/**/*.ts', 'cooper/scripts/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'], backoffice: ['auth', 'boards'] } },
})
// …
```

Ejecútalo con `bun run lint`. El preset activa seis comprobaciones: cuatro reglas propias
de newt (`newt/…`), una restricción y una regla de typescript-eslint. Los errores de
abajo son reales: cada uno se escribió a propósito en `card/` y se pasó por el lint.

### `newt/module-anatomy`

**Dónde**: cada archivo bajo una carpeta `modules/<module>/`.
**Qué comprueba**: que el archivo es uno de los que tiene un módulo (`<m>.module.ts`,
`<m>.ts`, `<m>.schema.ts`, `<m>.repository.ts`, `<m>.routes.ts`, `<m>.workers.ts`,
`<m>.deps.ts`, `<m>-options.ts`, `*.test.ts`), o está en una de sus carpetas (`events`,
`errors`, `value-objects`, `services`); y que el archivo de un evento empieza con el
nombre del módulo.

```text
card/card.helpers.ts
  1:1  error  'card.helpers.ts' is not a file a module has: its files are card.module.ts, card.ts, card.schema.ts, card.repository.ts, card.routes.ts, card.workers.ts, card.deps.ts, card-options.ts and *.test.ts  newt/module-anatomy

card/utils/format.ts
  1:1  error  'utils' is not a folder a module has: its folders are events, errors, value-objects, services  newt/module-anatomy

card/events/moved-card.ts
  1:1  error  An event's file is named 'card-<event>.ts', not 'moved-card.ts'  newt/module-anatomy
```

Arreglo: pon el código donde va su tipo (la lógica compartida en `services/`), o nombra
el archivo con el nombre del módulo.

### `newt/module-boundaries`

**Dónde**: cada archivo bajo una carpeta `modules/<module>/`.
**Qué comprueba**: que un import de otro módulo cae en su módulo, su esquema, sus
eventos, sus errores o sus objetos de valor. Nunca en su entidad, repositorio, tablas,
rutas o workers, ni en su carpeta (`../board`). Rutas relativas y alias de tsconfig por
igual.

```ts
import { Board } from '../board/board'
import { Board_Repository } from '../board/board.repository'
```

```text
  1:23  error  '../board/board' is board's own: a module reaches another through its use cases (`board.module.ts`), its schema, its events, its errors and its value objects  newt/module-boundaries
  2:34  error  '../board/board.repository' is board's own: a module reaches another through its use cases (`board.module.ts`), its schema, its events, its errors and its value objects  newt/module-boundaries
```

Arreglo: llama a un caso de uso de `Board_Module` a través de las deps del módulo, y usa
su DTO ([capítulo 6](./06-rules-over-rows)).

### `newt/queue-name`

**Dónde**: cada archivo bajo una carpeta `modules/<module>/`.
**Qué comprueba**: que la `queue` de un handler es
`<módulo>.<caso de uso>.on.<módulo>.<evento>`; que empieza con el módulo en cuyo archivo
está; que su callback llama a ese caso de uso en ese módulo; y que termina con el evento
al que está suscrita (`events.assigned` → `….assigned`). Señala cuatro errores distintos:

```ts
cards.events.assigned.subscribe(({ dto, by }) => cards.notifyAssignee(dto, by), { strategy: 'handler', queue: 'notify-assignee' })
cards.events.assigned.subscribe(({ dto, by }) => cards.notifyAssignee(dto, by), { strategy: 'handler', queue: 'board.notifyAssignee.on.card.assigned' })
cards.events.assigned.subscribe(({ dto, by }) => cards.notifyAssignee(dto, by), { strategy: 'handler', queue: 'card.notify.on.card.assigned' })
cards.events.assigned.subscribe(({ dto, by }) => cards.notifyAssignee(dto, by), { strategy: 'handler', queue: 'card.notifyAssignee.on.card.created' })
```

```text
  error  'notify-assignee' is not a handler's queue: it is '<module>.<use case>.on.<module>.<event>', as 'order.fulfil.on.order.placed'  newt/queue-name
  error  This queue is 'card.…': the handlers in card.workers.ts are card's, so their queues start with 'card.', not 'board.'  newt/queue-name
  error  This queue says the handler calls card's 'notify', but its callback calls no 'notify' of card: name the use case it calls  newt/queue-name
  error  This queue ends with '.on.….assigned', the event it subscribes to  newt/queue-name
```

Arreglo: `card.notifyAssignee.on.card.assigned`. El propio newt rechaza al arrancar una cola
que no termina con su evento ([apéndice C](./c-common-problems#workers)); el lint
detecta eso y lo demás en el editor ([capítulo 11](./11-reacting)). Una suscripción que
no es de ningún módulo (la reacción propia de un test) no tiene un caso de uso que
nombrar: desactiva la regla para esa línea, diciendo por qué.

### `newt/context-boundaries`

**Dónde**: cada archivo bajo `contexts.folder`, cuando al preset se le dan `contexts`.
**Qué comprueba**: que un contexto importa solo los contextos que lista su `uses`. Una
carpeta de contexto que `uses` no lista no puede importar ningún otro contexto.

```ts
// in a file of boards
import { Staff_Module } from '../../../backoffice/modules/staff/staff.module'
```

```text
  3:30  error  '../../../backoffice/modules/staff/staff.module' is the context backoffice's, and boards uses auth: contexts use only the ones they say, never in a cycle  newt/context-boundaries
```

Arreglo: lo que boards necesita del backoffice va al revés, o a través de un puerto en
las propias palabras de boards ([capítulo 20](./20-wiring-contexts)).

El propio `uses` se comprueba al construir el preset, antes de pasar el lint a ningún
archivo. Cada error lanza una excepción, y `bun run lint` se detiene con ella:

```text
newt-eslint: contexts never use each other in a cycle, and `uses` says auth → boards → auth.
newt-eslint: the context 'boards' uses 'auth', which is not in `uses`: list every context, each with the ones it uses ([] for none).
```

### Ninguna transacción en un módulo

**Dónde**: cada archivo bajo una carpeta `modules/<module>/` (el `no-restricted-syntax`
de ESLint, configurado por el preset).
**Qué comprueba**: `transaction`, llamada o tomada: `store.transaction(…)`,
`store['transaction']`, `const { transaction } = store`.

```ts
base.store.transaction(async () => {})
```

```text
  8:3  error  A module writes through its repository's save (or saveRows), which runs the transaction, checks the write rule and publishes the events: never in a transaction of its own  no-restricted-syntax
```

Arreglo: escribe a través del `save` del repositorio (o `saveRows` alrededor de varias
tablas, [capítulo 14](./14-sagas)).

### `@typescript-eslint/no-floating-promises`

**Dónde**: cada archivo que lintea el preset.
**Qué comprueba**: que ninguna promesa se queda sin `await`, `.catch`, o un `void` que
diga que es a propósito. La misma línea de antes da también:

```text
  8:3  error  Promises must be awaited, end with a call to .catch, end with a call to .then with a rejection handler or be explicitly marked as ignored with the `void` operator  @typescript-eslint/no-floating-promises
```

Arreglo: ponle `await`. Una llamada sin `await` dentro de una transacción se ejecuta
después de que la transacción haya terminado, y falla ([apéndice C](./c-common-problems#saving)).
La regla necesita que cada archivo linteado esté en un proyecto TypeScript: el
`tsconfig.json` raíz de cooper referencia uno por parte
([capítulo 20](./20-wiring-contexts)).

### Lo que el lint no comprueba

- La anatomía de los módulos de `shared/`, que no están en ninguna carpeta `modules/`.
- Que un `*.schema.ts` importa solo `newt/contract`, no `newt/core`: Vite avisa de
  `node:async_hooks` cuando un frontend arrastra `newt/core` ([capítulo 23](./23-frontends)).
- La regla de escritura y la regla del guard: newt las comprueba mientras se ejecuta el
  código ([capítulo 8](./08-two-people-one-card), [capítulo 6](./06-rules-over-rows)).

El `eslint.config.js` de cooper añade reglas propias para los frontends (ningún estilo
fuera de `@cooper/ui`, ningún import del backend salvo el `*.schema.ts` de un módulo); son
de cooper, no de newt-eslint ([capítulo 23](./23-frontends)).
