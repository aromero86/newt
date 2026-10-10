import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveFrontend } from './serve-frontend'

let folder: string

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'newt-frontend-'))
  await Bun.write(join(folder, 'index.html'), '<div id="root"></div>')
  await Bun.write(join(folder, 'assets/app.js'), 'console.log(1)')
})

afterAll(() => rm(folder, { recursive: true }))

const get = (path: string) => serveFrontend(folder)(new Request(`http://newt.test${path}`))

describe('serveFrontend', () => {
  test('hands out a file that exists', async () => {
    expect(await (await get('/assets/app.js')).text()).toBe('console.log(1)')
  })

  test('any other address gets the frontend, whose router decides', async () => {
    expect(await (await get('/proposals/42')).text()).toBe('<div id="root"></div>')
  })

  test('never leaves its folder', async () => {
    expect(await (await get('/../../etc/passwd')).text()).toBe('<div id="root"></div>')
  })

  test('says how to build the frontend when it is not built', async () => {
    const response = await serveFrontend(join(folder, 'missing'))(new Request('http://newt.test/'))
    expect(response.status).toBe(503)
  })
})
