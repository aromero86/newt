import { describe, expect, test } from 'bun:test'
import { describeStorageContract } from '../port-storage/contract'
import { S3PublicStorage, S3Storage } from './s3-storage'

// Against a real bucket, when there is one: S3_TEST_URL=http://key:secret@127.0.0.1:59000/bucket bun test.
const url = process.env.S3_TEST_URL ? new URL(process.env.S3_TEST_URL) : null
const options = url && {
  accessKeyId: decodeURIComponent(url.username),
  secretAccessKey: decodeURIComponent(url.password),
  endpoint: url.origin,
  bucket: url.pathname.slice(1),
}

describe.skipIf(!options)('S3Storage', () => {
  describeStorageContract('S3Storage', { open: () => S3Storage.open(options!) })

  test('a bucket that is not there is said when it opens, not at the first file', async () => {
    await expect(S3Storage.open({ ...options!, bucket: `none-${crypto.randomUUID()}` })).rejects.toThrow('cannot be reached')
  })

  test('credentials it refuses are said when it opens too', async () => {
    await expect(S3Storage.open({ ...options!, secretAccessKey: 'not-the-secret' })).rejects.toThrow('cannot be reached')
  })

  test('an upload address that expired is refused', async () => {
    const storage = await S3Storage.open(options!)
    const key = `expired-${crypto.randomUUID()}`
    const address = await storage.uploadUrl(key, { expiresIn: 1, contentType: 'text/plain', size: 4 })

    await Bun.sleep(2100)

    expect((await fetch(address, { method: 'PUT', body: 'late' })).status).toBe(403)
    expect(await storage.stat(key)).toBeNull()
  })

  test('a stream of no length said is refused, as its length cannot be held to', async () => {
    const storage = await S3Storage.open(options!)
    const key = `stream-${crypto.randomUUID()}`
    const address = await storage.uploadUrl(key, { expiresIn: 60, contentType: 'text/plain', size: 4 })

    expect((await fetch(address, { method: 'PUT', body: new Blob(['long enough']).stream() })).ok).toBe(false)
    expect(await storage.stat(key)).toBeNull()
  })

  test('a public file has one address, under where it is read from', async () => {
    const storage = await S3PublicStorage.open({ ...options!, publicUrl: 'https://cdn.example.com/' })

    expect(storage.url('boards/avatar/a')).toBe('https://cdn.example.com/boards/avatar/a')
  })
})
