# The frontends and newt/contract

cooper's backend does everything a person needs: Ana signs up at auth, makes Acme,
signs in to boards and keeps her cards. But she does all of it with `curl`. Since
[chapter 22](./22-web-session), boards sends her browser to auth's
`/oauth/authorize`, and auth sends it on to pages it does not have yet: a sign-in
form, and the page where she says yes to boards.

This chapter gives cooper its two web apps: **auth's** (sign in, sign up, approve
an application) and **boards'** (the SaaS: workspaces, boards, cards, search,
settings). They are React apps built with newt's two frontend packages, and Bun builds
and serves them. The tutorial is about the backend, so you copy the apps from the
repository instead of typing them. What this chapter teaches is where they touch the
backend and newt:

- **`newt/contract`**, the part of newt a browser may load, and why it is apart from
  `newt/core`;
- the rule that keeps the frontend from importing the backend's code, while it shares
  its **contract**, the modules' `*.schema.ts`;
- the API clients, with `CardApi` in detail: the `Idempotency-Key` of
  [chapter 9](./09-idempotent-posts) and the search of [chapter 16](./16-search-port);
- how each context serves its own app, on its own port: from its sources in
  development, built in production;
- the scripts `cooper` and `cooper:build`, a TypeScript project for the browser, and
  the frontend half of the lint.

## What you copy

The apps, their libraries and the two scripts come from the tag:

```sh
git checkout tutorial/23 -- cooper/frontend cooper/libs cooper/scripts/dev.ts cooper/scripts/build.ts
```

```
cooper/
  frontend/
    auth/                  auth's app: index.html, app.css, main.tsx, app.routes.tsx, pages/, services/, public/
    boards/                boards' app: the same shape, with modules/ for its zones
  libs/
    api/                   @cooper/api: the API clients, the only way to the backend
    ui/                    @cooper/ui: cooper's own components (the board, the counter, the logo)
  scripts/
    dev.ts                 bun run cooper: the backend, serving the apps from their sources
    build.ts               bun run cooper:build: the apps, built
```

There is nothing to install. The root `package.json` has had what the apps need since
chapter 0: newt's frontend packages, `newt-react` and `newt-react-ui`, and what they
build on (React, React Router, Radix, Tailwind and `bun-plugin-tailwind`).

The rest of the chapter is typed: the backend learns to serve the apps, and the root's
`package.json` scripts, `tsconfig*.json` and `eslint.config.js` grow. The files the
checkout brought that touch the backend or newt are shown below, so you know what they
do.

## The apps in a few lines

Both apps stand on two packages of the repository, which any newt application can use:

- **`newt-react-ui`** is the components: buttons, fields, dialogs, tables, boxes, the
  app's shell, each imported by its name (`newt-react-ui/button`). They are built on
  shadcn and Radix and styled with Tailwind, with one theme (`newt-react-ui/theme.css`,
  the system's own fonts, light and dark). It comes with its lint (below): an app
  composes its components and styles nothing.
- **`newt-react`** is what the apps think with: a `Store` (a service's state in a
  signal, read with `useValue`), services and their injector (`inject`, `Provide`,
  `useService`), a `FormStore` (a form's values, errors and submit, validated with a
  zod schema) and its `FormField` (`newt-react/form-field`), a `ListStore` (a list read
  page by page), `Requester` and `ApiError` (the requests to a newt API) and the
  `ThemeService`.

cooper adds two libraries of its own, under `cooper/libs`:

- **`@cooper/ui`** is the few components only cooper has: the board and its columns,
  the counter, the logo. They wrap `newt-react-ui`'s, and they are the only code of
  cooper that styles.
- **`@cooper/api`** is one client per backend module, below.

Each app is an `index.html`, which names its icon (`./public/cooper.svg`), its styles
(`./app.css`) and its script (`./main.tsx`); a `main.tsx` that mounts React; and an
`app.routes.tsx` with React Router. Its `app.css` is newt-react-ui's theme, and where
Tailwind finds the classes of cooper's own components:

```css
/* cooper/frontend/boards/app.css */
/* The app's styles: newt-react-ui's theme, and cooper's own components, which Tailwind
   reads for the classes they use. Pages use none. */
@import "newt-react-ui/theme.css";
@source "../../libs/ui";
```

auth's routes are `sign-in`, `sign-up`, `authorize/:id` and `error`: the pages its
OAuth server sends the browser to. boards' are behind a session guard (no session: it
shows a sign-in button where the page would be, which starts chapter 22's round trip
at `/api/session/sign-in`), then the workspace's zones (`w/:workspaceId/boards`,
`search`, `settings`), each loaded the first time someone enters it.

A screen is a component made of newt-react-ui's components that reads a service's
signals; the service holds the state and calls the API. This is the sign-up form's
service:

```ts
// cooper/frontend/auth/pages/sign-up/sign-up.service.ts
import { SessionApi } from '@cooper/api/session'
import { UserSignUpSchema } from '@cooper/api/user'
import { FormStore, inject } from 'newt-react'
import { SessionService } from '../../services/session/session.service'

/** Making an account, signed in at once. */
export class SignUpService {

  private readonly api = inject(SessionApi)
  private readonly session = inject(SessionService)

  readonly form = new FormStore(UserSignUpSchema, { email: '', name: '', password: '' }, { errorFields: { 'user.email_taken': 'email' } })

  /** For the product the person is on the way to, if any. Resolves to whether they are now signed in. */
  submit(productId: string | undefined): Promise<boolean> {
    return this.form.submit(async account => this.session.signedIn(await this.api.signUp({ ...account, productId })))
  }
}
```

A screen may say in advance what the backend would refuse: on a board, a column's
menu disables *Remove* while the column has cards, and on the board's last column ("a
board keeps one column", [chapter 8](./08-two-people-one-card)); the backend still
answers a 409 `card.column_not_empty` or `column.last` to whoever asks anyway.

None of that touches the backend. What does is in `@cooper/api`.

## newt/contract: what a browser may load

Since [chapter 2](./02-first-module) your schemas and value objects have imported
`ValueObject` and `ValidationError` from `newt/contract`, not from `newt/core`. This is
why.

`newt/core` is what a backend runs on. Among its pieces is the scope a use case runs
in: who is acting, in which workspace, by which clock, inside which transaction. newt
keeps that in an `AsyncLocalStorage`, from `node:async_hooks`, and `newt/core` creates
it as the module loads. A browser has no `node:async_hooks`. Bun, building an app for
the browser, puts an empty stand-in in its place without a word, and the page breaks
as soon as `newt/core` loads.

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
the browser as it is. `newt-react` imports nothing else of newt.

## The schema is the contract

A module's `*.schema.ts` says what goes into its use cases and what comes out. It is
the one file of the backend a client needs, so it is the one file a client may
import. For that to work, a schema file imports only:

- `zod`;
- `newt/contract`;
- its own module's value objects (which import `newt/contract`), and other modules'
  schemas;
- types, with `import type`, from anywhere but newt's other entries: they are erased
  before the browser sees the file. `card.schema.ts` imports the type `ActorVia` from
  `shared/actor.ts` this way.

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
else. A few folders keep a `*.contract.ts` of their own. The workspaces, their members
and their invitations are auth's tenants and accesses, which boards' routes serve in
the shapes of boards' `workspace.schema.ts`: `workspace.contract.ts`,
`workspace-member.contract.ts` and `invitation.contract.ts` re-export those shapes
(renamed where the app names them otherwise) and add only what someone types, such as
a workspace's name. The web session has no module at all (its routes live in
`shared/web-session`), so `web-session.contract.ts` writes its contract in plain zod.

## Talking to the API: Requester

Every client extends `Requester`, from `newt-react`. It knows the base URL, `/api`,
on the page's own origin, and does the rest of what every request shares: the query
params, JSON in and out, the cookie (`credentials: 'include'`), and a failed answer
turned into an `ApiError`. A client only says its `path` and which requests it makes,
with `get`, `post`, `put`, `patch` and `delete`.

The failure is read as an `ErrorBody`, the type from `newt/contract`. Whatever the
backend throws, newt's router answers with that body
([chapter 3](./03-pages-and-errors)), so a client reads every failure the same way:
`error` is the message to show, `code` is what it acts on. `ApiError` keeps both,
with the status (0 when there was no answer at all).

The forms act on `code`. A `FormStore` takes which codes belong to a field
(`errorFields: { 'user.email_taken': 'email' }` in the sign-up form above) and its
own words for the ones that belong to none (`{ 'card.too_many': '…' }` in the card
forms). The message changes with `setMessages`; the code never does, so that is what
the frontend keys on.

A 401 anywhere calls `Requester.onUnauthorized`. boards' `main.tsx` sets it to show
the way to sign in again: whatever request finds the session gone, the screen says so.

```tsx
// cooper/frontend/boards/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { RouterLinkProvider } from 'newt-react-ui/router-link'
import { Toaster } from 'newt-react-ui/toast'
import { Requester, rootInjector, ThemeService } from 'newt-react'
import { router } from './app.routes'
import { SessionService } from './services/session/session.service'

// The theme follows the stored choice from the first frame.
rootInjector.get(ThemeService)

// Whatever request finds the session gone shows the way to sign in again.
Requester.onUnauthorized = () => rootInjector.get(SessionService).expired()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterLinkProvider>
      <RouterProvider router={router} />
    </RouterLinkProvider>
    <Toaster />
  </StrictMode>,
)
```

## CardApi

This is the client of boards' `card` module, one method per route:

```ts
// cooper/libs/api/card/card.api.ts
import type { CardAssignDTO, CardCreateDTO, CardDTO, CardEditDTO, CardMoveDTO, CardSearchDTO } from '../../../backend/contexts/boards/modules/card/card.schema'
import type { Page } from 'newt/contract'
import { type PageRequest, Requester } from 'newt-react'

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
`items`, `hasMore`, `total`, and `nextCursor` when the server knows where the next page
starts. The search screen hands `search` to a `ListStore`, which asks for the first
page and then for more, from where the last page said the next one starts: its
`nextCursor`, or else the id of its last item. A search page may come empty and still
have more after it: the index found cards that are gone since, so the page has none of
them left, but its cursor is still the last one found. `ListStore` follows that cursor
on, past the empty pages, until a page has cards or says there are no more; with the
id of the last card shown it would ask for the same page again. The types of the page
come from `newt/contract` (`newt-react`'s `PageRequest` is newt's, with `size`
optional); the server's `pageRequestFrom` reads the same two parameters.

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

It is a test of `bun test cooper/` like any other.

## One port per context: pages and API

There is one address per context, and the browser only ever talks to it: auth on
3001, boards on 3002, in production each on its own domain. The context answers its
API under `/api` (and auth its OAuth endpoints) and hands its app's page to every
other address. So the app calls `/api/workspaces/acme/cards/...` on its own origin,
boards' session cookie is set on the origin the page is on, and a redirect boards
builds from its public URL (`/api/session/callback`) lands on boards itself. That is
why the public URLs of `config.ts` have been the contexts' own ports
(`http://localhost:3001`, `http://localhost:3002`) since you wrote them: there is
nothing in front.

What changes is where the app comes from: built, from a folder; in development, from
its sources.

## Built: each context serves its folder

Add where each context finds its build to `config.ts`, at the end of `auth`:

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
  (`/main-….js`, `/cooper.svg`); any other gets `index.html`, so `/w/acme/boards` opens
  the app and React Router shows the board (or its own "not found"). A path that leaves
  the folder names no file.
- **Never under `/api`.** A path under `/api` that no route takes is a 404 with an
  `ErrorBody` (`route_not_found`), never the app's page: a client that calls a wrong
  address gets an error it can read, not HTML.
- **Pages that refuse to be framed.** `index.html` and every other HTML file go out
  with `X-Frame-Options: DENY` and `frame-ancestors 'none'`: nobody can show auth's
  approval page inside theirs and steal the click.
- **A clear answer before the build.** If the folder has no `index.html`, the pages
  answer `503 The frontend is not built: its folder has no index.html`. The API works
  all the same, which is why the tests need no build.

## In development: from its sources

In development nobody wants to build after every edit. `frontend` also takes an app's
`index.html` imported (`import app from './index.html'`): Bun builds it as it serves
it, with whatever it names, and reloads the page as its files change. The root
`bunfig.toml`, there since chapter 0, gives that build Tailwind:

```toml
# Bun's bundler builds HTML with Tailwind: the gallery of newt-react-ui, and the apps that serve their pages with Bun.
[serve.static]
plugins = ["bun-plugin-tailwind"]
```

Importing an `index.html` starts that build, so production must not do it. Add the
setting that asks for it, at the end of `config`:

```ts
// cooper/backend/config.ts
// …
  /**
   * `COOPER_FRONTEND_SOURCES=1` (`bun run cooper` sets it): each context serves its
   * frontend from its sources, which Bun builds as it serves them and reloads as they
   * change, instead of its built folder.
   */
  frontendSources: env.COOPER_FRONTEND_SOURCES === '1',
}
```

Create `cooper/backend/frontend-sources.ts`, which imports each app only when called:

```ts
// cooper/backend/frontend-sources.ts
import type { HTMLBundle } from 'bun'

/**
 * Each context's frontend from its sources, for development (`bun run cooper`): every
 * context serves its pages beside its API, on its own port, as it will once built, and
 * Bun reloads them as they change. Imported only when asked for, so production never
 * builds them as it starts.
 */
export async function frontendSources(): Promise<Record<string, { frontend: HTMLBundle }>> {
  const [auth, boards] = await Promise.all([
    import('../frontend/auth/index.html'),
    import('../frontend/boards/index.html'),
  ])
  return { auth: { frontend: auth.default }, boards: { frontend: boards.default } }
}
```

And in `index.ts`, hand each context its app when the setting asks for it. Replace
the file:

```ts
// cooper/backend/index.ts
// bun cooper/backend/index.ts: cooper's backend. Every context in one process, each one
// served on its own port, with the worker of its jobs running, until SIGINT or SIGTERM.
import { runContexts } from 'newt/application'
import { config } from './config'
import { frontendSources } from './frontend-sources'
import { openContexts } from './open-contexts'
import { setCooperMessages } from './shared/messages'

// newt's own messages, in cooper's words, for the whole process: before anything answers.
setCooperMessages()
const contexts = await openContexts(config)

// In development each context serves its frontend from its sources, as Bun builds them.
const sources = config.frontendSources ? await frontendSources() : null

const app = runContexts(contexts.all.map(context => ({
  context,
  serve: { ...context.serving(), ...(sources?.[context.name] ? { ...sources[context.name], development: true } : {}) },
})))
for (const [name, server] of Object.entries(app.servers)) console.log(`${name} listening on ${server.url}`)
```

What a context's `serving()` gives stays as it is; `frontend` is replaced by the
app's sources, and `development: true` turns on Bun's development mode: its reloads,
and its error page, which shows the source, for what throws outside a route.

## The scripts: cooper and cooper:build

Add two scripts to the root `package.json`, around `cooper:seed`:

```json
"cooper": "bun run cooper/scripts/dev.ts --watch",
"cooper:seed": "bun run cooper/scripts/seed.ts",
"cooper:build": "bun cooper/scripts/build.ts"
```

`cooper:build` runs the script the checkout brought. It builds each app with
`Bun.build`, from its `index.html`, with Tailwind, into the folder `frontendFolder`
names by default:

```ts
// cooper/scripts/build.ts
// bun run cooper:build: each frontend built by Bun, with Tailwind, into dist/cooper/<app>:
// the folder its context serves in production. What its index.html names (its icon, its
// styles, its script) is built with it.
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import tailwind from 'bun-plugin-tailwind'

const ROOT = join(import.meta.dir, '../..')
const APPS = ['auth', 'boards'] as const

for (const app of APPS) {
  const source = join(ROOT, 'cooper/frontend', app)
  const out = join(ROOT, 'dist/cooper', app)
  await rm(out, { recursive: true, force: true })
  const built = await Bun.build({
    entrypoints: [join(source, 'index.html')],
    outdir: out,
    plugins: [tailwind],
    minify: true,
    // From the root: the app's router serves index.html at every address, however deep.
    publicPath: '/',
    // Fonts as files of their own, fetched when a page needs them, not inside the stylesheet.
    loader: { '.woff': 'file', '.woff2': 'file' },
    sourcemap: 'linked',
    target: 'browser',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  })
  if (!built.success) {
    for (const log of built.logs) console.error(log)
    process.exit(1)
  }
  console.log(`${app}: ${built.outputs.length} files in dist/cooper/${app}`)
}
```

`cooper` starts cooper in development with the other script: one process, the backend
with `COOPER_FRONTEND_SOURCES=1`, which `--watch` restarts on every change of its own
(the apps reload on their own). The part that says what it starts:

```ts
// cooper/scripts/dev.ts
// bun run cooper: cooper in development, and stops it all together. One process, the
// backend: every context on its port, each serving its API and its frontend from its
// sources, which Bun builds as it serves them and reloads as they change. With --watch
// the backend restarts on every change of its own. It runs in its own process group, so
// stopping it also stops what it spawns. The ports are fixed (it fails instead of moving
// to another one), so the links below always hold.
import { config } from '../backend/config'

const watch = Bun.argv.includes('--watch')

const SERVICES = [
  {
    name: 'backend',
    url: `http://localhost:${config.auth.port}/api/health`,
    cmd: ['bun', ...(watch ? ['--watch'] : []), 'cooper/backend/index.ts'],
    env: { ...process.env, COOPER_FRONTEND_SOURCES: '1' },
  },
]

// The backend serves every context, each one on its own port: they must all be free.
const PORTS = (['auth', 'boards'] as const).map(name => ({ name, port: config[name].port }))
// …
```

Before starting anything it checks that the contexts' ports are free: `bun --watch`
stays alive after failing to listen, so a taken port would go unnoticed otherwise. The
backend runs in a process group of its own, so Ctrl+C stops what it spawned too;
whatever ignores the `SIGINT` gets a `SIGTERM` three seconds later. When it answers,
the script prints where each context lives.

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
    "types": ["bun"],
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "paths": {
      "@cooper/ui/*": ["./cooper/libs/ui/*"],
      "@cooper/api/*": ["./cooper/libs/api/*"]
    }
  },
  "include": [
    "cooper/frontend/**/*.ts",
    "cooper/frontend/**/*.tsx",
    "cooper/libs/**/*.ts",
    "cooper/libs/**/*.tsx",
    "cooper/backend/contexts/*/modules/*/*.schema.ts"
  ],
  "exclude": ["**/node_modules"]
}
```

Note the last `include`: the modules' schemas are checked in this project too, with
the browser's types, besides the backend's. `bun` stays in `types` because the
clients' tests run on `bun test`.

The root `tsconfig.json` references it, and gets the `paths`, because Bun resolves
imports (in `bun test`, and as it builds the apps) with the root file:

```json
{
  // The whole repository, as eight projects: the framework (newt), its graph (newt-graph), its
  // monitor (newt-monitor), its React frontend's components and logic (newt-react-ui,
  // newt-react), what runs on the server (cooper's backend), what runs in the browser
  // (cooper's frontends and their libraries), and the tools around them (scripts). `bun check` follows the references.
  // The paths are here too because Bun resolves imports with this file. newt is not among
  // them: it is a workspace package, reached through its `exports` as any application reaches it.
  "compilerOptions": {
    "paths": {
      "@cooper/ui/*": ["./cooper/libs/ui/*"],
      "@cooper/api/*": ["./cooper/libs/api/*"]
    }
  },
  "files": [],
  "references": [
    { "path": "./tsconfig.newt.json" },
    { "path": "./tsconfig.newt-graph.json" },
    { "path": "./tsconfig.newt-monitor.json" },
    { "path": "./tsconfig.newt-react-ui.json" },
    { "path": "./tsconfig.newt-react.json" },
    { "path": "./tsconfig.backend.json" },
    { "path": "./tsconfig.frontend.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

## Lint: the frontend half

`newt-eslint` lints the backend. The frontends get `newt-react-ui`'s own preset,
`newtReactUi`, in the same `eslint.config.js`. Replace it:

```js
import tseslint from 'typescript-eslint'
import { newt } from 'newt-eslint'
import { newtReactUi } from 'newt-react-ui/lint'

// cooper is an application built with newt: its backend keeps newt's lint, and its
// frontends newt-react-ui's. The framework's own code is not
// an application, so it is left out; newt-monitor is one, so it is in.

const BACKEND = newt({
  files: ['cooper/backend/**/*.ts', 'cooper/scripts/**/*.ts'],
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'] } },
})

// newt-monitor is an application built with newt too, so it keeps the same lint.
const MONITOR = newt({
  files: ['packages/newt-monitor/**/*.ts'],
  contexts: { folder: 'packages/newt-monitor/src/contexts', uses: { monitor: [] } },
})

// newt-react-ui's gallery is an app like any other: it keeps the library's lint.
const UI_GALLERY = newtReactUi({ files: ['packages/newt-react-ui/gallery/**/*.{ts,tsx}'] })

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

// cooper's frontends compose newt-react-ui's components and style nothing: only cooper's
// own components (cooper/libs/ui, each app's components/) style, wrapping the library's.
const FRONTEND = newtReactUi({
  files: ['cooper/frontend/**/*.{ts,tsx}'],
  components: ['cooper/libs/ui/**', 'cooper/frontend/*/components/**'],
  imports: [BACKEND_IMPORTS],
})

export default [
  { ignores: ['packages/newt/**', 'packages/newt-eslint/**', 'packages/newt-graph/**', 'web/**', '**/dist/**'] },
  ...BACKEND,
  ...MONITOR,
  ...UI_GALLERY,
  ...FRONTEND,
  {
    files: ['cooper/libs/api/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-restricted-imports': ['error', { patterns: [API_BACKEND_IMPORTS] }],
    },
  },
]
```

The backend half is as it was. `newtReactUi({ files, components, imports })` is the
library's lint for an app that uses it:

- **Pages compose components.** In `files`, out of `components`: no `className`,
  `class` or `style` attribute, no `<style>`, no `cn` or
  `class-variance-authority`, and no HTML element but `form` and `fieldset`. A page
  is made of newt-react-ui's components, or of the app's own.
- **Nobody reaches past the library.** No Radix, and none of newt-react-ui's internals:
  its components are the way in.
- **`components` may style.** cooper's own components (`cooper/libs/ui`, and an app's
  `components/` folder if it has one) wrap newt-react-ui's, with Tailwind's classes.
- **`imports` adds cooper's rule**: the apps never import `backend/`.

And one block of cooper's own: **`@cooper/api`** may import from `backend/` only a
path of the form `contexts/<context>/modules/<module>/<file>.schema.ts`, the contract.
A client that imported `card.module.ts` would bring use cases, repositories and
`newt/core` into the browser.

This is what the lint says when a page styles itself, when it writes HTML, and when a
client reaches past the schema:

```text
cooper/frontend/boards/pages/home/bad.tsx
  1:27  error  A page is made of components: use one of newt-react-ui, or make one in the app's own components folder      no-restricted-syntax
  1:31  error  An app does not style: compose components of newt-react-ui, or make one in the app's own components folder  no-restricted-syntax

cooper/libs/api/card/bad.ts
  1:1  error  '../../../backend/contexts/boards/modules/card/card.module' import is restricted from being used by a pattern. @cooper/api may only import a backend module's *.schema.ts (its contract)  no-restricted-imports

✖ 3 problems (3 errors, 0 warnings)
```

The lint checks the path. What keeps the schema itself safe for a browser is that it
takes from newt only `newt/contract`, and the backend's half checks that too: newt's
rule `newt/schema-imports`, part of the preset from the start, refuses any other newt
entry in a `<m>.schema.ts`, even for a type. It reads only the schema's own imports,
not those of the files it imports: that a value object imports `newt/contract`, never
`newt/core`, is still yours to keep.

## Check it

The gate, with the new project and the clients' test:

```sh
bun install && bun check && bun test cooper/ && bun run lint
```

```text
 116 pass
 0 fail
 444 expect() calls
Ran 116 tests across 14 files.
```

Build both apps:

```sh
bun run cooper:build
```

```text
auth: 5 files in dist/cooper/auth
boards: 5 files in dist/cooper/boards
```

Then start cooper in development:

```sh
bun run cooper
```

```text
auth listening on http://localhost:3001/
boards listening on http://localhost:3002/

  auth    http://localhost:3001
  boards  http://localhost:3002
```

Both apps answer on their contexts' ports, beside their APIs:

```sh
curl -s localhost:3001 | grep -o '<title>.*</title>'
curl -s localhost:3002 | grep -o '<title>.*</title>'
curl -s localhost:3002/api/health
curl -s -i localhost:3002/api/session/sign-in | grep -i '^HTTP\|^location'
```

```text
<title>Sign in · Cooper</title>
<title>Cooper</title>
{"status":"ok"}
HTTP/1.1 302 Found
Location: http://localhost:3001/oauth/authorize?response_type=code&client_id=cooper&redirect_uri=http%3A%2F%2Flocalhost%3A3002%2Fapi%2Fsession%2Fcallback&code_challenge=…&code_challenge_method=S256&state=…
```

Open `http://localhost:3002` in a browser and sign in: boards sends you to auth's
sign-in page, on 3001, where you can sign up; auth answers its own product's request
at once (cooper asks nobody's consent to sign in to cooper), and you are back on
boards. Edit a page and it reloads.

Stop it with Ctrl+C. The built apps are served the same way, without the setting:

```sh
bun cooper/backend/index.ts
```

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
`/api`, so it gets a 404 the client can read.

## What to remember

- `newt/contract` is the part of newt a browser may load: value objects, the domain
  errors' bases, `defineFilter`, `Page`, `PageRequest`, `ErrorBody`. `newt/core`
  keeps a scope in `node:async_hooks` and stays on the server.
- A module's `*.schema.ts` is its contract, and the only backend file a client may
  import. It imports zod, `newt/contract`, value objects and other schemas; anything
  else only as a type. The lint keeps the clients to it.
- The apps are made of `newt-react-ui`'s components and think with `newt-react`;
  cooper's own components are the only code of it that styles, and the lint says so.
- A client extends `newt-react`'s `Requester`, reads every failure as an `ErrorBody`
  and acts on `code`, never on the message.
- The client makes the `Idempotency-Key`: a new `crypto.randomUUID()` per submit, the
  same one when the same submit is sent again.
- Each context serves its app on its own port, for every address its routes do not
  take, never under `/api`: from its sources in development (`bun run cooper`), built
  by Bun in production (`bun run cooper:build`, `frontendFolder`). No proxy, nothing in
  front.

Next: [An MCP server](./24-mcp-server).
