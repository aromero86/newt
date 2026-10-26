import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { join } from 'node:path'
import { serve } from 'newt/http'
import { openTestBoards, type TestBoards } from './testing/open-test-boards'

describe('boards, through its API', () => {
  let t: TestBoards
  let server: Server<undefined>

  beforeEach(async () => {
    t = await openTestBoards()
    server = serve(t.boards.serving())
  })

  afterEach(async () => {
    await server.stop()
    await t.close()
  })

  const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, user: string | null = 'ana') => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (user) headers['x-user'] = user
    const response = await fetch(new URL(`/api${path}`, server.url), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, body: (response.status === 204 ? null : await response.json()) as T }
  }

  test('answers its health without a session', async () => {
    const response = await fetch(new URL('/api/health', server.url))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  test('lets in only who says who they are', async () => {
    expect(await call('POST', '/boards', { name: 'Roadmap' }, null)).toMatchObject({ status: 401, body: { code: 'not_signed_in' } })
  })

  test('keeps a board as a file of its own, and gives it back', async () => {
    const board = await call<{ id: string, name: string }>('POST', '/boards', { name: 'Roadmap' })
    expect(board).toMatchObject({ status: 201, body: { name: 'Roadmap', description: '' } })
    const id = board.body.id

    expect(await Bun.file(join(t.folder, 'board', `${id}.json`)).json()).toMatchObject({ id, name: 'Roadmap', version: 1 })
    expect((await call('PATCH', `/boards/${id}`, { name: 'Plans' })).body).toMatchObject({ name: 'Plans' })
    expect((await call('GET', `/boards/${id}`)).body).toMatchObject({ id, name: 'Plans' })
    expect((await call('POST', `/boards/${id}/archive`)).status).toBe(204)
    expect((await call('GET', `/boards/${id}`)).body).toMatchObject({ code: 'board.not_found' })
  })
})
