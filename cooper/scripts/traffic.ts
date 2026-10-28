// bun cooper/scripts/traffic.ts: a little of a person's work on cooper, over and over,
// for newt-monitor to have something to show: signing in through auth, a workspace
// and its board, cards created, moved, edited, searched and deleted, now and then a
// request that is refused. It keeps the board small. Stop it with Ctrl+C.
//
//   COOPER_AUTH_URL=https://cooper-auth… COOPER_BOARDS_URL=https://cooper-boards… bun cooper/scripts/traffic.ts
//
// Who it is: TRAFFIC_EMAIL and TRAFFIC_PASSWORD, signed up the first time. Every
// TRAFFIC_EVERY_S seconds, give or take a third: 30 by default.

const AUTH = process.env.COOPER_AUTH_URL ?? 'http://localhost:3001'
const BOARDS = process.env.COOPER_BOARDS_URL ?? 'http://localhost:3002'
const EMAIL = process.env.TRAFFIC_EMAIL ?? 'traffic@cooper.dev'
const PASSWORD = process.env.TRAFFIC_PASSWORD ?? 'cooper traffic, not a person'
const EVERY_MS = Number(process.env.TRAFFIC_EVERY_S ?? 30) * 1000
/** The most cards it lets its board have: past it, it deletes the oldest. */
const MOST_CARDS = 25

/** Each host's cookies, as a browser keeps them. */
const jar = new Map<string, Map<string, string>>()

/** A request as a browser would make it: its host's cookies sent, the ones it sets kept, redirects not followed. */
async function call(url: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { host } = new URL(url)
  const cookies = jar.get(host) ?? new Map<string, string>()
  const headers = new Headers(init.headers)
  if (cookies.size) headers.set('cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '))
  if (init.json !== undefined) headers.set('content-type', 'application/json')
  const response = await fetch(url, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, redirect: 'manual' })
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';')
    const at = pair!.indexOf('=')
    const name = pair!.slice(0, at)
    const value = pair!.slice(at + 1)
    if (value === '' || /max-age=0/i.test(cookie)) cookies.delete(name)
    else cookies.set(name, value)
  }
  jar.set(host, cookies)
  return response
}

async function json<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const response = await call(url, init)
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${new URL(url).pathname} answered ${response.status}: ${await response.text()}`)
  return (response.status === 204 ? undefined : await response.json()) as T
}

/** Signed in to auth, signed up the first time; then to boards, through auth's OAuth, following each redirect. */
async function signIn(): Promise<void> {
  jar.clear()
  const signedIn = await call(`${AUTH}/api/session/sign-in`, { method: 'POST', json: { email: EMAIL, password: PASSWORD } })
  if (!signedIn.ok) await json(`${AUTH}/api/session/sign-up`, { method: 'POST', json: { email: EMAIL, name: 'Cooper Traffic', password: PASSWORD } })
  let next = `${BOARDS}/api/session/sign-in`
  for (let hops = 0; hops < 10; hops++) {
    const response = await call(next)
    const location = response.headers.get('location')
    if (!location) break
    next = new URL(location, next).toString()
    // Auth's page that asks to authorize boards: approved as its button would, which says where to go back.
    const asked = /^\/authorize\/([^/]+)$/.exec(new URL(next).pathname)
    if (asked && new URL(next).host === new URL(AUTH).host) next = (await json<{ redirectTo: string }>(`${AUTH}/api/authorizations/${asked[1]}/approve`, { method: 'POST' })).redirectTo
    if (new URL(next).host === new URL(BOARDS).host && !new URL(next).pathname.startsWith('/api/')) break
  }
  await json(`${BOARDS}/api/session`)
}

type Workspace = { id: string, name: string }
type Board = { id: string, name: string }
type Column = { id: string, name: string }
type Card = { id: string, title: string, columnId: string }
type Page<T> = { items: T[] }

/** Its workspace and the board in it: made the first time (auth's worker makes the board). */
async function board(): Promise<{ api: string, board: Board, columns: Column[] }> {
  let [workspace] = await json<Workspace[]>(`${BOARDS}/api/workspaces`)
  if (!workspace) {
    await json(`${BOARDS}/api/workspaces`, { method: 'POST', json: { name: 'Traffic' } })
    for (let tries = 0; tries < 20 && !workspace; tries++) {
      await Bun.sleep(1500);
      [workspace] = await json<Workspace[]>(`${BOARDS}/api/workspaces`)
    }
  }
  if (!workspace) throw new Error('No workspace came')
  const api = `${BOARDS}/api/workspaces/${workspace.id}`
  let boards = (await json<Page<Board>>(`${api}/boards`)).items
  for (let tries = 0; tries < 20 && boards.length === 0; tries++) {
    await Bun.sleep(1500)
    boards = (await json<Page<Board>>(`${api}/boards`)).items
  }
  if (boards.length === 0) boards = [await json<Board>(`${api}/boards`, { method: 'POST', json: { name: 'Traffic' } })]
  const columns = await json<Column[] | Page<Column>>(`${api}/boards/${boards[0]!.id}/columns`)
  return { api, board: boards[0]!, columns: Array.isArray(columns) ? columns : columns.items }
}

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!
const WORDS = ['Fix', 'Write', 'Review', 'Ship', 'Plan', 'Test', 'Design', 'Measure']
const THINGS = ['the invoice export', 'the onboarding mail', 'the search page', 'the billing cron', 'the API docs', 'the board colours', 'the release notes']

/** One round of work: what a person does with a board in a few minutes. */
async function round(): Promise<string[]> {
  const done: string[] = []
  const { api, board: { id: boardId }, columns } = await board()
  const listed = await json<Card[] | Page<Card>>(`${api}/boards/${boardId}/cards`)
  const cards = Array.isArray(listed) ? listed : listed.items
  await json(`${api}/boards/${boardId}/view`).catch(() => undefined)
  const created = await json<Card>(`${api}/boards/${boardId}/cards`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, json: { columnId: columns[0]!.id, title: `${pick(WORDS)} ${pick(THINGS)}` } })
  done.push('created')
  if (columns.length > 1 && cards.length > 0) {
    await json(`${api}/cards/${pick(cards).id}/move`, { method: 'POST', json: { columnId: pick(columns).id } })
    done.push('moved')
  }
  if (Math.random() < 0.5) {
    await json(`${api}/cards/${created.id}`, { method: 'PATCH', json: { description: 'Written by the traffic script, for the monitor to see.' } })
    done.push('edited')
  }
  await json(`${api}/cards/search`, { method: 'POST', json: { text: pick(THINGS).split(' ').at(-1) } })
  done.push('searched')
  // Now and then what a person gets wrong: an empty title, a card that is not there.
  if (Math.random() < 0.3) {
    const refused = await call(`${api}/boards/${boardId}/cards`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, json: { columnId: columns[0]!.id, title: '' } })
    done.push(`refused ${refused.status}`)
  }
  if (Math.random() < 0.2) {
    const missing = await call(`${api}/cards/${crypto.randomUUID()}`)
    done.push(`missing ${missing.status}`)
  }
  for (const card of cards.slice(0, Math.max(0, cards.length + 1 - MOST_CARDS))) {
    await call(`${api}/cards/${card.id}`, { method: 'DELETE' })
    done.push('deleted')
  }
  return done
}

let signedIn = false
for (;;) {
  try {
    if (!signedIn) {
      await signIn()
      signedIn = true
    }
    console.log(`${new Date().toISOString()} ${(await round()).join(', ')}`)
  } catch (error) {
    console.error(`${new Date().toISOString()} ${error instanceof Error ? error.message : String(error)}`)
    signedIn = false
  }
  await Bun.sleep(EVERY_MS * (2 / 3 + Math.random() * 2 / 3))
}
