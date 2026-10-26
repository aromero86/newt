# The frontends and newt/contract

cooper's backend does everything a person needs: Ana signs up at auth, makes Acme,
signs in to boards and keeps her cards. But she does all of it with `curl`. Since
[chapter 22](./22-web-session), boards sends her browser to auth's
`/oauth/authorize`, and auth sends it on to pages it does not have yet: a sign-in
form, and the page where she says yes to boards.

This chapter gives cooper its two web apps: **auth's** (sign in, sign up, approve
an application) and **boards'** (the SaaS: workspaces, boards, cards, search,
settings). They are React apps built with Vite. The tutorial is about the backend, so
you copy them from the repository instead of typing them. What this chapter teaches is
where they touch the backend and newt:

- **`newt/contract`**, the part of newt a browser may load, and why it is apart from
  `newt/core`;
- the rule that keeps the frontend from importing the backend's code, while it shares
  its **contract**, the modules' `*.schema.ts`;
- the API clients, with `CardApi` in detail: the `Idempotency-Key` of
  [chapter 9](./09-idempotent-posts) and the search of [chapter 16](./16-search-port);
- how the apps reach their contexts: through Vite's proxy in development, and served
  by the contexts themselves once built (`frontendFolder`);
- the scripts `cooper` and `cooper:build`, a TypeScript project for the browser, and
  the frontend half of the lint.

## What you copy

Three folders come from the tag:

```sh
git checkout tutorial/23 -- cooper/frontend cooper/libs cooper/scripts/dev.ts
```

```
cooper/
  frontend/
    vite-app.ts            what both apps' Vite configs share
    auth/                  auth's app: index.html, main.tsx, app.routes.tsx, pages/, services/, vite.config.ts
    boards/                boards' app: the same shape, with modules/ for its zones
  libs/
    api/                   @cooper/api: the API clients, the only way to the backend
    core/                  @cooper/core: stores, forms, an injector, the theme
    ui/                    @cooper/ui: the components, the only place that styles
  scripts/
    dev.ts                 bun run cooper: the backend and both Vite servers
```

Then their dependencies, at the versions cooper pins:

```sh
bun add --exact @fontsource-variable/inter@5.3.0 @fontsource-variable/jetbrains-mono@5.3.0 @preact/signals-core@1.14.4 class-variance-authority@0.7.1 cn@0.4.0 lucide-react@1.48.0 radix-ui@1.7.0 react@19.3.0 react-dom@19.3.0 react-router@8.4.0 sonner@2.0.8 tw-animate-css@1.4.0
bun add --exact --dev @tailwindcss/vite@4.3.3 @types/react@19.3.0 @types/react-dom@19.3.0 @vitejs/plugin-react@6.1.2 tailwindcss@4.3.3 typescript-eslint@8.71.1 vite@8.3.4
```

The rest of the chapter is typed: two backend files change a little, and the root's
`package.json` scripts, `tsconfig*.json` and `eslint.config.js` grow. The files the
checkout brought that touch the backend or newt are shown in full below, so you know
what they do.

## The apps in a few lines

Both apps have the same shape, and the same three libraries under them:

- **`@cooper/ui`** (`cooper/libs/ui`) is the components: buttons, fields, dialogs,
  tables, the board, the shell. They are built on shadcn and Radix, styled with
  Tailwind. It is the only place that styles; the apps compose its components.
- **`@cooper/core`** (`cooper/libs/core`) is what the apps' services are made of: a
  `Store` (a service's state in one signal, from `@preact/signals-core`), a
  `ListStore` (a list read page by page with a cursor, from any function that returns
  a `Page`), a `FormStore` (a form's values, errors and submit, validated with a zod
  schema), and a small injector (`inject`, `Provide`, `useService`) that gives each
  screen its services.
- **`@cooper/api`** (`cooper/libs/api`) is one client per backend module, below.

Each app is an `index.html`, a `main.tsx` that mounts React, and an `app.routes.tsx`
with React Router. auth's routes are `sign-in`, `sign-up`, `authorize/:id` and
`error`: the pages its OAuth server sends the browser to. boards' are behind a session
guard (no session: it shows a sign-in button where the page would be, which starts
chapter 22's round trip at `/api/session/sign-in`), then the workspace's zones (`w/:workspaceId/boards`, `search`, `settings`),
each loaded the first time someone enters it. A screen is a component that reads a
service's signals; the service holds the state and calls the API.

None of that touches newt. What does is in `@cooper/api`.

## newt/contract: what a browser may load

Since [chapter 2](./02-first-module) your schemas and value objects have imported
`ValueObject` and `ValidationError` from `newt/contract`, not from `newt/core`. This is
why.

`newt/core` is what a backend runs on. Among its pieces is the scope a use case runs
in: who is acting, in which workspace, by which clock, inside which transaction. newt
keeps that in an `AsyncLocalStorage`, from `node:async_hooks`, and `newt/core` creates
it as the module loads. A browser has no `node:async_hooks`. Vite can only put an
empty stand-in in its place, and warns when it does:

```text
[plugin rolldown:vite-resolve] Module "node:async_hooks" has been externalized for browser compatibility, imported by ".../packages/newt/core/scope/define-scope.ts".
```

`newt/contract` is the part of `newt/core` that keeps no scope: the files that run
anywhere, re-exported. It is what a backend and its clients share:

| Export | What it is |
|---|---|
| `ValueObject`, `Email`, `SecretToken` | Value objects, with their schemas, and the errors they throw (`InvalidEmail`, `InvalidSecretToken`). |
| `DomainError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError` | The bases of every domain error, so a value object made in the browser throws the same error as on the server. |
| `defineFilter`, `Filter`, `FilterField`, `FilterNode`, `FilterLimits` | The filters a client may send ([chapter 15](./15-kysely)). |
| `Page`, `PageRequest` | One page of a list, and which page to ask for ([chapter 3](./03-pages-and-errors)). |
| `ErrorBody` | The body of every failed request: `error`, `code`, `issues`. |

These are the same classes and types `newt/core` exports; `newt/contract` is another
door to them, not a copy. A file that imports only `newt/contract` (and zod) can go to
the browser as it is.

## The schema is the contract

A module's `*.schema.ts` says what goes into its use cases and what comes out. It is
the one file of the backend a client needs, so it is the one file a client may
import. For that to work, a schema file imports only:

- `zod`;
- `newt/contract`;
- its own module's value objects (which import `newt/contract`), and other modules'
  schemas;
- types, with `import type`, from anywhere: they are erased before the browser sees
  the file. `card.schema.ts` imports the type `ActorVia` from `shared/actor.ts` this
  way.

The clients use it in two ways. Mostly as types: `CardDTO`, `CardCreateDTO`,
`Page<CardDTO>`. A client and its server cannot disagree about a field's name,
because there is only one declaration. Sometimes as values, for a form to check what
someone types with the very rules the backend checks. auth's sign-up form validates
with `UserSignUpSchema`, from `auth/modules/user/user.schema.ts` (it brings `Email`
and `defineFilter` along, both from `newt/contract`), so "Use at least 8 characters"
shows under the password field before anything is sent, and the backend says the
same thing if a request skips the form.

Each folder of `@cooper/api` re-exports its module's contract beside its client. This
is the card's:

```ts
// cooper/libs/api/card/index.ts
// The contract comes from the backend module; the client is ours.
export type {
  CardAssignDTO,
  CardCreateDTO,
  CardDTO,
  CardEditDTO,
  CardFilterDTO,
  CardMoveDTO,
  CardSearchDTO,
} from '../../../backend/contexts/boards/modules/card/card.schema'
export * from './card.api'
```

Nothing in the frontend imports a use case, an entity or a repository, and the lint
makes sure of it (below): the frontend never imports `backend/`; `@cooper/api` may
import `backend/contexts/<context>/modules/<module>/<module>.schema.ts` and nothing
else. A few contracts have no backend schema of that shape (the web session lives in
`shared/`, the workspaces boards serves are auth's tenants), and those are written in
`@cooper/api` itself, as `*.contract.ts`, in plain zod.

## Talking to the API: Requester

Every client extends `Requester`. It knows the base URL, `/api`, and does the rest of
what every request shares: JSON in and out, the cookie (`credentials: 'include'`), and
a failed answer turned into an `ApiError`:

```ts
// cooper/libs/api/core/requester.ts
import type { ErrorBody } from 'newt/contract'
import { ApiError } from './api-error'
import type { QueryParams } from './query-params'

const BASE_URL = '/api'

/**
 * What every API client shares: the base URL, query params, JSON in and out, and
 * turning a failed answer into an `ApiError`. A client only says its `path` and
 * which requests it makes.
 */
export abstract class Requester {

  /** Called when the backend says the session is gone (401), wherever the request came from. */
  static onUnauthorized: (() => void) | null = null

  /** The client's part of the URL, after `/api`: `/proposals`. */
  protected abstract readonly path: string

  protected get<T>(path: string, params?: QueryParams): Promise<T> {
    return this.call<T>('GET', path, undefined, params)
  }

  /** With `headers` of its own, such as an `Idempotency-Key`. */
  protected post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.call<T>('POST', path, body, undefined, headers)
  }

  protected put<T>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('PUT', path, body)
  }

  protected patch<T>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('PATCH', path, body)
  }

  protected delete<T>(path: string): Promise<T> {
    return this.call<T>('DELETE', path)
  }

  private async call<T>(method: string, path: string, body?: unknown, params?: QueryParams, headers?: Record<string, string>): Promise<T> {
    let response: Response
    try {
      response = await fetch(this.url(path, params), {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'include',
      })
    } catch (error) {
      throw new ApiError(0, error instanceof Error ? error.message : 'Request failed')
    }

    if (!response.ok) {
      if (response.status === 401) Requester.onUnauthorized?.()
      const failure = (await response.json().catch(() => null)) as Partial<ErrorBody> | null
      throw new ApiError(response.status, failure?.error ?? response.statusText ?? 'Request failed', failure?.code)
    }

    return (response.status === 204 ? undefined : await response.json()) as T
  }

  private url(path: string, params?: QueryParams): string {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) query.set(key, String(value))
    }
    const search = query.size ? `?${query}` : ''
    return `${BASE_URL}${this.path}${path}${search}`
  }
}
```

The failure is read as an `ErrorBody`, the type from `newt/contract`. Whatever the
backend throws, newt's router answers with that body
([chapter 3](./03-pages-and-errors)), so a client reads every failure the same way:
`error` is the message to show, `code` is what it acts on. `ApiError` keeps both,
with the status (0 when there was no answer at all):

```ts
// cooper/libs/api/core/api-error.ts
/** A failed request: the backend's status, message and error `code`. Status 0 is no answer at all. */
export class ApiError extends Error {

  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
```

The forms act on `code`. A `FormStore` takes which codes belong to a field
(`{ 'user.email_taken': 'email' }` in the sign-up form) and its own words for the ones
that belong to none (`{ 'card.too_many': '…' }` in the card forms). The message
changes with `setMessages`; the code never does, so that is what the frontend keys
on.

A 401 anywhere calls `Requester.onUnauthorized`. boards' `main.tsx` sets it to show
the way to sign in again: whatever request finds the session gone, the screen says so.

## CardApi

This is the client of boards' `card` module, one method per route:

```ts
// cooper/libs/api/card/card.api.ts
import type {
  CardAssignDTO,
  CardCreateDTO,
  CardDTO,
  CardEditDTO,
  CardMoveDTO,
  CardSearchDTO,
} from '../../../backend/contexts/boards/modules/card/card.schema'
import type { Page } from 'newt/contract'
import type { PageRequest } from '../core/page-request'
import { Requester } from '../core/requester'

/** The backend's `card` module: the cards of a workspace's boards. */
export class CardApi extends Requester {
  protected readonly path = '/workspaces'

  /** A board's cards, column by column and from the top. */
  listInBoard(workspaceId: string, boardId: string) {
    return this.get<CardDTO[]>(`/${workspaceId}/boards/${boardId}/cards`)
  }

  getCard(workspaceId: string, cardId: string) {
    return this.get<CardDTO>(`/${workspaceId}/cards/${cardId}`)
  }

  /** A page of the workspace's cards with the text, that pass the filter. */
  search(workspaceId: string, input: CardSearchDTO, page?: PageRequest) {
    const query = new URLSearchParams()
    if (page?.size !== undefined) query.set('size', String(page.size))
    if (page?.cursor) query.set('cursor', page.cursor)
    return this.post<Page<CardDTO>>(`/${workspaceId}/cards/search${query.size ? `?${query}` : ''}`, input)
  }

  /**
   * A new card at the bottom of a column, with the board's next number. Each submit
   * has an `Idempotency-Key` of its own: the same request sent again with it (its
   * answer lost on the way) gets the card it made the first time, not a second one.
   */
  create(workspaceId: string, boardId: string, input: CardCreateDTO, idempotencyKey: string = crypto.randomUUID()) {
    return this.post<CardDTO>(`/${workspaceId}/boards/${boardId}/cards`, input, { 'idempotency-key': idempotencyKey })
  }

  edit(workspaceId: string, cardId: string, input: CardEditDTO) {
    return this.patch<CardDTO>(`/${workspaceId}/cards/${cardId}`, input)
  }

  /** To a column of its board, at a position (the bottom when none is given). */
  move(workspaceId: string, cardId: string, input: CardMoveDTO) {
    return this.post<CardDTO>(`/${workspaceId}/cards/${cardId}/move`, input)
  }

  /** To a member of the workspace: a 400 `card.assignee_not_member` for anyone else. */
  assign(workspaceId: string, cardId: string, input: CardAssignDTO) {
    return this.post<CardDTO>(`/${workspaceId}/cards/${cardId}/assign`, input)
  }

  unassign(workspaceId: string, cardId: string) {
    return this.post<CardDTO>(`/${workspaceId}/cards/${cardId}/unassign`)
  }

  remove(workspaceId: string, cardId: string) {
    return this.delete<void>(`/${workspaceId}/cards/${cardId}`)
  }
}
```

Two methods deserve a look.

**`create` sends an `Idempotency-Key`.** [Chapter 9](./09-idempotent-posts) made
`POST /boards/:boardId/cards` keep the answer to each key, so the same request sent
again gets the card the first one made. The key is the client's to make, and this is
where cooper makes it: `crypto.randomUUID()`, a new one each time the method is called
without one. The form's submit calls `create` once per click, so each submit has its
own key: two clicks are two cards, as they should be. Whoever sends a request again
because its answer was lost (a retry after a timeout) passes the key it used the first
time, as the third argument, and gets the same card back. `post` takes `headers` of
its own for this.

`crypto.randomUUID()` is in every browser and in Bun, so the same client runs in the
app and in a test.

**`search` sends a filter and asks for a page.** Its body is a `CardSearchDTO`: the
words, and a `filter` that `CardFilter` (chapter 15's `defineFilter`) checks on the
server: `board`, `column`, `assignee` and `number`, with their operators, at most two
levels and ten conditions. The client builds it from the search screen's choices:

```ts
{ text: 'login', filter: { and: [{ field: 'board', op: 'eq', value: boardId }, { field: 'assignee', op: 'eq', value: userId }] } }
```

The page goes in the query, `size` and `cursor`, and the answer is a `Page<CardDTO>`:
`items`, `hasMore`, `total`. The search screen hands `search` to a `ListStore`, which
asks for the first page and then for more, with the id of the last card shown as the
cursor. The type of the page comes from `newt/contract`; the server's
`pageRequestFrom` reads the same two parameters.

Its test replaces `fetch` and looks at the headers each call sent:

```ts
// cooper/libs/api/card/card.api.test.ts
import { afterEach, describe, expect, test } from 'bun:test'
import { CardApi } from './card.api'

const originalFetch = globalThis.fetch
const sent: Headers[] = []

afterEach(() => {
  globalThis.fetch = originalFetch
  sent.length = 0
})

describe('CardApi', () => {
  test('sends each new card with an Idempotency-Key of its own, or the one it is given again', async () => {
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent.push(new Headers(init?.headers))
      return Response.json({ id: 'c-1' }, { status: 201 })
    }) as typeof fetch
    const cards = new CardApi()
    const input = { columnId: 'todo', title: 'Plan' }

    await cards.create('acme', 'roadmap', input)
    await cards.create('acme', 'roadmap', input)
    await cards.create('acme', 'roadmap', input, 'submit-1')

    const keys = sent.map(headers => headers.get('idempotency-key'))
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).not.toBe(keys[0])
    expect(keys[2]).toBe('submit-1')
    expect(sent[0]!.get('content-type')).toBe('application/json')
  })
})
```

It is a test of `bun test cooper` like any other: the libraries' tests (the stores,
the form, the injector, the requester, this one) came with the checkout.

## Development: a Vite server per app, and its proxy

In development each app has a Vite server, which serves it from source and reloads it
as you edit. Both apps' configs come from one function:

```ts
// cooper/frontend/vite-app.ts
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type UserConfig } from 'vite'

type CooperApp = {
  /** The app's folder name under cooper/frontend, and under dist/cooper once built. */
  name: 'auth' | 'boards'
  /** The dev server's port. */
  port: number
  /** Paths the dev server hands to the backend: the app reaches it through its own origin. */
  proxy: string[]
}

/** Each context's port in dev, as the backend reads it (`COOPER_<NAME>_PORT`), with its defaults. */
const BACKEND_PORTS = { auth: 3001, boards: 3002 } as const

/** The app's context in dev, which the proxied paths go to. */
function backendOf(name: CooperApp['name']): string {
  return `http://localhost:${Number(process.env[`COOPER_${name.toUpperCase()}_PORT`] ?? BACKEND_PORTS[name])}`
}

const libs = (name: string) => fileURLToPath(new URL(`../libs/${name}`, import.meta.url))

/**
 * What the two apps share: React, Tailwind, the aliases of cooper's libraries,
 * a fixed dev port that proxies to the app's context, and the build in
 * `dist/cooper/<name>`, which that context serves in production.
 */
export function cooperApp({ name, port, proxy }: CooperApp): UserConfig {
  return defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@cooper/ui': libs('ui'),
        // The API client: the only way the frontend reaches the backend.
        '@cooper/api': libs('api'),
        '@cooper/core': libs('core'),
      },
    },
    server: {
      port,
      strictPort: true,
      proxy: Object.fromEntries(proxy.map(path => [path, backendOf(name)])),
    },
    build: {
      outDir: fileURLToPath(new URL(`../../dist/cooper/${name}`, import.meta.url)),
      emptyOutDir: true,
    },
  })
}
```

- **`resolve.alias`** maps `@cooper/ui`, `@cooper/api` and `@cooper/core` to their
  folders under `cooper/libs`. They are not packages; the aliases (and the `paths` of
  the tsconfigs, below) make them look like ones.
- **`server.port`** is fixed, with `strictPort`: if the port is taken, Vite fails
  instead of moving to another one.
- **`server.proxy`** sends the paths the app gives on to its context, on its own port
  (`COOPER_AUTH_PORT`, `COOPER_BOARDS_PORT`, with the backend's defaults).
- **`build.outDir`** is `dist/cooper/<name>`, which the context serves once built.

Each app's config is one line:

```ts
// cooper/frontend/auth/vite.config.ts
import { cooperApp } from '../vite-app'

// Signing in, signing up and granting access. Its context is the OAuth server: the
// API, the authorization endpoints and their metadata.
export default cooperApp({ name: 'auth', port: 5171, proxy: ['/api', '/oauth', '/.well-known'] })
```

```ts
// cooper/frontend/boards/vite.config.ts
import { cooperApp } from '../vite-app'

// The SaaS. Its context serves the API.
export default cooperApp({ name: 'boards', port: 5172, proxy: ['/api'] })
```

The ports are not arbitrary: 5171 and 5172 are the **public URLs** of auth and boards
in `config.ts` (`COOPER_AUTH_PUBLIC_URL`, `COOPER_BOARDS_PUBLIC_URL`), the addresses
people open. In development the browser only ever talks to the Vite server. The app
calls `/api/workspaces/acme/cards/...` on its own origin, Vite passes it to `:3002`, and the answer
comes back through the same origin. So boards' session cookie is set on
`localhost:5172`, the same origin the page is on, and a redirect that boards builds
from its public URL (`/api/session/callback`) lands on the Vite server, which passes
it on again. auth's proxy has more paths because its context serves more than its
API: the OAuth endpoints (`/oauth/authorize`, `/oauth/token`) and their metadata
under `/.well-known`.

## Production: each context serves its frontend

Built, there is no Vite. Each context serves its own app, on its own port and, in
production, its own domain: the public URL and the context's address are the same
again. Add where each context finds its build to `config.ts`, at the end of `auth`:

```ts
// cooper/backend/config.ts
    /** `COOPER_AUTH_FRONTEND`: its built frontend (`bun run cooper:build`). */
    frontendFolder: fromRoot(env.COOPER_AUTH_FRONTEND ?? 'dist/cooper/auth'),
  },
```

and at the end of `boards`:

```ts
// cooper/backend/config.ts
    /** `COOPER_BOARDS_FRONTEND`: its built frontend. */
    frontendFolder: fromRoot(env.COOPER_BOARDS_FRONTEND ?? 'dist/cooper/boards'),
  },
}
```

and change the comment above `config` to say so:

```ts
// cooper/backend/config.ts
/**
 * cooper's settings, from environment variables, with what development needs by
 * default. Each context has its own: where it listens, where its database lives,
 * where people open it and the built frontend it serves.
 */
```

`ServedContext` takes the folder in its config and hands it to `serve` as
`frontend`:

```ts
// cooper/backend/shared/served-context.ts
import { BoundedContext } from 'newt/runtime'
import type { ServeOptions } from 'newt/http'
import type { CooperBase } from './cooper-base'

export type ServedContextConfig = {
  /** Where its server listens: 0 for any free port (tests). */
  port: number
  /** The built frontend it hands out for every address its routes do not take. */
  frontendFolder: string
}

/**
 * A context of cooper's: its own server, on its own port and, in production, its own
 * domain, so its sessions (cookies) are its own too. It answers `GET /api/health`
 * without a session, for whoever watches it is up.
 */
export abstract class ServedContext extends BoundedContext<CooperBase> {

  protected constructor(name: string, base: CooperBase, private readonly served: ServedContextConfig) {
    super(name, base)
  }

  /** What its server answers besides its modules' API: OAuth's endpoints, an MCP entry. */
  protected routes(): Bun.Serve.Routes<undefined, string> {
    return {}
  }

  /** How it is served (`runContexts`, `serve`): its modules' API, what it adds, its health, and its frontend for any other address. */
  serving(): ServeOptions {
    return { port: this.served.port, router: this.base.http, routes: this.routes(), frontend: this.served.frontendFolder, health: true }
  }
}
```

`Auth_Context` and `Boards_Context` already pass `config.auth` and `config.boards` to
`super`, so they need no change. The test context of
[chapter 22](./22-web-session) builds its config by hand, so it gives one too, in
`web-session.test.ts`:

```ts
// cooper/backend/shared/web-session/web-session.test.ts
  private constructor(base: CooperBase, readonly session: WebSession_Module, port: number) {
    super('client', base, { port, frontendFolder: config.boards.frontendFolder })
  }
```

What `frontend` gives you, from `newt/http`:

- **Every address no route takes.** The router has `/api`; the context's `routes()`
  (auth's `/oauth/*` and `/.well-known/*`) and `health` come before the frontend too.
  Anything else is the frontend's.
- **A file, or `index.html`.** A path that names a file of the folder gets the file
  (`/assets/index-….js`, `/cooper.svg`); any other gets `index.html`, so
  `/w/acme/boards` opens the app and React Router shows the board (or its own "not
  found"). A path that leaves the folder names no file.
- **Never under `/api`.** A path under `/api` that no route takes is a 404 with an
  `ErrorBody` (`route_not_found`), never the app's page: a client that calls a wrong
  address gets an error it can read, not HTML.
- **Pages that refuse to be framed.** `index.html` and every other HTML file go out
  with `X-Frame-Options: DENY` and `frame-ancestors 'none'`: nobody can show auth's
  approval page inside theirs and steal the click.
- **A clear answer before the build.** If the folder has no `index.html`, the pages
  answer `503 The frontend is not built: its folder has no index.html`. The API works
  all the same, which is why the tests need no build.

## The scripts: cooper and cooper:build

Add two scripts to the root `package.json`, around `cooper:seed`:

```json
"cooper": "bun run cooper/scripts/dev.ts --watch",
"cooper:seed": "bun run cooper/scripts/seed.ts",
"cooper:build": "vite build cooper/frontend/auth && vite build cooper/frontend/boards"
```

`cooper:build` builds both apps into `dist/cooper/auth` and `dist/cooper/boards`, the
folders `frontendFolder` names by default. `cooper` starts cooper in development with
the script the checkout brought:

```ts
// cooper/scripts/dev.ts
// bun run cooper: cooper in development, and stops it all together. The backend (every
// context, each on its port) and the Vite server of each frontend, which sends the
// API's addresses on to its context. With --watch the backend restarts on every change.
// Each service runs in its own process group, so stopping it also stops what it spawns.
// The ports are fixed (each service fails instead of moving to another one), so the
// links below always hold.
import { config } from '../backend/config'

const watch = Bun.argv.includes('--watch')

/** A frontend's Vite server, on the port of its context's public URL. */
const frontend = (name: 'auth' | 'boards') => {
  const url = config[name].publicUrl
  return { name: `${name} UI`, url, cmd: ['bun', 'x', 'vite', `cooper/frontend/${name}`, '--port', new URL(url).port, '--strictPort'] }
}

const SERVICES = [
  frontend('auth'),
  frontend('boards'),
  { name: 'backend', url: `http://localhost:${config.auth.port}/api/health`, cmd: ['bun', ...(watch ? ['--watch'] : []), 'cooper/backend/index.ts'] },
]

// The backend serves every context, each one on its own port: they must all be free.
const PORTS = [
  ...SERVICES.filter(service => service.name !== 'backend').map(({ name, url }) => ({ name, port: Number(new URL(url).port) })),
  ...(['auth', 'boards'] as const).map(name => ({ name: `${name} API`, port: config[name].port })),
]

// Nothing starts unless every port is free: `bun --watch`, for one, stays alive after
// failing to listen, so a taken port would go unnoticed otherwise.
async function isTaken(port: number) {
  for (const hostname of ['127.0.0.1', '::1']) {
    try {
      const socket = await Bun.connect({ hostname, port, socket: { data() {} } })
      socket.end()
      return true
    } catch {
      // Nothing listening on this address.
    }
  }
  return false
}

const taken = (await Promise.all(PORTS.map(async each => ((await isTaken(each.port)) ? each : null)))).filter(each => each !== null)
if (taken.length > 0) {
  for (const { name, port } of taken) console.error(`${name}: port ${port} is already in use`)
  console.error('Nothing was started.')
  process.exit(1)
}

const children = SERVICES.map(({ cmd }) => Bun.spawn(cmd, { detached: true, stdio: ['inherit', 'inherit', 'inherit'] }))

function signalGroups(signal: NodeJS.Signals) {
  for (const child of children) {
    try {
      process.kill(-child.pid, signal)
    } catch {
      // The group is already gone.
    }
  }
}

let stopping = false

async function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  signalGroups('SIGINT')
  // Whatever ignores SIGINT gets SIGTERM after a grace period.
  const timeout = setTimeout(() => signalGroups('SIGTERM'), 3000)
  await Promise.all(children.map(child => child.exited))
  clearTimeout(timeout)
  process.exit(code)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void shutdown())

// If any service dies on its own, everything stops with it.
children.forEach((child, index) => {
  void child.exited.then(code => {
    if (stopping) return
    console.error(`${SERVICES[index]!.name} exited (code ${code}): stopping everything.`)
    void shutdown(1)
  })
})

async function waitUntilUp(url: string) {
  while (!stopping) {
    try {
      await fetch(url)
      return
    } catch {
      await Bun.sleep(200)
    }
  }
}

// Once everything answers, print where each frontend lives.
void Promise.all(SERVICES.map(({ url }) => waitUntilUp(url))).then(() => {
  if (stopping) return
  const names = ['auth', 'boards'] as const
  const width = Math.max(...names.map(name => name.length))
  console.log(['', ...names.map(name => `  ${name.padEnd(width)}  ${config[name].publicUrl}  (API on port ${config[name].port})`), ''].join('\n'))
})

await Promise.all(children.map(child => child.exited))
```

It starts three processes: the backend (`bun --watch cooper/backend/index.ts`, which
restarts it on every change) and one Vite server per app, each on the port of its
context's public URL. Before starting anything it checks that the four ports are
free: `bun --watch` stays alive after failing to listen, so a taken port would go
unnoticed otherwise. Each process runs in a group of its own, so Ctrl+C stops what
each one spawned too; whatever ignores the `SIGINT` gets a `SIGTERM` three seconds
later. If one dies on its own, everything stops with it. When all of them answer, it
prints where each app lives.

## TypeScript: a project for the browser

The backend's project has no DOM, and must not: a backend file that touched `window`
would compile and fail at run time. The apps need the DOM and JSX, so they get a
project of their own. Create `tsconfig.frontend.json` at the root:

```json
{
  // What runs in the browser: cooper's frontends, their UI library and their API
  // clients, with the backend's contracts (its modules' *.schema.ts) they share.
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "types": ["vite/client", "bun"],
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "paths": {
      "@cooper/ui/*": ["./cooper/libs/ui/*"],
      "@cooper/api/*": ["./cooper/libs/api/*"],
      "@cooper/core/*": ["./cooper/libs/core/*"]
    }
  },
  "include": [
    "cooper/frontend/**/*.ts",
    "cooper/frontend/**/*.tsx",
    "cooper/libs/**/*.ts",
    "cooper/libs/**/*.tsx",
    "cooper/backend/contexts/*/modules/*/*.schema.ts"
  ],
  "exclude": ["**/node_modules", "cooper/frontend/*/vite.config.ts"]
}
```

Note the last `include`: the modules' schemas are checked in this project too, with
the browser's types, besides the backend's. `bun` stays in `types` because the
libraries' tests run on `bun test`.

The root `tsconfig.json` references it, and repeats the `paths`, because Bun resolves
imports (in `bun test`) with the root file:

```json
{
  // The whole repository, as four projects: the framework (newt), what runs on the
  // server (cooper's backend), what runs in the browser (cooper's frontends and their
  // libraries), and the tools around them (scripts, Vite's configs). `bun check` follows the references.
  // The paths are here too because Bun resolves imports with this file. newt is not among
  // them: it is a workspace package, reached through its `exports` as any application reaches it.
  "compilerOptions": {
    "paths": {
      "@cooper/ui/*": ["./cooper/libs/ui/*"],
      "@cooper/api/*": ["./cooper/libs/api/*"],
      "@cooper/core/*": ["./cooper/libs/core/*"]
    }
  },
  "files": [],
  "references": [
    { "path": "./tsconfig.newt.json" },
    { "path": "./tsconfig.backend.json" },
    { "path": "./tsconfig.frontend.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

The Vite configs run in Bun, not in the browser, so they are left out of the frontend
project and go to the tools' one. In `tsconfig.node.json`, change the comment and the
`include`:

```json
{
  // The tools around the application: cooper's scripts and its frontends' Vite configs.
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "moduleDetection": "force",
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true
  },
  "include": ["cooper/scripts/**/*.ts", "cooper/frontend/*/vite.config.ts"],
  "exclude": ["**/node_modules"]
}
```

## Lint: the frontend half

`newt-eslint` lints the backend. The frontend gets rules of its own, in the same
`eslint.config.js`. Replace it:

```js
import tseslint from 'typescript-eslint'
import { newt } from 'newt-eslint'

// cooper is an application built with newt: its backend keeps newt's lint, and its
// frontends the rules of a UI built from one library. The framework's own code is not
// an application, so it is left out.

const BACKEND = newt({
  files: ['cooper/backend/**/*.ts', 'cooper/scripts/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'] } },
})

// The frontends build their UI from @cooper/ui only. Styling lives in cooper/libs/ui and
// in each app's own components/ folder; everywhere else, class names and inline styles
// are forbidden, and so is reaching past @cooper/ui into shadcn or Radix.

const FRONTEND = ['cooper/frontend/**/*.{ts,tsx}', 'cooper/libs/**/*.{ts,tsx}']
// Where styling is allowed: the UI library, and each app's own UI pieces.
const STYLED = ['cooper/libs/ui/**', 'cooper/frontend/*/components/**']

const STYLING_MESSAGE = 'Apps do not style: use a component from @cooper/ui or from this app\'s own components/ folder.'

const UI_IMPORTS = [
  { group: ['radix-ui', '@radix-ui/*'], message: 'Use a component from @cooper/ui instead.' },
  { group: ['@cooper/ui/shadcn', '@cooper/ui/shadcn/*', '**/libs/ui/shadcn', '**/libs/ui/shadcn/**'], message: 'shadcn is private to @cooper/ui: use @cooper/ui/components/*.' },
]

// The frontend reaches the backend only through @cooper/api, the API clients.
const BACKEND_IMPORTS = {
  regex: '(^|/)backend(/|$)',
  message: 'The frontend never imports the backend: use the client in @cooper/api.',
}

// The API clients share the backend's contract, never its code: a module's schema file
// is the only thing they may import from the backend.
const API_BACKEND_IMPORTS = {
  regex: '(^|/)backend(/(?!contexts/[^/]+/modules/[^/]+/[^/]+\\.schema(\\.[jt]s)?$)|$)',
  message: '@cooper/api may only import a backend module\'s *.schema.ts (its contract).',
}

export default [
  { ignores: ['packages/**', 'web/**', '**/dist/**'] },
  ...BACKEND,
  {
    files: FRONTEND,
    languageOptions: { parser: tseslint.parser },
  },
  {
    files: ['cooper/frontend/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...UI_IMPORTS, BACKEND_IMPORTS] }],
    },
  },
  {
    files: ['cooper/libs/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [BACKEND_IMPORTS] }],
    },
  },
  {
    files: ['cooper/libs/api/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [...UI_IMPORTS, API_BACKEND_IMPORTS] }],
    },
  },
  {
    files: FRONTEND,
    ignores: STYLED,
    rules: {
      'no-restricted-syntax': ['error',
        { selector: 'JSXAttribute[name.name=/^(className|class|style)$/]', message: STYLING_MESSAGE },
        { selector: 'JSXAttribute > JSXNamespacedName[namespace.name=/^(class|style)$/]', message: STYLING_MESSAGE },
        { selector: 'JSXElement[openingElement.name.name="style"]', message: STYLING_MESSAGE },
      ],
    },
  },
]
```

The backend half is as it was. The frontend half uses ESLint's own rules, with
typescript-eslint's parser for `.ts` and `.tsx`:

- **The apps** (`cooper/frontend`) never import `backend/`, nor Radix or shadcn
  directly: what they show comes from `@cooper/ui`, what they ask comes from
  `@cooper/api`.
- **`@cooper/ui`** never imports `backend/` either.
- **`@cooper/api`** may import from `backend/` only a path of the form
  `contexts/<context>/modules/<module>/<file>.schema.ts`: the contract. A client that
  imported `card.module.ts` would bring use cases, repositories and `newt/core` into
  the browser.
- **Nobody styles** outside `cooper/libs/ui` and an app's own `components/` folder: no
  `className`, `class` or `style` attribute, no `<style>` element.

This is what the lint says when a client reaches past the schema, and when a page
styles itself:

```text
cooper/frontend/boards/pages/home/bad.tsx
  1:29  error  Apps do not style: use a component from @cooper/ui or from this app's own components/ folder  no-restricted-syntax

cooper/libs/api/card/bad.ts
  1:1  error  '../../../backend/contexts/boards/modules/card/card.module' import is restricted from being used by a pattern. @cooper/api may only import a backend module's *.schema.ts (its contract)  no-restricted-imports

✖ 2 problems (2 errors, 0 warnings)
```

The lint checks the path; what keeps the schema itself safe for a browser is that it
imports `newt/contract`, never `newt/core`. That one is yours to keep.

## Check it

The gate, with the new project and the libraries' tests:

```sh
bun install && bunx tsc -b --noEmit && bun test cooper && bun run lint
```

```text
 127 pass
 0 fail
 457 expect() calls
Ran 127 tests across 19 files.
```

Build both apps:

```sh
bun run cooper:build
ls dist/cooper
```

```text
auth
boards
```

Then start everything:

```sh
bun run cooper
```

```text
auth listening on http://localhost:3001/
boards listening on http://localhost:3002/

  VITE v8.3.4  ready in 229 ms

  ➜  Local:   http://localhost:5171/

  VITE v8.3.4  ready in 224 ms

  ➜  Local:   http://localhost:5172/

  auth    http://localhost:5171  (API on port 3001)
  boards  http://localhost:5172  (API on port 3002)
```

(Vite also warns that `vite.config.ts` imports `../vite-app` without a file
extension, for a config loader it does not use yet; it changes nothing.)

Both apps answer, and boards' API answers through its Vite server:

```sh
curl -s localhost:5171 | grep -o '<title>.*</title>'
curl -s localhost:5172 | grep -o '<title>.*</title>'
curl -s localhost:5172/api/health
curl -s -i localhost:5172/api/session/sign-in | grep -i '^HTTP\|^location'
```

```text
<title>Sign in · Cooper</title>
<title>Cooper</title>
{"status":"ok"}
HTTP/1.1 302 Found
location: http://localhost:5171/oauth/authorize?response_type=code&client_id=cooper&redirect_uri=http%3A%2F%2Flocalhost%3A5172%2Fapi%2Fsession%2Fcallback&code_challenge=…&code_challenge_method=S256&state=…
```

Signing in goes to auth's app, and comes back to boards' Vite server. Open
`http://localhost:5172` in a browser and sign in: boards sends you to auth's sign-in
page, where you can sign up; auth answers its own product's request at once (cooper
asks nobody's consent to sign in to cooper), and you are back on boards.

The built apps are served by the contexts themselves, on their own ports:

```sh
curl -s localhost:3001/ | grep -o '<title>.*</title>'
curl -s localhost:3002/boards | grep -o '<title>.*</title>'
curl -s localhost:3002/api/nothing
```

```text
<title>Sign in · Cooper</title>
<title>Cooper</title>
{"error":"Cooper has nothing at GET /api/nothing","code":"route_not_found"}
```

`/boards` is no file of the build, so it gets `index.html`; `/api/nothing` is under
`/api`, so it gets a 404 the client can read. Ctrl+C stops all of it.

## What to remember

- `newt/contract` is the part of newt a browser may load: value objects, the domain
  errors' bases, `defineFilter`, `Page`, `PageRequest`, `ErrorBody`. `newt/core`
  keeps a scope in `node:async_hooks` and stays on the server.
- A module's `*.schema.ts` is its contract, and the only backend file a client may
  import. It imports zod, `newt/contract`, value objects and other schemas; anything
  else only as a type. The lint keeps the clients to it.
- A client reads every failure as an `ErrorBody` and acts on `code`, never on the
  message.
- The client makes the `Idempotency-Key`: a new `crypto.randomUUID()` per submit, the
  same one when the same submit is sent again.
- In development the browser talks only to Vite, on the context's public URL, which
  proxies the context's paths; built, each context serves its own app
  (`frontendFolder`) for every address its routes do not take, never under `/api`.

Next: [An MCP server](./24-mcp-server).
