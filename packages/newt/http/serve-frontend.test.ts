import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serveFrontend } from './serve-frontend'

let folder: string

beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'framework-frontend-'))
  await Bun.write(join(folder, 'index.html'), '<div id="root"></div>')
  await Bun.write(join(folder, 'assets/app.js'), 'console.log(1)')
})

afterAll(() => rm(folder, { recursive: true }))

const get = (path: string) => serveFrontend(folder)(new Request(`http://app.test${path}`))

describe('serveFrontend', () => {
  test('hands out a file that exists', async () => {
    expect(await (await get('/assets/app.js')).text()).toBe('console.log(1)')
  })

  test('any other address gets the frontend, whose router decides', async () => {
    expect(await (await get('/some/address/the/router/knows')).text()).toBe('<div id="root"></div>')
  })

  test('the page refuses to be framed by another site', async () => {
    const response = await get('/consent')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
  })

  test('never leaves its folder', async () => {
    expect(await (await get('/../../etc/passwd')).text()).toBe('<div id="root"></div>')
  })

  test('is a 503 while the frontend is not built', async () => {
    const response = await serveFrontend(join(folder, 'missing'))(new Request('http://app.test/'))
    expect(response.status).toBe(503)
  })

  test('never hands out a file outside its folder, however the path is written', async () => {
    await Bun.write(join(folder, '../framework-secret.txt'), 'secret')
    try {
      for (const path of ['/..%2fframework-secret.txt', '/assets/..%2f..%2fframework-secret.txt', '/%2e%2e/framework-secret.txt']) {
        expect(await (await get(path)).text()).toBe('<div id="root"></div>')
      }
    } finally {
      await rm(join(folder, '../framework-secret.txt'), { force: true })
    }
  })

  test('an address that does not decode gets the frontend', async () => {
    expect(await (await get('/%E0%A4%A')).text()).toBe('<div id="root"></div>')
  })

  test('finds a file whose name is written encoded', async () => {
    await Bun.write(join(folder, 'assets/a b.js'), 'spaced')
    expect(await (await get('/assets/a%20b.js')).text()).toBe('spaced')
  })
})
