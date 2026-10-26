# Tests

You have seen a test at the end of almost every chapter. This one is about how they
are built: what to open, how to wait for the work that happens later, and which tests
are worth the most.

The idea is simple. cooper's tests run the real thing. Real contexts, real use cases,
real SQLite, real HTTP. Nothing is mocked inside a context. The only things replaced
are at the edges: the mailer, and, in boards' own tests, auth.

```bash
bun test                                   # everything
bun test cooper/backend/contexts/boards    # one context
```

## A database in memory that behaves like a file

Every test opens its stores with the path `:memory:`. newt's SQLite store turns that
into a temporary file, removed when the store closes. So a test gets exactly what
production gets: a writer and a reader on WAL, transactions that take turns, the same
migrations. Each test starts from an empty database and leaves nothing behind.

The settings come from `config.ts`, with the paths and ports changed:

```ts
// cooper/backend/contexts/backoffice/testing/open-test-backoffice.ts
/** cooper's settings for a test: every database in memory, every server on a free port. */
function testConfig(): Config {
  return {
    ...config,
    auth: { ...config.auth, dbPath: ':memory:', port: 0 },
    boards: { ...config.boards, dbPath: ':memory:', port: 0 },
    backoffice: { ...config.backoffice, dbPath: ':memory:', port: 0 },
    trace: false,
  }
}
```

Port `0` asks the system for any free port. When a context must know another's
address before it opens (boards sends people to auth's URL), the test finds a free port
first:

```ts
// cooper/backend/cooper.test.ts
/** A port nobody listens on now: each context must know the other's address before it opens. */
function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port!
  void probe.stop()
  return port
}
```

## Three sizes of test

cooper tests at three sizes. Each context keeps a `testing/` folder with what its tests
open.

**One context, its neighbours faked.** boards' modules are tested without auth. Its
`testing/fake-auth.ts` implements the ports boards is handed (who belongs to each
workspace) and publishes auth's events (`tenant.created`, `tenant.deleted`,
`access.revoked`) the way auth does: in a transaction of its own store, so boards'
handlers are jobs in an outbox, as in production.

```ts
// cooper/backend/contexts/boards/testing/open-test-boards.ts
/**
 * `boards` for a test: its database in memory, a fake auth behind its ports, its
 * emails and its log's lines in lists, and who sends a request told by an `x-user` header (the real
 * authenticator, the web session's, is replaced).
 */
export async function openTestBoards() {
  const auth = await FakeAuth.open()
  const mails: Mail[] = []
  const lines: string[] = []
  const boards = await Boards_Context.open({ ...config.boards, dbPath: ':memory:', port: 0 }, {
    workspaces: auth.workspaces,
    tenants: auth.tenants,
    access: auth.access,
    auth: auth.modules,
    mailer: { send: async mail => { mails.push(mail) } },
    log: line => { lines.push(line) },
  })
  boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId, via: 'web' as const } : null
  })
  return {
    // …
    /** Runs as someone, in a workspace they belong to: what a route under `/workspaces/:workspaceId` (or an MCP tool) does. */
    as<T>(userId: string, workspaceId: string, fn: () => Promise<T>, via: ActorVia = 'web'): Promise<T> {
      return runAsActor({ userId, via }, () => inWorkspace(boards.modules.member, workspaceId, fn))
    },
    // …
  }
}
```

Everything boards sends out is caught: emails in `mails`, the lines of its log in
`lines`. And every actor says how it came in (`via: 'web'` or `'mcp'`), because cooper
added that field to newt's `Actor` ([chapter 5](./05-who-and-where)): the type does not
let a test forget it. `as` takes it as a last argument, so a test can act as an AI
assistant would.

A fake is worth it only because boards reaches auth through ports it declares
(`member.deps.ts`, `workspace.deps.ts`, `card.deps.ts`). A module that imported auth's
repository could not be tested this way.

**A context with the real ones it reads.** The backoffice reads auth and boards, so
its tests open all three, as the server does, through `openContexts`, and make data
through auth's and boards' own use cases:

```ts
// cooper/backend/contexts/backoffice/testing/open-test-backoffice.ts
export async function openTestBackoffice() {
  const contexts = await openContexts(testConfig(), { mailer: { send: async () => {} } })
  const { auth, boards, backoffice } = contexts

  /** An account, as someone signs up in auth. */
  const signUp = (name: string): Promise<UserDTO> =>
    auth.modules.user.signUp({ email: `${name.toLowerCase()}@cooper.test`, name, password: 'a long password' })

  return {
    // …
    as<T>(user: UserDTO, fn: () => Promise<T>): Promise<T> {
      return runAsActor({ userId: user.id, via: 'web' }, fn)
    },
    // …
  }
}
```

Use cases are called directly, as someone, with `runAsActor`: no HTTP, no session.

**The whole application, over HTTP.** `cooper/backend/cooper.test.ts` opens every
context, serves auth and boards on real ports, and plays a browser that keeps cookies
per origin and never follows a redirect on its own. It signs people up through the
real OAuth flow, creates workspaces through boards' routes, accepts an invitation with
the link read from the email, and connects an MCP client:

```ts
// cooper/backend/cooper.test.ts
/** Someone signs up to cooper from boards, as its UI does it: boards' sign-in, auth's pages, back to boards. */
async function signUp(email: string, name: string): Promise<{ as: Browser, id: string }> {
  const as = browser()
  const started = await as(boardsUrl('/api/session/sign-in?returnTo=/'))
  const kept = await as(started.headers.get('location')!)
  const request = kept.headers.get('location')!.split('/authorize/')[1]!
  const user = (await (await as(authUrl('/api/session/sign-up'), { method: 'POST', json: { email, name, password: 'a long password' } })).json()) as { id: string }
  const { redirectTo } = (await (await as(authUrl(`/api/authorizations/${request}/approve`), { method: 'POST' })).json()) as { redirectTo: string }
  expect((await as(redirectTo)).headers.get('location')).toBe('/')
  return { as, id: user.id }
}
```

The small tests tell you which rule broke. The big one tells you the pieces fit.

## Waiting for the workers

With eventual consistency, right after a workspace is created its welcome board does
not exist yet. A test must wait for the background work, and **never with a sleep**.
A sleep is too short on a slow machine and wastes time on a fast one.

`base.jobs.idle()` resolves once no job is ready nor running. It runs the ready jobs
itself, so a test does not even need to start the worker:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
test('gives a new workspace its welcome board, a moment after auth creates it', async () => {
  await t.auth.createWorkspace('acme', 'ana')
  expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)

  await t.settled()

  expect(await welcome()).toEqual({
    boards: ['Welcome'],
    columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
  })
})
```

Two things `idle()` does not wait for:

- **A `'fire-and-forget'` reaction** is not a job: there is nothing to wait for. It
  starts right after the commit, in memory. One that does its work at once, like
  boards' log line as a card moves, is done by the time the use case that saved has
  returned, and the test reads it straight away:

  ```ts
  // cooper/backend/contexts/boards/modules/activity/activity.test.ts
  test('writes a line as a card moves, at once, with no job to wait for', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
    await inAcme(() => t.modules.card.move(card.id, { columnId: doing }), 'mcp')

    // In memory, right after the commit: no job, nothing to wait for.
    expect(t.lines).toEqual([`[boards] #${card.number} "Plan" moved from column ${todo} to ${doing} by ana (mcp)`])
  })
  ```

  One that awaits something of its own needs that thing done: auth's test collects
  what it heard after an `idle()` that covered the saves that published it.
- **A job that failed and waits for its retry** (10 seconds later, then more) is still
  pending when `idle()` returns. If a test makes things fail, look at the jobs:
  `base.store.outbox.list()`, or the backoffice's `job.dead` ([chapter 22](./22-backoffice)).

### In the right order, across contexts

A `handler` job is written in the transaction of the change that publishes the event.
So it lives in the outbox of the context that **publishes**, not of the one that
reacts. boards' reaction to `tenant.created` is a job in auth's outbox, run by auth's
worker. The backoffice's count of `card.created` is a job in boards'.

Work flows: auth creates a workspace → auth's job prepares the welcome board in
boards → boards' save publishes `card.created` → boards' job appends the metric. To
see it all, wait for auth first, then boards:

```ts
// cooper/backend/cooper.test.ts
/** Until the background work is done: auth's jobs (boards' reactions to auth's events among them), then boards'. */
async function settled() {
  await contexts.auth.base.jobs.idle()
  await contexts.boards.base.jobs.idle()
}
```

Wait for them the other way round and the test sees the welcome board but not its
metric. The backoffice's helper goes over every context, in the order they open, twice,
so a chain that comes back to auth is covered too:

```ts
// cooper/backend/contexts/backoffice/testing/open-test-backoffice.ts
/**
 * Until the background work is done, in the order it flows: auth's events (heard
 * by boards and by the metrics), then boards' (the cards the metrics count).
 */
async settled(): Promise<void> {
  for (let round = 0; round < 2; round++) {
    for (const context of contexts.all) await context.base.jobs.idle()
  }
},
```

## Testing the hard cases

The tests worth the most are those of the situations the earlier chapters worried
about. They are also the ones nobody tests by clicking.

**Concurrency.** Twenty cards created at once in one board get twenty different
numbers and twenty different places ([chapter 9](./09-shared-counters)):

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('gives distinct numbers and places to cards created at once', async () => {
  const created = await Promise.all(Array.from({ length: 20 }, (_, i) => create(`Task ${i}`)))

  const sorted = (values: number[]) => values.toSorted((a, b) => a - b)
  expect(sorted(created.map(card => card.number))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  expect(sorted(created.map(card => card.position))).toEqual(Array.from({ length: 20 }, (_, i) => i))
})
```

And four boards created at once with the same name in different cases leave exactly
one ([chapter 8](./08-rules-over-rows)):

```ts
// cooper/backend/contexts/boards/modules/board/board.test.ts
test('gives a name to one of several boards created with it at once, whatever its case', async () => {
  const created = await Promise.allSettled(['Roadmap', 'ROADMAP', 'roadmap', 'RoadMap'].map(create))

  expect(created.filter(each => each.status === 'fulfilled')).toHaveLength(1)
  for (const each of created.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'board.name_taken' })
  expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(1)
})
```

**Repetition.** A worker may run twice, or stop halfway and run again
([chapter 13](./13-repeatable-workers)). The test does exactly that: a first run that
left a board and one column, then the event twice:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
test('prepares a workspace once, however many times its work runs, and finishes one left halfway', async () => {
  t.auth.join('acme', 'ana')
  // A first run that stopped halfway: the board and one column.
  const board = await inAcme(() => t.modules.board.create({ name: 'welcome' }))
  await inAcme(() => t.modules.column.add(board.id, { name: 'To do' }))

  await t.auth.createWorkspace('acme', 'ana')
  await t.settled()
  await t.auth.createWorkspace('acme', 'ana')
  await t.settled()

  expect(await welcome()).toEqual({
    boards: ['welcome'],
    columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
  })
})
```

The purge after a deletion is run twice too, and the test checks that every job ended
`done`: nothing left to remove, nothing failed.

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
// Its work run again, as after a failure halfway: nothing left to remove, nothing fails.
await t.auth.deleteWorkspace('acme')
await t.settled()
// Each deletion is heard twice: the workspace's purge, and its activity's.
expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done', 'done', 'done', 'done'])
```

The list of jobs grew when the activity module arrived: it purges its own log on
`tenant.deleted`. A test that names every job it expects tells you when a new
reaction joins the flow, and the comment says which.

**Security flows.** OAuth is mostly about what must be refused. auth's tests go
through them over HTTP, as a client would: a code traded twice revokes the tokens it
gave (from a worker, so the test waits), a refresh token brought again after it was
replaced revokes the new ones, a code without its PKCE verifier is refused.

```ts
// cooper/backend/contexts/auth/oauth.test.ts
test('trades a code once: brought again, the tokens it gave are revoked, from a worker', async () => {
  const clientId = await register()
  const { verifier, challenge } = pkce()
  const code = await codeFor(clientId, challenge)
  const exchange = () => token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: CALLBACK })

  const first = (await (await exchange()).json()) as { access_token: string }
  const again = await exchange()
  expect(again.status).toBe(400)
  expect(await again.json()).toMatchObject({ error: 'invalid_grant' })
  await auth.base.jobs.idle()
  expect(await auth.modules.token.verify(first.access_token)).toBeNull()
})
```

The web session's tests check that a callback a browser did not start is refused, and
that a `returnTo` pointing at another site sends the browser home instead.

**The rules of the framework.** A use case that writes into another module outside a
worker fails ([chapter 17](./17-modules-talk)). That is the default, so a test that
reaches such a path fails the day you write it, not in production. boards tests the
rule itself, on purpose: `workspace.prepare` writes a board, columns and a card, so it
must run from its worker. Called from a request, it is refused, and nothing is left
behind:

```ts
// cooper/backend/contexts/boards/modules/workspace/workspace.test.ts
test('refuses to prepare a workspace outside a worker: it writes in other modules', async () => {
  t.auth.join('acme', 'ana')

  await expect(inAcme(() => t.modules.workspace.prepare('acme'))).rejects.toThrow('[write rule] workspace.prepare writes to boards.board outside a worker: write it from a worker reacting to an event, or list it in its writesTo')
  expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)
})
```

The test pins the whole message. If someone adds `writesTo: ['board']` to `prepare` to
make an error go away, this test fails and asks why.

**Limits.** A limit is only tested by crossing it. Card search is one query because
an earlier version sent the matching ids back in an `in`, and a query takes at most
250,000 parameters on SQLite in Bun. The test writes 250,001 cards as rows, past what
any use case would allow, and pages through them ([chapter 23](./23-search)):

```ts
// cooper/backend/contexts/boards/modules/card/card.test.ts
test('searches by pages however many cards match, more than a query takes parameters (SQLite in Bun takes 250,000)', async () => {
  // Written as rows, past what any use case would let in: 250,001 cards of 501 boards.
  // …
  await t.writeCards(rows)
  // …
  const first = await search({ text: 'TASK' })
  expect(first).toMatchObject({ hasMore: true, total: 250_001 })
  // …
}, 30_000)
```

`writeCards` is a helper of `testing/`: it inserts rows with Kysely in one
transaction. It is the one place a test writes past the use cases, and only to build
a situation no use case can reach.

**What is set for the whole process.** cooper replaces newt's messages once, at
startup, with `setMessages` ([chapter 26](./26-production)). That setting is the
process's: set it in a test, and every other test running in the same process reads
cooper's messages instead of newt's. So the test runs it in a process of its own, and
reads what that process prints:

```ts
// cooper/backend/shared/messages.test.ts
// In a process of its own: the messages are the whole process's, and every other
// test in this one reads newt's own.
test('once set at startup, newt\'s errors and its API speak cooper\'s words', async () => {
  const script = `
    import { ConcurrencyConflict, ReferenceNotFound } from 'newt/core'
    import { ApiRouteNotFound, NotSignedIn, toErrorResponse } from 'newt/http'
    import { setCooperMessages } from './cooper/backend/shared/messages'

    setCooperMessages()
    const response = toErrorResponse(new ApiRouteNotFound('GET', '/api/nothing'))
    console.log(JSON.stringify({
      conflict: new ConcurrencyConflict().message,
      reference: new ReferenceNotFound('column', 'c1').message,
      notSignedIn: new NotSignedIn().message,
      route: { status: response.status, body: await response.json() },
    }))
  `
  const child = Bun.spawn(['bun', '-e', script], { cwd: root, stdout: 'pipe', stderr: 'inherit' })
  expect(await child.exited).toBe(0)

  expect(JSON.parse(await new Response(child.stdout).text())).toEqual({
    conflict: 'Someone else changed this a moment ago. Reload it and try again.',
    reference: 'That column is not there any more (c1)',
    notSignedIn: 'You are not signed in, or your session has ended: sign in to go on',
    route: { status: 404, body: { error: 'Cooper has nothing at GET /api/nothing', code: 'route_not_found' } },
  })
})
```

The same goes for anything global: an environment variable read once, a clock
replaced, a module patched. Keep it out of the shared process.

## A test that cannot fail tests nothing

When a test passes the first time, break the code on purpose once: remove the `guard`
of a save, the `escape` of the search, the `where` with the workspace. Run the test and
watch it fail. Then put the code back. A test you never saw fail may not be testing
what you think.

## In short

- Test the real thing: real contexts, real SQLite in `:memory:`, real HTTP. Fake only
  at the edges, behind the ports a context declares.
- Each context keeps its test helpers in `testing/`.
- Wait for workers with `jobs.idle()`, never with a sleep.
- A job lives in the outbox of the context that publishes the event: wait for the
  contexts in the order the work flows.
- Spend your tests on the hard cases: things at once, things twice, things refused,
  and limits, crossed.
- What is set for the whole process is tested in a process of its own.
- Break the code once to see the test fail.
