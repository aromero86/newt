# Use cases, pages and errors

`board` can create, read, change and archive a board, one at a time. Two things are
missing before it is something a client can rely on. It cannot list boards: and a list
that comes whole grows until it is too big to send. And what goes wrong reaches the
client in newt's plain words, written for a developer, not for the person using
cooper.

This chapter lists boards **by pages**, and goes through every way a request can fail:
what the client gets each time, and how cooper puts it in its own words.

## A page of boards

**No list is returned whole** unless a rule of the domain bounds it (a board will have
at most ten columns, chapter [6](./06-rules-over-rows)). Boards have no such bound, so
they go by pages. newt has two types for it, in `newt/core` (and `newt/contract`, for
the client):

- **`PageRequest`**: what the caller asks for, `{ size, cursor? }`.
- **`Page<T>`**: what it gets, `{ items, hasMore, total, nextCursor? }`.

The cursor is the id of the last item the client already has. Ids are UUIDv7, which
sort by creation time, so a page is stable even while boards are added meanwhile.

`TableRepository.page(criteria, pageRequest, options)` does all of it, and gives back
a page of entities. The use case turns it into a page of DTOs with `mapPage`. Add
`mapPage`, `Page` and `PageRequest` to the first import of `board.module.ts`, and the
use case `list` right after the constructor:

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

- **`{}`** is the criteria: every board. Archived ones are left out on their own, as
  in every `find` and `count` of a soft-deleting repository.
- **`{ newestFirst: true }`**: pages go from oldest to newest by default. For lists
  people read the other way round (the latest boards, an activity), the first page
  starts with the newest and the cursor goes back.
- **`mapPage(page, fn)`** keeps `hasMore` and `total`, and maps each item. While more
  follow, it also says where the next page starts, `nextCursor`. Here that is the id of
  the last board of the page; it matters when a page is made from another one (a
  workspace's members, made from its accesses in `auth`).

The route reads the page from the address with `pageRequestFrom(request)`, from
`newt/http`: `?size=20&cursor=<id>`. The size is 20 when not given, and kept between 1
and 100 whatever the client asks. Add the import and the route at the top of
`registerBoardRoutes`:

```ts
// cooper/backend/contexts/boards/modules/board/board.routes.ts
import { pageRequestFrom } from 'newt/http'
import type { BoardsBase } from '../../boards-base'
import type { BoardCreateDTO, BoardUpdateDTO } from './board'
import type { Board_Module } from './board.module'

export function registerBoardRoutes(base: BoardsBase, boards: Board_Module): void {
  base.http.get('/boards', async request => Response.json(await boards.list(pageRequestFrom(request))))

  base.http.post('/boards', async request => {
    const input = await request.json() as BoardCreateDTO
    return Response.json(await boards.create(input), { status: 201 })
  })
// …
}
```

The module's test gets a test of the pages, before the others, and the archive test
now also checks an archived board is out of the list. In `board.test.ts`, add the
first test after `create`, and replace the last one:

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

## What goes wrong, as an answer

You never wrote a `try/catch` in a route, and you will not. Whatever a route throws,
the router (and `serve`, for what throws outside a route) turns into a response with
`toErrorResponse`, from `newt/http`. Its body is always an `ErrorBody`, a type of
`newt/contract` a client can import:

```ts
type ErrorBody = {
  error: string    // the message, for a person
  code: string     // what a client acts on: it never changes
  issues?: { path: PropertyKey[], message: string }[]   // what is wrong, field by field
}
```

This is what each kind of failure becomes:

| What is thrown | Status | `code` |
|---|---|---|
| A domain error: `BoardNotFound`, `InvalidBoardName`… | its base's | its own: `board.not_found`, `board.invalid_name` |
| A `ZodError`: the input fails the use case's schema | 400 | `validation`, with zod's `issues` |
| A body that is not JSON (`MalformedBody`) | 400 | `malformed_body` |
| A JSON body sent without `Content-Type: application/json` | 415 | `unsupported_media_type` |
| No actor (the authenticator gave `null`) | 401 | `not_signed_in` |
| A path under `/api` with no route | 404 | `route_not_found` |
| A method the path does not have | 405 | `method_not_allowed` |
| Anything else | 500 | `internal`, and nothing about the inside |

**The base class decides the status.** Every domain error extends `DomainError`
(`status`, `code`, `message`) through one of newt's bases:

| Base | Status | When |
|---|---|---|
| `NotFoundError` | 404 | the requested resource itself does not exist |
| `ValidationError` | 400 | the input is wrong |
| `ReferenceNotFound` | 400 | an id **inside** the input points nowhere |
| `UnauthorizedError` | 401 | nobody is signed in, or the credentials are wrong |
| `ForbiddenError` | 403 | whoever asks may not do this |
| `ConflictError` | 409 | the current state does not allow it |
| `ConcurrencyConflict` | 409 | someone saved it since it was read |
| `DuplicateValue` | 409 | another one took a value no two share first |

A domain error is an answer, not a failure: the use case did its job, which was to
say no.

**`malformed_body`** is `MalformedBody`, a `ValidationError` of `newt/http`. A route
calls `request.json()` as it would anywhere; if the body cannot be read as JSON, the
router throws `MalformedBody` instead of the `SyntaxError`, and the client gets a 400,
not a 500.

**An `InvalidEntity` is a 500.** The board's name is checked twice, on purpose. The use
case checks what **comes in** (`BoardUpdateSchema.parse`, forgiving, a 400 that tells
the client what is wrong). The entity checks its **state**, strictly, every time it
is built or changed, and also when it is read from the store. If that second check
fails, something slipped past the first: a value a use case computed wrong, a bad row.
That is a programming error, `InvalidEntity` from `newt/core`. The client gets the
same 500 as for any other bug, and the log gets the entity, its id, and every field
that failed. No test in this chapter reaches it: cooper's code does not let one
through.

## In cooper's words

newt's own messages are plain and right, but they are written for a developer:
`Sign in to continue`, `The request is not valid`. An application replaces them
**once, at startup**, with `setMessages` from `newt/core`: in its own words, or in
another language. Only the message changes; the `code` and the status stay, so a
client that acts on the code never notices.

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

- **`Messages`** has one function per code of newt's, each with what it needs to say
  (`route_not_found` gets the method and the path). It is `Partial`: any message
  cooper does not give, such as `malformed_body`, keeps newt's.
- **It is the whole process's.** The messages are not a context's: every context in
  the process answers with them.
- **`setMessages` gives back a function that puts the earlier ones back.** The server
  never calls it; a test does, so it does not change what other tests read.

The messages of cooper's own errors (`There is no board …`) each error class writes
itself, as you did in the last chapter.

`index.ts` sets them before it opens anything. Add the import and the call:

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

Its test sets them, checks a few of newt's errors and one of its answers, and puts
newt's back whatever happens:

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

## Through HTTP

The context's test gets two more: the pages over HTTP, and the answers to what goes
wrong. Add them at the end of `boards.context.test.ts`, after the test that keeps a
board as a file:

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

These tests run without `setCooperMessages`, so they check codes, never messages: the
code is what a client relies on.

## Check it

Run the gate:

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint
```

```
 10 pass
 0 fail
```

Start the backend, create three boards (`Roadmap`, `Bugs` and `Launch`, as in the last
chapter), and ask for the first page of two:

```sh
curl -s -H 'x-user: ana' 'localhost:3002/api/boards?size=2'
```

```json
{"items":[{"id":"01a1794f-bece-711e-afd5-e68a0492a91c","name":"Launch","description":"","createdAt":"2026-10-26T17:43:51.758Z","updatedAt":"2026-10-26T17:43:51.758Z"},{"id":"01a1794f-bec6-729d-958b-cf13ada05d7d","name":"Bugs","description":"","createdAt":"2026-10-26T17:43:51.750Z","updatedAt":"2026-10-26T17:43:51.750Z"}],"hasMore":true,"total":3,"nextCursor":"01a1794f-bec6-729d-958b-cf13ada05d7d"}
```

Then the next one, from the cursor it gave:

```sh
curl -s -H 'x-user: ana' 'localhost:3002/api/boards?size=2&cursor=01a1794f-bec6-729d-958b-cf13ada05d7d'
```

```json
{"items":[{"id":"01a1794f-bebd-72fa-9c93-dea33195595a","name":"Roadmap","description":"","createdAt":"2026-10-26T17:43:51.741Z","updatedAt":"2026-10-26T17:43:51.741Z"}],"hasMore":false,"total":3}
```

(If you kept the board you archived in the last chapter, it is in neither.)

Now break things. A body that is not JSON:

```sh
curl -s -X POST localhost:3002/api/boards -H 'content-type: application/json' \
  -H 'x-user: ana' -d '{"name": '
```

```json
{"error":"The body of the request cannot be read","code":"malformed_body"}
```

A name that cannot be one:

```sh
curl -s -X POST localhost:3002/api/boards -H 'content-type: application/json' \
  -H 'x-user: ana' -d '{"name":" "}'
```

```json
{"error":"' ' is not a board's name: it has 1 to 60 characters","code":"board.invalid_name"}
```

A description of 501 characters, which fails the use case's schema:

```sh
curl -s -X PATCH localhost:3002/api/boards/01a1794f-bebd-72fa-9c93-dea33195595a \
  -H 'content-type: application/json' -H 'x-user: ana' \
  -d "{\"description\":\"$(printf 'x%.0s' $(seq 501))\"}"
```

```json
{"error":"Some of what was sent is not right: check the fields and try again","code":"validation","issues":[{"origin":"string","code":"too_big","maximum":500,"inclusive":true,"path":["description"],"message":"Too big: expected string to have <=500 characters"}]}
```

An address cooper does not have, and nobody signed in, in cooper's words:

```sh
curl -s -H 'x-user: ana' localhost:3002/api/nothing/here
curl -s localhost:3002/api/boards
```

```json
{"error":"Cooper has nothing at GET /api/nothing/here","code":"route_not_found"}
{"error":"You are not signed in, or your session has ended: sign in to go on","code":"not_signed_in"}
```

## What to remember

- No list is returned whole unless a rule of the domain bounds it. A use case that
  lists takes a `PageRequest` and returns a `Page`; the repository's `page` does the
  work, `mapPage` turns entities into DTOs, `pageRequestFrom` reads `?size` and
  `?cursor`.
- A route never catches. Whatever it throws becomes `{ error, code }` (and `issues`
  for an input that fails its schema), with the status its base class says.
- Validate twice: the use case checks what comes in (a 400 for the client), the entity
  checks its state (`InvalidEntity`, a 500: a bug).
- A client acts on `code`, which never changes. The messages are for people:
  `setMessages`, once, at startup, puts newt's in your words.

Next: [who and where](./04-who-and-where).
