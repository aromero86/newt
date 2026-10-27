# Casos de uso, páginas y errores

`board` puede crear, leer, cambiar y archivar un tablero, de uno en uno. Faltan dos
cosas para que un cliente pueda fiarse de él. No puede listar tableros: y una lista que
llega entera crece hasta ser demasiado grande para enviarla. Y lo que sale mal llega al
cliente con las palabras sencillas de newt, escritas para un desarrollador, no para la
persona que usa cooper.

Este capítulo lista los tableros **por páginas**, y repasa todas las formas en que puede
fallar una petición: qué recibe el cliente cada vez, y cómo cooper lo dice con sus
propias palabras.

## Una página de tableros

**Ninguna lista se devuelve entera** salvo que una regla del dominio la acote (un
tablero tendrá como mucho diez columnas, capítulo [6](./06-rules-over-rows)). Los
tableros no tienen esa cota, así que van por páginas. newt tiene dos tipos para ello,
en `newt/core` (y en `newt/contract`, para el cliente):

- **`PageRequest`**: lo que pide quien llama, `{ size, cursor? }`.
- **`Page<T>`**: lo que recibe, `{ items, hasMore, total, nextCursor? }`.

El cursor es el id del último elemento que el cliente ya tiene. Los ids son UUIDv7, que
se ordenan por fecha de creación, así que una página es estable aunque mientras tanto se
añadan tableros.

`TableRepository.page(criteria, pageRequest, options)` lo hace todo, y devuelve una
página de entidades. El caso de uso la convierte en una página de DTO con `mapPage`.
Añade `mapPage`, `Page` y `PageRequest` al primer import de `board.module.ts`, y el caso
de uso `list` justo después del constructor:

```ts
// cooper/backend/contexts/boards/modules/board/board.module.ts
import { mapPage, Module, UseCase, type Page, type PageRequest } from 'newt/core'
// …
  private constructor(base: BoardsBase, private readonly repo: Board_Repository) {
    super('board', base.invocations)
  }

  /** A page of the boards, the newest first. */
  @UseCase()
  async list(page: PageRequest): Promise<Page<BoardDTO>> {
    return mapPage(await this.repo.page({}, page, { newestFirst: true }), board => board.toDTO())
  }

  @UseCase()
  async get(id: string): Promise<BoardDTO> {
// …
```

- **`{}`** son los criterios: todos los tableros. Los archivados se quedan fuera por sí
  solos, como en todo `find` y `count` de un repositorio con borrado lógico.
- **`{ newestFirst: true }`**: por defecto las páginas van del más antiguo al más nuevo.
  En las listas que la gente lee al revés (los últimos tableros, una actividad), la
  primera página empieza por lo más nuevo y el cursor retrocede.
- **`mapPage(page, fn)`** conserva `hasMore` y `total`, y transforma cada elemento.
  Mientras haya más, dice además dónde empieza la página siguiente, `nextCursor`. Aquí
  es el id del último tablero de la página; importa cuando una página se hace a partir
  de otra (los miembros de un workspace, hechos a partir de sus accesos en `auth`).

La ruta lee la página de la dirección con `pageRequestFrom(request)`, de `newt/http`:
`?size=20&cursor=<id>`. El tamaño es 20 si no se da, y se mantiene entre 1 y 100 pida lo
que pida el cliente. Añade el import y la ruta al principio de `registerBoardRoutes`:

```ts
// cooper/backend/contexts/boards/modules/board/board.routes.ts
import { pageRequestFrom } from 'newt/http'
import type { BoardsBase } from '../../boards-base'
import type { Board_Module } from './board.module'

export function registerBoardRoutes(base: BoardsBase, boards: Board_Module): void {
  base.http.get('/boards', async request => Response.json(await boards.list(pageRequestFrom(request))))

  base.http.post('/boards', async request => Response.json(await boards.create(await request.json()), { status: 201 }))
// …
}
```

El test del módulo recibe un test de las páginas, antes de los demás, y el test de
archivar comprueba ahora también que un tablero archivado está fuera de la lista. En
`board.test.ts`, añade el primer test después de `create`, y sustituye el último:

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
  const create = (name: string) => t.modules.board.create({ name })

  test('lists boards by pages, the newest first', async () => {
    for (const name of ['Roadmap', 'Bugs', 'Launch']) await create(name)

    const first = await t.modules.board.list({ size: 2 })
    expect(first.items.map(board => String(board.name))).toEqual(['Launch', 'Bugs'])
    expect(first).toMatchObject({ hasMore: true, total: 3 })

    const next = await t.modules.board.list({ size: 2, cursor: first.items[1]!.id })
    expect(next.items.map(board => String(board.name))).toEqual(['Roadmap'])
    expect(next.hasMore).toBe(false)
  })
// …
  test('archives a board: out of every list', async () => {
    const roadmap = await create('Roadmap')

    await t.modules.board.archive(roadmap.id)

    await expect(t.modules.board.get(roadmap.id)).rejects.toMatchObject({ code: 'board.not_found' })
    expect((await t.modules.board.list({ size: 10 })).total).toBe(0)
  })
})
```

## Lo que sale mal, como respuesta

Nunca escribiste un `try/catch` en una ruta, y no lo harás. Todo lo que lanza una ruta,
el router (y `serve`, para lo que se lanza fuera de una ruta) lo convierte en una
respuesta con `toErrorResponse`, de `newt/http`. Su cuerpo es siempre un `ErrorBody`, un
tipo de `newt/contract` que un cliente puede importar:

```ts
type ErrorBody = {
  error: string    // the message, for a person
  code: string     // what a client acts on: it never changes
  issues?: { path: PropertyKey[], message: string }[]   // what is wrong, field by field
}
```

Esto es lo que se convierte cada tipo de fallo:

| Lo que se lanza | Estado | `code` |
|---|---|---|
| Un error de dominio: `BoardNotFound`, `InvalidBoardName`… | el de su base | el suyo: `board.not_found`, `board.invalid_name` |
| Un `ZodError`: la entrada no cumple el esquema del caso de uso | 400 | `validation`, con los `issues` de zod |
| Un cuerpo que no es JSON (`MalformedBody`) | 400 | `malformed_body` |
| Un cuerpo JSON enviado sin `Content-Type: application/json` | 415 | `unsupported_media_type` |
| Ningún actor (el autenticador devolvió `null`) | 401 | `not_signed_in` |
| Una ruta bajo `/api` sin ruta | 404 | `route_not_found` |
| Un método que la ruta no tiene | 405 | `method_not_allowed` |
| Cualquier otra cosa | 500 | `internal`, y nada sobre el interior |

**La clase base decide el estado.** Todo error de dominio extiende `DomainError`
(`status`, `code`, `message`) a través de una de las bases de newt:

| Base | Estado | Cuándo |
|---|---|---|
| `NotFoundError` | 404 | el recurso pedido en sí no existe |
| `ValidationError` | 400 | la entrada es incorrecta |
| `ReferenceNotFound` | 400 | un id **dentro** de la entrada no apunta a nada |
| `UnauthorizedError` | 401 | nadie ha iniciado sesión, o las credenciales son incorrectas |
| `ForbiddenError` | 403 | quien pregunta no puede hacer esto |
| `ConflictError` | 409 | el estado actual no lo permite |
| `ConcurrencyConflict` | 409 | alguien lo guardó después de que se leyera |
| `DuplicateValue` | 409 | otro se quedó antes un valor que no pueden compartir dos |

Un error de dominio es una respuesta, no un fallo: el caso de uso hizo su trabajo, que
era decir que no.

**`malformed_body`** es `MalformedBody`, un `ValidationError` de `newt/http`. Una ruta
llama a `request.json()` como lo haría en cualquier sitio; si el cuerpo no se puede leer
como JSON, el router lanza `MalformedBody` en lugar del `SyntaxError`, y el cliente
recibe un 400, no un 500.

**Un `InvalidEntity` es un 500.** El nombre del tablero se comprueba dos veces, a
propósito. El caso de uso comprueba lo que **entra** (`BoardUpdateSchema.parse`,
indulgente, un 400 que dice al cliente qué está mal). La entidad comprueba su
**estado**, de forma estricta, cada vez que se construye o se cambia, y también cuando
se lee del store. Si falla esa segunda comprobación, algo se coló por la primera: un
valor que un caso de uso calculó mal, una fila incorrecta. Eso es un error de
programación, `InvalidEntity`, de `newt/core`. El cliente recibe el mismo 500 que por
cualquier otro fallo, y el log recibe la entidad, su id y todos los campos que
fallaron. Ningún test de este capítulo llega hasta ahí: el código de cooper no deja
pasar ninguno.

## Con las palabras de cooper

Los mensajes de newt son sencillos y correctos, pero están escritos para un
desarrollador: `Sign in to continue`, `The request is not valid`. Una aplicación los
sustituye **una sola vez, al arrancar**, con `setMessages`, de `newt/core`: con sus
propias palabras, o en otro idioma. Solo cambia el mensaje; el `code` y el estado se
quedan, así que un cliente que actúa según el código ni se entera.

```ts
// cooper/backend/shared/messages.ts
import { setMessages, type Messages } from 'newt/core'

/**
 * What cooper says when something newt owns goes wrong, in cooper's words: newt's
 * defaults are plain and right, these speak to the person using the app. Its own
 * errors' messages each module writes itself (`errors/`); the `code` a client acts
 * on never changes.
 */
export const cooperMessages: Partial<Messages> = {
  concurrency_conflict: () => 'Someone else changed this a moment ago. Reload it and try again.',
  duplicate_value: () => 'That is already taken: pick another one',
  reference_not_found: ({ resource, id }) => `That ${resource} is not there any more (${id})`,
  not_signed_in: () => 'You are not signed in, or your session has ended: sign in to go on',
  validation: () => 'Some of what was sent is not right: check the fields and try again',
  route_not_found: ({ method, path }) => `Cooper has nothing at ${method} ${path}`,
  internal: () => 'Something went wrong on our side. Try again in a moment.',
}

/**
 * Sets cooper's messages for the whole process: once, as the server starts
 * (`index.ts`), before any request. Every context answers with them.
 */
export function setCooperMessages(): () => void {
  return setMessages(cooperMessages)
}
```

- **`Messages`** tiene una función por cada código de newt, cada una con lo que necesita
  para decirlo (`route_not_found` recibe el método y la ruta). Es `Partial`: cualquier
  mensaje que cooper no da, como `malformed_body`, conserva el de newt.
- **Es de todo el proceso.** Los mensajes no son de un contexto: todos los contextos del
  proceso responden con ellos.
- **`setMessages` devuelve una función que restaura los anteriores.** El servidor no la
  llama nunca; un test sí, para no cambiar lo que leen los demás tests.

Los mensajes de los errores propios de cooper (`There is no board …`) los escribe cada
clase de error, como hiciste en el capítulo anterior.

`index.ts` los configura antes de abrir nada. Añade el import y la llamada:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. For now one context, boards, served on its port.
import { serve } from 'newt/http'
import { config } from './config'
import { Boards_Context } from './contexts/boards/boards.context'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()

const boards = await Boards_Context.open(config.boards)
// For now, who sends a request says who they are in an `x-user` header (chapter 22 signs them in).
boards.base.http.authenticateWith(async request => {
  const userId = request.headers.get('x-user')
  return userId ? { userId } : null
})
boards.start()
const server = serve(boards.serving())
console.log(`boards listening on ${server.url}`)
```

Su test los configura, comprueba unos cuantos errores de newt y una de sus respuestas, y
vuelve a poner los de newt pase lo que pase:

```ts
// cooper/backend/shared/messages.test.ts
import { expect, test } from 'bun:test'
import { ConcurrencyConflict, DuplicateValue, ReferenceNotFound } from 'newt/core'
import { ApiRouteNotFound, NotSignedIn, toErrorResponse } from 'newt/http'
import { setCooperMessages } from './messages'

test('once set at startup, newt\'s errors and its API speak cooper\'s words', async () => {
  const restore = setCooperMessages()
  try {
    const response = toErrorResponse(new ApiRouteNotFound('GET', '/api/nothing'))

    expect(new ConcurrencyConflict().message).toBe('Someone else changed this a moment ago. Reload it and try again.')
    expect(new DuplicateValue(['name']).message).toBe('That is already taken: pick another one')
    expect(new ReferenceNotFound('column', 'c1').message).toBe('That column is not there any more (c1)')
    expect(new NotSignedIn().message).toBe('You are not signed in, or your session has ended: sign in to go on')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Cooper has nothing at GET /api/nothing', code: 'route_not_found' })
  } finally {
    restore()
  }
})
```

## Por HTTP

El test del contexto recibe dos más: las páginas por HTTP, y las respuestas a lo que sale
mal. Añádelos al final de `boards.context.test.ts`, después del test que guarda un
tablero como fichero:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
// …
    expect((await call('POST', `/boards/${id}/archive`)).status).toBe(204)
    expect((await call('GET', `/boards/${id}`)).body).toMatchObject({ code: 'board.not_found' })
  })

  test('lists boards by pages: ?size= and ?cursor=', async () => {
    for (const name of ['Roadmap', 'Bugs', 'Launch']) await call('POST', '/boards', { name })

    const first = await call<{ items: { id: string, name: string }[] }>('GET', '/boards?size=2')
    expect(first.body).toMatchObject({ items: [{ name: 'Launch' }, { name: 'Bugs' }], hasMore: true, total: 3 })
    expect((await call('GET', `/boards?size=2&cursor=${first.body.items[1]!.id}`)).body).toMatchObject({ items: [{ name: 'Roadmap' }], hasMore: false })
  })

  test('answers what went wrong as { error, code }, with the status its error says', async () => {
    const id = (await call<{ id: string }>('POST', '/boards', { name: 'Roadmap' })).body.id

    expect(await call('GET', `/boards/${Bun.randomUUIDv7()}`)).toMatchObject({ status: 404, body: { code: 'board.not_found' } })
    expect(await call('POST', '/boards', { name: ' ' })).toMatchObject({ status: 400, body: { code: 'board.invalid_name' } })
    expect(await call('PATCH', `/boards/${id}`, { description: 'x'.repeat(501) })).toMatchObject({ status: 400, body: { code: 'validation', issues: [{ path: ['description'] }] } })
    expect(await call('GET', '/nothing/here')).toMatchObject({ status: 404, body: { code: 'route_not_found' } })

    const malformed = await fetch(new URL('/api/boards', server.url), { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': 'ana' }, body: '{ "name": ' })
    expect([malformed.status, (await malformed.json() as { code: string }).code]).toEqual([400, 'malformed_body'])
  })
})
```

Estos tests se ejecutan sin `setCooperMessages`, así que comprueban códigos, nunca
mensajes: el código es lo que usa un cliente.

## Compruébalo

Ejecuta la comprobación:

```sh
bun install && bun check && bun test cooper/ && bun run lint
```

```
 10 pass
 0 fail
```

Arranca el backend, crea tres tableros (`Roadmap`, `Bugs` y `Launch`, como en el
capítulo anterior) y pide la primera página de dos:

```sh
curl -s -H 'x-user: ana' 'localhost:3002/api/boards?size=2'
```

```json
{"items":[{"id":"01a1794f-bece-711e-afd5-e68a0492a91c","name":"Launch","description":"","createdAt":"2026-10-26T17:43:51.758Z","updatedAt":"2026-10-26T17:43:51.758Z"},{"id":"01a1794f-bec6-729d-958b-cf13ada05d7d","name":"Bugs","description":"","createdAt":"2026-10-26T17:43:51.750Z","updatedAt":"2026-10-26T17:43:51.750Z"}],"hasMore":true,"total":3,"nextCursor":"01a1794f-bec6-729d-958b-cf13ada05d7d"}
```

Después la siguiente, desde el cursor que te dio:

```sh
curl -s -H 'x-user: ana' 'localhost:3002/api/boards?size=2&cursor=01a1794f-bec6-729d-958b-cf13ada05d7d'
```

```json
{"items":[{"id":"01a1794f-bebd-72fa-9c93-dea33195595a","name":"Roadmap","description":"","createdAt":"2026-10-26T17:43:51.741Z","updatedAt":"2026-10-26T17:43:51.741Z"}],"hasMore":false,"total":3}
```

(Si conservaste el tablero que archivaste en el capítulo anterior, no sale en ninguna de
las dos.)

Ahora rómpelo todo. Un cuerpo que no es JSON:

```sh
curl -s -X POST localhost:3002/api/boards -H 'content-type: application/json' \
  -H 'x-user: ana' -d '{"name": '
```

```json
{"error":"The body of the request cannot be read","code":"malformed_body"}
```

Un nombre que no puede serlo:

```sh
curl -s -X POST localhost:3002/api/boards -H 'content-type: application/json' \
  -H 'x-user: ana' -d '{"name":" "}'
```

```json
{"error":"' ' is not a board's name: it has 1 to 60 characters","code":"board.invalid_name"}
```

Una descripción de 501 caracteres, que no cumple el esquema del caso de uso:

```sh
curl -s -X PATCH localhost:3002/api/boards/01a1794f-bebd-72fa-9c93-dea33195595a \
  -H 'content-type: application/json' -H 'x-user: ana' \
  -d "{\"description\":\"$(printf 'x%.0s' $(seq 501))\"}"
```

```json
{"error":"Some of what was sent is not right: check the fields and try again","code":"validation","issues":[{"origin":"string","code":"too_big","maximum":500,"inclusive":true,"path":["description"],"message":"Too big: expected string to have <=500 characters"}]}
```

Una dirección que cooper no tiene, y nadie con la sesión iniciada, con las palabras de
cooper:

```sh
curl -s -H 'x-user: ana' localhost:3002/api/nothing/here
curl -s localhost:3002/api/boards
```

```json
{"error":"Cooper has nothing at GET /api/nothing/here","code":"route_not_found"}
{"error":"You are not signed in, or your session has ended: sign in to go on","code":"not_signed_in"}
```

## Qué recordar

- Ninguna lista se devuelve entera salvo que una regla del dominio la acote. Un caso de
  uso que lista recibe un `PageRequest` y devuelve un `Page`; el `page` del repositorio
  hace el trabajo, `mapPage` convierte entidades en DTO, `pageRequestFrom` lee `?size` y
  `?cursor`.
- Una ruta nunca captura. Todo lo que lanza se convierte en `{ error, code }` (y
  `issues` para una entrada que no cumple su esquema), con el estado que dice su clase
  base.
- Valida dos veces: el caso de uso comprueba lo que entra (un 400 para el cliente), la
  entidad comprueba su estado (`InvalidEntity`, un 500: un fallo del programa).
- Un cliente actúa según `code`, que no cambia nunca. Los mensajes son para las
  personas: `setMessages`, una sola vez, al arrancar, pone los de newt con tus palabras.

Siguiente: [quién y dónde](./04-who-and-where).
