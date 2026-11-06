import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HttpRouter, serve } from '../http'
import { PrivateFiles, PublicFiles } from '../port-storage'
import { describeStorageContract } from '../port-storage/contract'
import { freePort } from '../testing'
import { DiskPublicStorage, DiskStorage } from './disk-storage'

const SECRET = 'a secret that is long enough for it'
const MAX = 1024

const folders: string[] = []
const newFolder = () => {
  const folder = mkdtempSync(join(tmpdir(), 'newt-disk-storage-'))
  folders.push(folder)
  return folder
}
afterAll(() => folders.forEach(folder => rmSync(folder, { recursive: true, force: true })))

const answering = (handler: DiskStorage['handler']) => (address: string, init?: RequestInit) => handler(new Request(address, init))
const open = (clock?: { now(): Date }, folder = newFolder()) =>
  DiskStorage.open({ folder, baseUrl: 'http://app.test/api/files', secret: SECRET, clock })

describeStorageContract('DiskStorage', {
  open: () => open(),
  send: (storage, address, init) => storage.handler(new Request(address, init)),
})

describe('DiskStorage, on its own', () => {
  test('a secret too short is refused', async () => {
    await expect(DiskStorage.open({ folder: newFolder(), baseUrl: 'http://app.test/files', secret: 'short' })).rejects.toThrow('32 characters')
  })

  test('an address stops working once it expired', async () => {
    let time = Date.parse('2026-01-01T10:00:00Z')
    const storage = await open({ now: () => new Date(time) })
    const send = answering(storage.handler)
    await storage.put('a', 'hello', { contentType: 'text/plain' })
    const address = await storage.signedUrl('a', { expiresIn: 60, contentType: 'text/plain' })

    expect((await send(address)).status).toBe(200)
    time += 61_000
    expect((await send(address)).status).toBe(403)
  })

  test('an address changed in any word is refused', async () => {
    const storage = await open()
    const send = answering(storage.handler)
    await storage.put('a', 'hello', { contentType: 'text/plain' })
    const address = await storage.signedUrl('a', { expiresIn: 60, contentType: 'text/plain' })

    expect((await send(address.replace('/a?', '/b?'))).status).toBe(403)
    expect((await send(address.replace('text%2Fplain', 'text%2Fhtml'))).status).toBe(403)
    expect((await send(address.replace(/signature=.{4}/, 'signature=0000'))).status).toBe(403)
  })

  test('an address to read does not upload, nor one to upload read', async () => {
    const storage = await open()
    const send = answering(storage.handler)
    await storage.put('a', 'hello', { contentType: 'text/plain' })

    const read = await storage.signedUrl('a', { expiresIn: 60, contentType: 'text/plain' })
    const put = await storage.uploadUrl('a', { expiresIn: 60, contentType: 'text/plain', size: 1 })

    expect((await send(read, { method: 'PUT', body: 'x', headers: { 'content-type': 'text/plain' } })).status).toBe(403)
    expect((await send(put)).status).toBe(403)
  })

  test('a private file has no address without a signature', async () => {
    const storage = await open()
    await storage.put('a', 'hello', { contentType: 'text/plain' })

    expect((await storage.handler(new Request('http://app.test/api/files/a'))).status).toBe(403)
  })

  test('a key that leaves the folder is no file', async () => {
    const storage = await open()

    for (const path of ['%2e%2e/secret', '.types/a', '.parts/a', 'a%2F..%2F..%2Fb']) {
      expect((await storage.handler(new Request(`http://app.test/api/files/${path}`))).status).toBe(404)
    }
  })

  test('an upload is held to the type signed', async () => {
    const storage = await open()
    const address = await storage.uploadUrl('a', { expiresIn: 60, contentType: 'image/png', size: 1 })

    const response = await storage.handler(new Request(address, { method: 'PUT', body: 'x', headers: { 'content-type': 'text/html' } }))

    expect(response.status).toBe(415)
    expect(await storage.stat('a')).toBeNull()
  })

  test('an upload of another length is refused, and leaves nothing, said or not', async () => {
    const folder = newFolder()
    const storage = await open(undefined, folder)
    const address = await storage.uploadUrl('a', { expiresIn: 60, contentType: 'text/plain', size: 4 })
    const headers = { 'content-type': 'text/plain' }

    const told = await storage.handler(new Request(address, { method: 'PUT', body: 'too long', headers }))
    const stream = new Blob(['too long']).stream()
    const untold = await storage.handler(new Request(address, { method: 'PUT', body: stream, headers }))

    const short = await storage.handler(new Request(address, { method: 'PUT', body: new Blob(['abc']).stream(), headers }))

    expect([told.status, untold.status, short.status]).toEqual([413, 413, 400])
    expect(await storage.stat('a')).toBeNull()
    expect(readdirSync(join(folder, '.parts'))).toEqual([])
  })

  test('what it serves never runs on the application\'s origin', async () => {
    const storage = await open()
    await storage.put('a', '<script>alert(1)</script>', { contentType: 'text/html' })

    const response = await storage.handler(new Request(await storage.signedUrl('a', { expiresIn: 60, contentType: 'text/html' })))

    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain('sandbox')
    expect(response.headers.get('content-disposition')).toBe('attachment')
  })
})

describe('DiskPublicStorage', () => {
  const openPublic = () => DiskPublicStorage.open({ folder: newFolder(), baseUrl: 'http://app.test/api/files', secret: SECRET })

  test('a file is read at its one address, kept a while by caches', async () => {
    const files = new PublicFiles(await openPublic(), 'boards').in('avatar')
    await files.put('a', new Uint8Array([0x89, 0x50, 0x4E, 0x47]), { contentType: 'image/png' })

    expect(files.url('a')).toBe('http://app.test/api/files/boards/avatar/a')
    const storage = (files as unknown as { adapter: DiskPublicStorage }).adapter
    const response = await storage.handler(new Request(files.url('a')))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-disposition')).toBe('inline')
    expect(response.headers.get('cache-control')).toContain('public')
  })

  test('a page or an SVG someone uploaded is only ever downloaded', async () => {
    const storage = await openPublic()
    await storage.put('page', '<script>alert(1)</script>', { contentType: 'text/html' })
    await storage.put('drawing', '<svg onload="alert(1)"/>', { contentType: 'image/svg+xml' })

    for (const key of ['page', 'drawing']) {
      expect((await storage.handler(new Request(storage.url(key)))).headers.get('content-disposition')).toBe('attachment')
    }
  })

  test('uploading still takes a signature', async () => {
    const storage = await openPublic()

    const response = await storage.handler(new Request(storage.url('a'), { method: 'PUT', body: 'x', headers: { 'content-type': 'text/plain' } }))

    expect(response.status).toBe(403)
  })
})

describe('DiskStorage mounted on a router', () => {
  let server: ReturnType<typeof serve>
  let files: PrivateFiles
  let baseUrl: string

  beforeAll(async () => {
    const port = await freePort()
    baseUrl = `http://127.0.0.1:${port}`
    const storage = await DiskStorage.open({ folder: newFolder(), baseUrl: `${baseUrl}/api/files`, secret: SECRET })
    const router = new HttpRouter()
    router.get('/files/*', storage.handler, { public: true })
    router.put('/files/*', storage.handler, { public: true, crossOrigin: true, maxBodyBytes: MAX })
    server = serve({ port, router })
    files = new PrivateFiles(storage, 'boards').in('attachment')
  })

  afterAll(() => server.stop(true))

  test('a browser uploads and reads back through its routes', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2])
    const address = await files.uploadUrl('a', { expiresIn: 60, contentType: 'image/png', size: png.byteLength, maxBytes: MAX })

    const put = await fetch(address, { method: 'PUT', body: png, headers: { 'content-type': 'image/png', 'sec-fetch-site': 'cross-site' } })
    const verdict = await files.verifyUpload('a', { contentType: 'image/png', maxBytes: MAX })
    const read = await fetch(await files.signedUrl('a', { expiresIn: 60, contentType: 'image/png', filename: 'a.png' }))

    expect(put.status).toBe(200)
    expect(verdict).toBeNull()
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(png)
    expect(read.headers.get('content-disposition')).toStartWith('attachment; filename="a.png"')
    expect(read.headers.get('cache-control')).toBe('no-store')
  })

  test('a body past what the route takes is refused by the router too', async () => {
    const address = await files.uploadUrl('big', { expiresIn: 60, contentType: 'text/plain', size: MAX + 1, maxBytes: MAX * 4 })

    const put = await fetch(address, { method: 'PUT', body: 'x'.repeat(MAX + 1), headers: { 'content-type': 'text/plain' } })

    expect(put.status).toBe(413)
  })
})
