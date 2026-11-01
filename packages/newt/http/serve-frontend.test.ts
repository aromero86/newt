import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONTENT_SECURITY_POLICY } from './content-security-policy'
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
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })

  test('a page asked for by its name refuses to be framed too; any other file needs not', async () => {
    await Bun.write(join(folder, 'consent.html'), 'consent')
    for (const path of ['/index.html', '/consent.html']) {
      expect((await get(path)).headers.get('x-frame-options')).toBe('DENY')
    }
    expect((await get('/assets/app.js')).headers.get('x-frame-options')).toBeNull()
  })

  test('an address with a NUL names no file: it gets the frontend', async () => {
    const response = await get('/a%00b')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<div id="root"></div>')
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

describe('serveFrontend, its pages\' Content-Security-Policy', () => {
  const THEME = "\n      try { document.documentElement.classList.add('dark') } catch (e) {}\n    "
  const PAGE = `<!doctype html><html><head><script>${THEME}</script><script type="module" crossorigin src="/chunk.js"></script></head><body></body></html>`
  const hashOf = (script: string) => `'sha256-${new Bun.CryptoHasher('sha256').update(script).digest('base64')}'`
  const policyOf = async (csp?: Parameters<typeof serveFrontend>[1], path = '/') => {
    const own = await mkdtemp(join(tmpdir(), 'framework-frontend-csp-'))
    try {
      await Bun.write(join(own, 'index.html'), PAGE)
      return (await serveFrontend(own, csp)(new Request(`http://app.test${path}`))).headers.get('content-security-policy')!
    } finally {
      await rm(own, { recursive: true })
    }
  }
  const directives = (policy: string) => Object.fromEntries(policy.split('; ').map(directive => [directive.split(' ')[0], directive.split(' ').slice(1)]))

  test('is newt\'s, its inline scripts let through by their hashes and nothing else of theirs', async () => {
    const policy = directives(await policyOf())

    expect(policy['script-src']).toEqual(["'self'", hashOf(THEME)])
    expect(policy['default-src']).toEqual(["'self'"])
    expect(policy['object-src']).toEqual(["'none'"])
    expect(policy['frame-ancestors']).toEqual(["'none'"])
    expect(Object.keys(policy).sort()).toEqual(Object.keys(CONTENT_SECURITY_POLICY).sort())
  })

  test('each directive given replaces newt\'s, and null leaves it out', async () => {
    const policy = directives(await policyOf({ 'connect-src': ["'self'", 'https://api.test'], 'img-src': null, 'worker-src': ["'self'"] }))

    expect(policy['connect-src']).toEqual(["'self'", 'https://api.test'])
    expect(policy['img-src']).toBeUndefined()
    expect(policy['worker-src']).toEqual(["'self'"])
    // A script-src of its own still gets the page's hashes.
    expect(directives(await policyOf({ 'script-src': ["'self'", 'https://cdn.test'] }))['script-src']).toEqual(["'self'", 'https://cdn.test', hashOf(THEME)])
  })

  test('false sends none, but that no page is framed', async () => {
    expect(await policyOf(false)).toBe("frame-ancestors 'none'")
  })

  test('a page changed since is read again: its new scripts\' hashes', async () => {
    const own = await mkdtemp(join(tmpdir(), 'framework-frontend-csp-'))
    try {
      const serveIt = serveFrontend(own)
      await Bun.write(join(own, 'index.html'), '<script>one()</script>')
      const before = (await serveIt(new Request('http://app.test/'))).headers.get('content-security-policy')!
      await Bun.sleep(5)
      await Bun.write(join(own, 'index.html'), '<script>two()</script>')
      const after = (await serveIt(new Request('http://app.test/'))).headers.get('content-security-policy')!

      expect(before).toContain(hashOf('one()'))
      expect(after).toContain(hashOf('two()'))
      expect(after).not.toContain(hashOf('one()'))
    } finally {
      await rm(own, { recursive: true })
    }
  })
})
