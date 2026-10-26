import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStore } from 'newt/adapter-sqlite'
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

  test('keeps a board, and gives it back', async () => {
    const board = await call<{ id: string, name: string }>('POST', '/acme/boards', { name: 'Roadmap' })
    expect(board).toMatchObject({ status: 201, body: { name: 'Roadmap', description: '' } })
    const id = board.body.id

    expect((await call('PATCH', `/acme/boards/${id}`, { name: 'Plans' })).body).toMatchObject({ name: 'Plans' })
    expect((await call('GET', `/acme/boards/${id}`)).body).toMatchObject({ id, name: 'Plans' })
    expect((await call('POST', `/acme/boards/${id}/archive`)).status).toBe(204)
    expect((await call('GET', `/acme/boards/${id}`)).body).toMatchObject({ code: 'board.not_found' })
  })

  test('shows a board to its workspace only', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id

    expect((await call('GET', `/globex/boards/${id}`, undefined, 'bea')).status).toBe(404)
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
