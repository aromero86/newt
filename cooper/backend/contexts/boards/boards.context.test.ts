import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { serve } from 'newt/http'
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

  test('removes a column only when it is empty', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id
    const todo = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'To do' })).body.id
    const card = (await call<{ id: string }>('POST', `/acme/boards/${id}/cards`, { columnId: todo, title: 'Plan' })).body.id

    expect(await call('DELETE', `/acme/columns/${todo}`)).toMatchObject({ status: 409, body: { code: 'card.column_not_empty' } })
    expect((await call('DELETE', `/acme/cards/${card}`)).status).toBe(204)
    expect((await call('DELETE', `/acme/columns/${todo}`)).status).toBe(204)
    expect((await call<unknown[]>('GET', `/acme/boards/${id}/columns`)).body).toEqual([])
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
})
