import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Notes_Context } from './notes.context'

let folder: string
let context: Notes_Context
let server: ReturnType<Notes_Context['serve']>

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'notes-'))
  context = await Notes_Context.open(folder)
  server = context.serve(0)
  context.start()
})

afterEach(async () => {
  await server.stop()
  await context.stop()
  await rm(folder, { recursive: true })
})

const call = (method: string, path: string, body?: unknown, user = 'ana') =>
  fetch(new URL(`/api${path}`, server.url), { method, headers: { 'x-user': user, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

describe('the notes application', () => {
  test('writes, lists, changes and deletes a note', async () => {
    const created = await (await call('POST', '/notes', { title: 'Groceries' })).json() as { id: string }
    await call('PATCH', `/notes/${created.id}`, { body: 'milk' })

    const page = await (await call('GET', '/notes')).json() as { items: { title: string, body: string }[], total: number }
    expect(page.items.map(note => [note.title, note.body])).toEqual([['Groceries', 'milk']])

    expect((await call('DELETE', `/notes/${created.id}`)).status).toBe(204)
    expect((await call('GET', `/notes/${created.id}`)).status).toBe(404)
  })

  test('keeps each one to its author', async () => {
    const created = await (await call('POST', '/notes', { title: 'Mine' })).json() as { id: string }

    expect((await call('GET', `/notes/${created.id}`, undefined, 'bea')).status).toBe(404)
    expect((await call('GET', '/notes', undefined, '')).status).toBe(401)
  })

  test('refuses a title the author used already, whatever its case', async () => {
    await call('POST', '/notes', { title: 'Groceries' })

    const response = await call('POST', '/notes', { title: 'GROCERIES' })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'note.title_taken' })
  })

  test('gives a title to one of two notes saved with it at once, and refuses the other', async () => {
    const responses = await Promise.all([call('POST', '/notes', { title: 'Same' }), call('POST', '/notes', { title: 'same' })])

    expect(responses.map(response => response.status).sort()).toEqual([201, 409])
  })

  test('records the activity of each note after the change commits, by its workers', async () => {
    const created = await (await call('POST', '/notes', { title: 'Groceries' })).json() as { id: string }
    await call('PATCH', `/notes/${created.id}`, { body: 'milk' })
    await context.base.jobs.idle()

    const activity = await context.base.store.collection('activity').all()
    expect(activity.map(entry => entry.what).sort()).toEqual(['created', 'updated'])
  })
})
