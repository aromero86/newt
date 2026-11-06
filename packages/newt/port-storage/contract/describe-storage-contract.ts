import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { PrivateFiles } from '../files'
import type { StorageAdapter } from '../storage-adapter'
import { UploadTooLarge } from '../upload-too-large'
import type { StorageFixture } from './storage-fixture'

const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
const EXE = new Uint8Array([0x4D, 0x5A, 0x90, 0, 3, 0, 0, 0])
const MB = 1024 * 1024
const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null)

/** Checks a storage adapter keeps what `StorageAdapter` promises, and `Files` over it. */
export function describeStorageContract<S extends StorageAdapter>(name: string, fixture: StorageFixture<S>): void {
  describe(`${name} keeps the StorageAdapter contract`, () => {
    let storage: S
    let files: PrivateFiles
    const send = (address: string, init?: RequestInit) => (fixture.send ? fixture.send(storage, address, init) : fetch(address, init))
    const upload = async (key: string, body: Uint8Array<ArrayBuffer> | string, contentType: string) => {
      const size = typeof body === 'string' ? new TextEncoder().encode(body).byteLength : body.byteLength
      const address = await files.uploadUrl(key, { expiresIn: 60, contentType, size })
      return send(address, { method: 'PUT', body, headers: { 'content-type': contentType } })
    }

    beforeEach(async () => {
      storage = await fixture.open()
      // Each test's keys are its own, for a bucket a suite shares.
      files = new PrivateFiles(storage, `test-${crypto.randomUUID()}`)
    })

    afterEach(() => fixture.close?.(storage))

    test('keeps a file and says how long it is and of which type', async () => {
      expect(await files.put('a', 'hello', { contentType: 'text/plain' })).toEqual({ size: 5, contentType: 'text/plain' })

      const stored = await files.stat('a')
      expect(stored?.size).toBe(5)
      expect(stored?.contentType).toStartWith('text/plain')
    })

    test('nothing under a key is null, not an error', async () => {
      expect(await files.stat('none')).toBeNull()
      expect(await files.open('none')).toBeNull()
      expect(await storage.head(`nothing/${crypto.randomUUID()}`, 4)).toBeNull()
    })

    test('reads a file back as a stream, its length said', async () => {
      await files.put('a', 'hello', { contentType: 'text/plain' })

      const opened = await files.open('a')
      expect(opened?.size).toBe(5)
      expect(await new Response(opened!.stream).text()).toBe('hello')
    })

    test('a put replaces what was under the key', async () => {
      await files.put('a', 'first', { contentType: 'text/plain' })
      await files.put('a', 'second!', { contentType: 'text/plain' })

      expect((await files.stat('a'))?.size).toBe(7)
    })

    test('deleting twice is no error, as a job may run twice', async () => {
      await files.put('a', 'hello', { contentType: 'text/plain' })

      await files.delete('a')
      await files.delete('a')

      expect(await files.stat('a')).toBeNull()
    })

    test('reads only the first bytes it is asked for', async () => {
      await files.put('a', 'hello world', { contentType: 'text/plain' })
      const key = `${(files as unknown as { prefix: string }).prefix}/a`

      expect(text(await storage.head(key, 5))).toBe('hello')
      // Longer than the file: what there is.
      expect(text(await storage.head(key, 500))).toBe('hello world')
    })

    test('a key that could leave its place is refused, by Files, before any adapter sees it', async () => {
      for (const key of ['../other', 'a/../../b', '/a', 'a//b', '', '.hidden', 'a b']) {
        expect(() => files.stat(key)).toThrow('is no storage key')
      }
    })

    test('two parts never meet, under the same key', async () => {
      await files.in('one').put('a', 'one', { contentType: 'text/plain' })

      expect(await files.in('two').stat('a')).toBeNull()
      expect((await files.in('one').stat('a'))?.size).toBe(3)
    })

    test('a client uploads through the address, and a verified file is accepted', async () => {
      expect((await upload('a', PNG, 'image/png')).ok).toBe(true)

      expect((await files.stat('a'))?.size).toBe(PNG.byteLength)
      expect(await files.verifyUpload('a', { contentType: 'image/png', maxBytes: MB })).toBeNull()
    })

    test('an address takes the length it was signed for and no other', async () => {
      const address = await files.uploadUrl('a', { expiresIn: 60, contentType: 'text/plain', size: 5 })
      const put = (body: string) => send(address, { method: 'PUT', body, headers: { 'content-type': 'text/plain' } })

      expect((await put('far too long')).ok).toBe(false)
      expect((await put('shor')).ok).toBe(false)
      expect(await files.stat('a')).toBeNull()

      expect((await put('right')).ok).toBe(true)
      expect((await files.stat('a'))?.size).toBe(5)
    })

    test('no address is signed for a file past what it may be: 1 MB unless told', async () => {
      const asked = (size: number, maxBytes?: number) => files.uploadUrl('a', { expiresIn: 60, contentType: 'text/plain', size, maxBytes })

      await asked(MB)
      await asked(MB + 1, MB + 1)
      await expect(asked(MB + 1)).rejects.toBeInstanceOf(UploadTooLarge)
      await expect(asked(11, 10)).rejects.toMatchObject({ status: 413, code: 'upload_too_large', maxBytes: 10 })
    })

    test('what came is measured against 1 MB too, unless told', async () => {
      await files.put('a', new Uint8Array(MB + 1), { contentType: 'application/octet-stream' })

      expect(await files.verifyUpload('a', { contentType: 'application/octet-stream' })).toBe('too_large')
      expect(await files.verifyUpload('a', { contentType: 'application/octet-stream', maxBytes: MB + 1 })).toBeNull()
    })

    test('an upload that never came is refused as missing', async () => {
      expect(await files.verifyUpload('a', { contentType: 'image/png', maxBytes: MB })).toBe('missing')
    })

    test('a file too long is refused, by what it is', async () => {
      await files.put('a', PNG, { contentType: 'image/png' })

      expect(await files.verifyUpload('a', { contentType: 'image/png', maxBytes: 4 })).toBe('too_large')
    })

    test('bytes of another type are refused, whatever the client said', async () => {
      await files.put('png', 'this is no image', { contentType: 'image/png' })
      await files.put('program', EXE, { contentType: 'text/plain' })

      expect(await files.verifyUpload('png', { contentType: 'image/png', maxBytes: MB })).toBe('wrong_type')
      expect(await files.verifyUpload('program', { contentType: 'text/plain', maxBytes: MB })).toBe('wrong_type')
    })

    test('an empty file is kept, and refused as a type that has a signature', async () => {
      await files.put('a', '', { contentType: 'image/png' })

      expect((await files.stat('a'))?.size).toBe(0)
      expect(await files.verifyUpload('a', { contentType: 'image/png', maxBytes: MB })).toBe('wrong_type')
    })

    test('a type with no signature passes on bytes of nothing known', async () => {
      await files.put('a', 'name,price\nsoap,3', { contentType: 'text/csv' })

      expect(await files.verifyUpload('a', { contentType: 'text/csv', maxBytes: MB })).toBeNull()
    })

    test('a signed address reads the file, served as the module says, whatever was uploaded with it', async () => {
      await upload('a', PNG, 'text/html')

      const address = await files.signedUrl('a', { expiresIn: 60, contentType: 'image/png', filename: 'cara ñ.png', disposition: 'inline' })
      const response = await send(address)

      expect(response.status).toBe(200)
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
      expect(response.headers.get('content-type')).toBe('image/png')
      expect(response.headers.get('content-disposition')).toStartWith('inline; filename="cara _.png"')
    })

    test('what a browser could run is only ever downloaded, even if told inline', async () => {
      await files.put('a', '<script>alert(1)</script>', { contentType: 'text/html' })

      const address = await files.signedUrl('a', { expiresIn: 60, contentType: 'text/html', disposition: 'inline' })

      expect((await send(address)).headers.get('content-disposition')).toStartWith('attachment')
    })
  })
}
