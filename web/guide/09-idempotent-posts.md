# Asking twice: idempotent POSTs

Ana is on a train. She types a card's title and presses *Create*. The request reaches
cooper, the card is saved as #14, and the answer is lost in a tunnel. Her browser saw
nothing come back, so it tries again, or Ana presses the button again. cooper gets a
second POST, exactly like the first, and makes #15. Ana now has the same card twice.

The server cannot tell a second submit from a new card with the same title: both are
valid. Only the client knows they are the same request. So the client says so: it
sends each submit with an `Idempotency-Key` header, a value of its own, new for each
submit and the same when it sends that submit again. The server remembers the first
answer to each key, and to a request it has seen before it gives that answer again,
without running anything.

newt does the remembering. This chapter turns it on for the one route of boards that
needs it: creating a card.

## Which routes need it

A request is safe to send twice when doing it twice is the same as doing it once.
Most of boards' are. A `PATCH` that renames a card to *Plan* leaves it called *Plan*
however many times it arrives. Assigning a card to bea twice leaves it assigned to
bea. A `DELETE` sent again finds nothing to delete. A move sent twice puts the card in
the same column, at the bottom or at the same position.

A POST that **creates** something is not: each one makes a new thing. In cooper that
is a new card (a new board's name is taken the second time, a new column counts
against the ten; a card has neither). That is the route that takes the option.

## The table

The first answers are kept in a table of the context's own store, so they survive a
restart and every process of boards sees the same ones. newt says the table's shape in
`KeptAnswer` (from `newt/http`); you write its migration:

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00004_idempotency_key_up.sql
-- The first answer to each POST sent with an `Idempotency-Key`, as newt/http keeps it
-- (`KeptAnswer`): its id is the key's hash, with who sent it and where, and the
-- hash of the body it answered. The index is how the forgotten ones are removed.
CREATE TABLE idempotency_key (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  body_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  headers TEXT NOT NULL,
  body TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idempotency_key_expires_at ON idempotency_key (expires_at);
```

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00004_idempotency_key_down.sql
DROP TABLE idempotency_key;
```

Each row is one key:

- `id`: a hash of who sent it, the path it was sent to, and the key. The same key
  from bea, or sent to another board's cards, is another row: one person cannot replay
  another's answers, and a client may reuse a key on another address.
- `body_hash`: a hash of the request's body, to tell a request sent again from a
  different one that reused the key.
- `status`, `headers`, `body`: the first answer. `status` is 0 while the first request
  is still running.
- `expires_at`: when the key is forgotten. The index on it is how forgotten keys are
  removed.
- `version`, as every row has: two requests never take the same key at once.

## The route

In `card.routes.ts`, import `KeptAnswer`:

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
import type { KeptAnswer } from 'newt/http'
import type { BoardsBase } from '../../boards-base'
```

and give the POST that creates a card its option, `idempotency`, as the route's third
argument:

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
  // A client may send it again with the same `Idempotency-Key` (its answer lost on the
  // way): it gets the card made the first time, kept in the store, not a second one.
  workspace.post('/boards/:boardId/cards', async request => Response.json(await cards.create(request.params.boardId, await request.json()), { status: 201 }), { idempotency: { table: base.store.table<KeptAnswer>('idempotency_key') } })
```

That is all the code. The route's handler is the same; the use case knows nothing of
keys. `idempotency` is a route option like `public` and `cors`; a group or a whole
router may take it too, and it applies to its POSTs only. It takes:

- `table`: where the answers are kept, `base.store.table<KeptAnswer>('idempotency_key')`.
- `ttlMs`: how long a key is remembered. A day unless told.
- `clock`: what tells the time. The real one unless told; chapter
  [19](./19-invitations-and-time) gives a context a clock a test can move.

## What it does

A request **without** the header runs as usual: the option changes nothing for a
client that does not send keys.

A request **with** a key the table does not have (or has forgotten) takes it before
the route runs: a row with `status` 0, the body's hash, and an expiry a minute away.
Then the route runs.

- If it answers, and the answer is not a 5xx, the answer is kept: its status, its
  headers and its body, until `ttlMs` from then. The client gets it as usual.
- If it throws (any error: `card.too_many`, a validation error, a missing board) or
  answers a 5xx, the row is deleted and the error answered as usual. **What fails is not
  kept**, so the same key may try again: a card refused because the board was full
  may be created with the same key once there is room.

A request with a key the table **has**, from the same person to the same path:

- **The same body, answered**: it gets the kept answer, status, headers and body, plus
  one header, `idempotent-replayed: true`. The route does not run. No second card.
- **The same body, still running**: the first request has not answered yet (the
  client gave up waiting and sent it again). It is a **409**,
  `idempotency_key_in_use`: try again once it ends. If two requests with a new key
  arrive at once, one inserts the row and the other collides with it, and gets the same
  409.
- **Another body**: the key was used for a different request. That is the client's
  mistake, and running it would answer two different things to one key. It is a
  **422**, `idempotency_key_reused`, whether the first is answered or still running.

The body is compared byte by byte, by its hash: a client sends a submit again exactly
as it sent it the first time.

**Expiry.** A key is remembered for `ttlMs` (a day) after its answer was kept; after
that the same key is a new request, and would create a new card. A day is far longer
than any client retries. While the first request runs, its key expires after a minute
(or `ttlMs`, if that is shorter): if the process dies midway, the key is not held for a
day. After that minute, another request may take the key over; should the first one
end after all, what it would have kept is dropped, and the answer kept is the second
one's.

**Purging.** Forgotten keys are removed as new ones come: a request with a key first
deletes the rows whose `expires_at` has passed, at most once a minute for each table.
That is what the index on `expires_at` is for. There is no job to schedule.

### The errors

Both are newt's, from `newt/http`, answered like any other: `IdempotencyKeyInUse` is a
`ConflictError` (409); `IdempotencyKeyReused` is a 422. Their messages are newt's own
unless you change them with `setMessages`, as cooper does for others (chapter
[3](./03-pages-and-errors)); `code` never changes, and that is what a
client acts on.

### The client

The key is the client's to make: a new random one each time the person submits the
form (`crypto.randomUUID()`), kept while that submit is sent again, never reused for
another. cooper's frontend does it in its card API, which chapter
[23](./23-frontends) walks through.

## Test

In `boards.context.test.ts`, after the test that keeps a board, its columns and its
cards, add one that submits twice with the same key and once with another. It uses
`fetch` directly, to send the header and read the answer's:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
  test('creates a card once for a submit sent twice with the same Idempotency-Key', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id
    const todo = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'To do' })).body.id
    const submit = (key: string) => fetch(new URL(`/api/workspaces/acme/boards/${id}/cards`, server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user': 'ana', 'idempotency-key': key },
      body: JSON.stringify({ columnId: todo, title: 'Plan' }),
    })

    const first = await submit('submit-1')
    const again = await submit('submit-1')
    expect([first.status, again.status, again.headers.get('idempotent-replayed')]).toEqual([201, 201, 'true'])
    expect(await again.json()).toEqual(await first.json())
    expect((await call<unknown[]>('GET', `/acme/boards/${id}/cards`)).body).toHaveLength(1)

    expect((await submit('submit-2')).status).toBe(201)
    expect((await call<unknown[]>('GET', `/acme/boards/${id}/cards`)).body).toHaveLength(2)
  })
```

The second submit gets the same 201 and the same card, says it was replayed, and the
board has one card. A new key is a new submit: a second card.

## Check it

```sh
bun install && bun check && bun test cooper/ && bun run lint
```

Then by hand. Start the backend (`bun cooper/backend/index.ts`): it runs migration
00004 as it opens. Make a board with a column, and send the same submit twice:

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
BOARD=$(curl -s -X POST $API/boards -H "$H" -H 'x-user: ana' -d "{\"name\":\"Train $RANDOM\"}" | jq -r .id)
COLUMN=$(curl -s -X POST $API/boards/$BOARD/columns -H "$H" -H 'x-user: ana' -d '{"name":"To do"}' | jq -r .id)
KEY=$(uuidgen)
submit() { curl -si -X POST $API/boards/$BOARD/cards -H "$H" -H 'x-user: ana' -H "idempotency-key: $KEY" -d "$1"; }
submit "{\"columnId\":\"$COLUMN\",\"title\":\"Plan\"}" | grep -i -E '^HTTP|^idempotent-replayed'
submit "{\"columnId\":\"$COLUMN\",\"title\":\"Plan\"}" | grep -i -E '^HTTP|^idempotent-replayed'
curl -s $API/boards/$BOARD/cards -H 'x-user: ana' | jq length
```

```text
HTTP/1.1 201 Created
HTTP/1.1 201 Created
idempotent-replayed: true
1
```

The same key with another body:

```sh
submit "{\"columnId\":\"$COLUMN\",\"title\":\"Design\"}" | tail -1
```

```text
{"error":"This Idempotency-Key was sent before with another body: send a new key for another request","code":"idempotency_key_reused"}
```

with status 422.

## What to remember

- A POST that creates something is not safe to send twice; the client marks each
  submit with an `Idempotency-Key`, and the route takes `{ idempotency: { table } }`.
- The first answer is kept in the context's store (`KeptAnswer`, with its migration),
  per person, path and key, for a day unless `ttlMs` says otherwise; a request sent
  again gets it with `idempotent-replayed: true`, and nothing runs.
- What fails (an error thrown, a 5xx) is not kept: the same key may try again.
- The same key while the first still runs is a 409 (`idempotency_key_in_use`), for a
  minute at most; with another body it is a 422 (`idempotency_key_reused`).
- Forgotten keys are removed as new ones come, at most once a minute: no job needed.

Next: [Events](./10-events).
