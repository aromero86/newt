import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStore } from 'newt-kit/adapter-sqlite'
import { serve } from 'newt-kit/http'
import { openTestBoards, type TestBoards } from './testing/open-test-boards'

describe('boards, through its API', () => {
  let t: TestBoards
  let server: Server<undefined>

  beforeEach(async () => {
    t = await openTestBoards()
    t.auth.join('acme', 'ana')
    t.auth.join('globex', 'bea')
    server = serve(t.boards.serving())
  })

  afterEach(async () => {
    await server.stop()
    await t.close()
  })

  const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, user: string | null = 'ana') => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (user) headers['x-user'] = user
    const response = await fetch(new URL(`/api/workspaces${path}`, server.url), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: (response.status === 204 ? null : await response.json()) as T }
  }

  test('answers its health without a session', async () => {
    const response = await fetch(new URL('/api/health', server.url))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  test('lets only a workspace\'s members in, and tells nobody else it exists', async () => {
    expect((await call('GET', '/acme/boards', undefined, null)).status).toBe(401)
    expect(await call('GET', '/acme/boards', undefined, 'bea')).toMatchObject({ status: 404, body: { code: 'workspace.not_found' } })
    expect(await call('GET', '/acme/boards')).toMatchObject({ status: 200, body: { items: [], total: 0 } })
  })

  test('keeps a board, its columns and its cards, and shows them as one screen', async () => {
    const board = await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })
    expect(board.status).toBe(201)
    const id = board.body.id
    const todo = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'To do' })).body.id
    const done = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'Done' })).body.id
    const card = await call<{ id: string, number: number }>('POST', `/acme/boards/${id}/cards`, { columnId: todo, title: 'Plan' })
    expect(card).toMatchObject({ status: 201, body: { number: 1 } })

    expect((await call('POST', `/acme/cards/${card.body.id}/move`, { columnId: done })).body).toMatchObject({ columnId: done, position: 0 })
    expect((await call('POST', `/acme/cards/${card.body.id}/assign`, { assigneeId: 'bea' })).body).toMatchObject({ code: 'card.assignee_not_member' })
    expect((await call('PATCH', `/acme/boards/${id}`, { name: 'Plans' })).body).toMatchObject({ name: 'Plans' })

    const view = await call<{ board: { name: string }, columns: { name: string }[], cards: { title: string }[] }>('GET', `/acme/boards/${id}/view`)
    expect(view.body.board.name).toBe('Plans')
    expect(view.body.columns.map(column => column.name)).toEqual(['To do', 'Done'])
    expect(view.body.cards.map(each => each.title)).toEqual(['Plan'])

    // Another workspace sees none of it.
    expect((await call('GET', `/globex/boards/${id}`, undefined, 'bea')).status).toBe(404)
  })

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

  test('removes a column only when it is empty, and never the board\'s last', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id
    const todo = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'To do' })).body.id
    const done = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'Done' })).body.id
    const card = (await call<{ id: string }>('POST', `/acme/boards/${id}/cards`, { columnId: todo, title: 'Plan' })).body.id

    expect(await call('DELETE', `/acme/columns/${todo}`)).toMatchObject({ status: 409, body: { code: 'card.column_not_empty' } })
    expect((await call('DELETE', `/acme/cards/${card}`)).status).toBe(204)
    expect((await call('DELETE', `/acme/columns/${todo}`)).status).toBe(204)
    expect((await call<{ id: string }[]>('GET', `/acme/boards/${id}/columns`)).body.map(column => column.id)).toEqual([done])
    expect(await call('DELETE', `/acme/columns/${done}`)).toMatchObject({ status: 409, body: { code: 'column.last' } })
  })

  test('searches cards with a filter in the body, and refuses one it does not allow', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id
    const todo = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'To do' })).body.id
    for (const title of ['Plan the launch', 'Design', 'Plan the party']) await call('POST', `/acme/boards/${id}/cards`, { columnId: todo, title })
    await t.settled()

    const found = await call<{ items: { title: string }[], total: number }>('POST', '/acme/cards/search?size=1', { text: 'plan', filter: { field: 'column', op: 'eq', value: todo } })
    expect(found.body).toMatchObject({ items: [{ title: 'Plan the launch' }], total: 2, hasMore: true })

    expect(await call('POST', '/acme/cards/search', { filter: { field: 'workspaceId', op: 'eq', value: 'globex' } })).toMatchObject({ status: 400, body: { code: 'validation' } })
  })

  test('renames a board, archives it, and gives its name once', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id

    expect(await call('POST', '/acme/boards', { name: 'ROADMAP' })).toMatchObject({ status: 409, body: { code: 'board.name_taken' } })
    expect((await call('PATCH', `/acme/boards/${id}`, { name: 'Plans' })).body).toMatchObject({ name: 'Plans' })
    expect((await call('GET', `/acme/boards/${id}`)).body).toMatchObject({ id, name: 'Plans' })
    expect((await call('POST', `/acme/boards/${id}/archive`)).status).toBe(204)
    expect((await call('GET', `/acme/boards/${id}`)).body).toMatchObject({ code: 'board.not_found' })
  })

  test('lists boards by pages: ?size= and ?cursor=', async () => {
    for (const name of ['Roadmap', 'Bugs', 'Launch']) await call('POST', '/acme/boards', { name })

    const first = await call<{ items: { id: string, name: string }[] }>('GET', '/acme/boards?size=2')
    expect(first.body).toMatchObject({ items: [{ name: 'Launch' }, { name: 'Bugs' }], hasMore: true, total: 3 })
    expect((await call('GET', `/acme/boards?size=2&cursor=${first.body.items[1]!.id}`)).body).toMatchObject({ items: [{ name: 'Roadmap' }], hasMore: false })
  })

  test('answers what went wrong as { error, code }, with the status its error says', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id

    expect(await call('GET', `/acme/boards/${Bun.randomUUIDv7()}`)).toMatchObject({ status: 404, body: { code: 'board.not_found' } })
    expect(await call('POST', '/acme/boards', { name: ' ' })).toMatchObject({ status: 400, body: { code: 'board.invalid_name' } })
    expect(await call('PATCH', `/acme/boards/${id}`, { description: 'x'.repeat(501) })).toMatchObject({ status: 400, body: { code: 'validation', issues: [{ path: ['description'] }] } })
    expect(await call('GET', '/acme/nothing/here')).toMatchObject({ status: 404, body: { code: 'route_not_found' } })

    const malformed = await fetch(new URL('/api/workspaces/acme/boards', server.url), { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': 'ana' }, body: '{ "name": ' })
    expect([malformed.status, (await malformed.json() as { code: string }).code]).toEqual([400, 'malformed_body'])
  })
})

describe('boards\' migrations', () => {
  test('are checked as the store opens: one changed after it was applied is refused', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'cooper-migrations-'))
    try {
      const migrations = join(folder, 'sqlite')
      await cp(join(import.meta.dir, 'migrations', 'sqlite'), migrations, { recursive: true })
      const path = join(folder, 'boards.db')
      await (await SqliteStore.open({ path, migrations })).close()

      const board = join(migrations, '00001_board_up.sql')
      await Bun.write(board, `${await Bun.file(board).text()}\nCREATE INDEX board_description ON board (description);\n`)

      await expect(SqliteStore.open({ path, migrations })).rejects.toThrow('Migration 00001_board was changed after it was applied')
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})
