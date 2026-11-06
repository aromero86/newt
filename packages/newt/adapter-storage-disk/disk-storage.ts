import { createHmac, timingSafeEqual } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { systemClock, type Clock } from '../core'
import {
  assertStorageKey,
  contentDisposition,
  type DownloadUrlOptions,
  type OpenFile,
  type PublicStorageAdapter,
  type PutOptions,
  type StorageAdapter,
  type StoredFile,
  type UploadUrlOptions,
} from '../port-storage'
import type { DiskStorageOptions } from './disk-storage-options'

const MIN_SECRET = 32
/** Beside the files, under a name no key can have (a key's names never start with a sign). */
const TYPES = '.types'
const PARTS = '.parts'
const OCTETS = 'application/octet-stream'
/** A file served from the application's own origin never runs there, whatever it holds. */
const NEVER_RUNS = { 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'" }

const answer = (status: number) => new Response(null, { status, headers: NEVER_RUNS })

/**
 * Files in a folder of the server, with the addresses S3 would give: signed, for a while,
 * and served by the application itself, through `handler`, which its router mounts:
 *
 * ```ts
 * base.http.get('/files/*', disk.handler, { public: true })
 * base.http.put('/files/*', disk.handler, { public: true, crossOrigin: true, maxBodyBytes: 20 * 1024 * 1024 })
 * ```
 *
 * The signature is what lets a request in, so the routes are public. Unlike S3, it holds an
 * upload to its type and its length as it comes.
 */
export class DiskStorage implements StorageAdapter {
  protected readonly folder: string
  private readonly baseUrl: string
  private readonly secret: string
  private readonly clock: Clock
  private readonly basePath: string

  protected constructor(options: DiskStorageOptions) {
    if (options.secret.length < MIN_SECRET) throw new Error(`The secret of a DiskStorage has ${MIN_SECRET} characters or more`)
    this.folder = options.folder
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.basePath = new URL(this.baseUrl).pathname
    this.secret = options.secret
    this.clock = options.clock ?? systemClock
  }

  static async open(options: DiskStorageOptions): Promise<DiskStorage> {
    const storage = new DiskStorage(options)
    await storage.prepared()
    return storage
  }

  async put(key: string, body: Blob | Uint8Array<ArrayBuffer> | string, { contentType }: PutOptions): Promise<StoredFile> {
    const part = this.partPath()
    const size = await Bun.write(part, body)
    await this.keep(part, key, contentType)
    return { size, contentType }
  }

  async open(key: string): Promise<OpenFile | null> {
    const stored = await this.stat(key)
    return stored && { ...stored, stream: Bun.file(this.path(key)).stream() }
  }

  async head(key: string, bytes: number): Promise<Uint8Array | null> {
    const file = Bun.file(this.path(key))
    return await file.exists() ? file.slice(0, bytes).bytes() : null
  }

  async stat(key: string): Promise<StoredFile | null> {
    const file = Bun.file(this.path(key))
    if (!await file.exists()) return null
    const type = Bun.file(this.typePath(key))
    return { size: file.size, contentType: await type.exists() ? await type.text() : null }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true })
    await rm(this.typePath(key), { force: true })
  }

  async uploadUrl(key: string, { expiresIn, contentType, maxBytes }: UploadUrlOptions): Promise<string> {
    return this.signed('PUT', key, expiresIn, { type: contentType, max: String(maxBytes) })
  }

  async signedUrl(key: string, { expiresIn, contentType, disposition, filename }: DownloadUrlOptions): Promise<string> {
    return this.signed('GET', key, expiresIn, { type: contentType, disposition: contentDisposition(contentType, disposition, filename) })
  }

  /** What serves its addresses: mount it on `GET` and `PUT` of the path `baseUrl` says, and everything under it. */
  readonly handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (!url.pathname.startsWith(`${this.basePath}/`)) return answer(404)
    const key = url.pathname.slice(this.basePath.length + 1)
    try {
      assertStorageKey(key)
    } catch {
      return answer(404)
    }
    if (request.method === 'PUT') return this.isSigned('PUT', key, url) ? this.receive(request, key, url) : answer(403)
    if (request.method !== 'GET') return answer(405)
    if (url.searchParams.has('signature')) return this.isSigned('GET', key, url) ? this.serveSigned(key, url) : answer(403)
    return this.serveUnsigned(key)
  }

  /** A file asked for with no signature: private files have no such address. */
  protected async serveUnsigned(_key: string): Promise<Response> {
    return answer(403)
  }

  protected async prepared(): Promise<void> {
    await mkdir(join(this.folder, PARTS), { recursive: true })
  }

  /** A file of its own to the client, as `headers` say. */
  protected async serve(key: string, headers: Record<string, string>): Promise<Response> {
    const file = Bun.file(this.path(key))
    if (!await file.exists()) return answer(404)
    return new Response(file.stream(), { headers: { ...NEVER_RUNS, 'content-length': String(file.size), ...headers } })
  }

  private serveSigned(key: string, url: URL): Promise<Response> {
    return this.serve(key, {
      'content-type': url.searchParams.get('type') ?? OCTETS,
      'content-disposition': url.searchParams.get('disposition') ?? 'attachment',
    })
  }

  /** An upload, into a part that takes its key's place once all of it came. Its own length is counted, not believed. */
  private async receive(request: Request, key: string, url: URL): Promise<Response> {
    const contentType = url.searchParams.get('type')!
    if (request.headers.get('content-type')?.split(';')[0]?.trim() !== contentType) return answer(415)
    const max = Number(url.searchParams.get('max'))
    if (Number(request.headers.get('content-length') ?? 0) > max) return answer(413)

    const part = this.partPath()
    const writer = Bun.file(part).writer()
    let size = 0
    try {
      if (request.body) {
        for await (const chunk of request.body) {
          size += chunk.byteLength
          if (size > max) {
            await writer.end()
            await rm(part, { force: true })
            return answer(413)
          }
          await writer.write(chunk)
        }
      }
      await writer.end()
      await this.keep(part, key, contentType)
      return answer(200)
    } catch (error) {
      // The client went away halfway: close what it was writing to, and leave nothing.
      await Promise.resolve(writer.end()).catch(() => undefined)
      await rm(part, { force: true })
      throw error
    }
  }

  /** A part becomes its key's: all of it at once, so no one ever reads half a file. */
  private async keep(part: string, key: string, contentType: string): Promise<void> {
    await mkdir(dirname(this.path(key)), { recursive: true })
    await Bun.write(this.typePath(key), contentType)
    await rename(part, this.path(key))
  }

  private signed(method: 'GET' | 'PUT', key: string, expiresIn: number, params: Record<string, string>): string {
    const expires = String(Math.floor(this.clock.now().getTime() / 1000) + expiresIn)
    const query = new URLSearchParams({ ...params, expires })
    query.set('signature', this.signature(method, key, query))
    return `${this.baseUrl}/${key}?${query}`
  }

  private isSigned(method: 'GET' | 'PUT', key: string, url: URL): boolean {
    const given = Buffer.from(url.searchParams.get('signature') ?? '', 'hex')
    const expected = Buffer.from(this.signature(method, key, url.searchParams), 'hex')
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false
    return Number(url.searchParams.get('expires')) * 1000 > this.clock.now().getTime()
  }

  /** Over what the address says, every word of it but the signature: nothing can be changed. */
  private signature(method: string, key: string, query: URLSearchParams): string {
    const said = [...query].filter(([name]) => name !== 'signature').sort(([a], [b]) => a.localeCompare(b))
    return createHmac('sha256', this.secret).update(JSON.stringify([method, key, said])).digest('hex')
  }

  private path(key: string): string {
    return join(this.folder, key)
  }

  private typePath(key: string): string {
    return join(this.folder, TYPES, key)
  }

  private partPath(): string {
    return join(this.folder, PARTS, crypto.randomUUID())
  }
}

/** Files in a folder anyone may read, at `<baseUrl>/<key>`. */
export class DiskPublicStorage extends DiskStorage implements PublicStorageAdapter {
  private readonly publicBase: string

  private constructor(options: DiskStorageOptions) {
    super(options)
    this.publicBase = options.baseUrl.replace(/\/+$/, '')
  }

  static override async open(options: DiskStorageOptions): Promise<DiskPublicStorage> {
    const storage = new DiskPublicStorage(options)
    await storage.prepared()
    return storage
  }

  url(key: string): string {
    return `${this.publicBase}/${key}`
  }

  /** As it was kept, for browsers and caches to keep a while; what a browser could run, only ever downloaded. */
  protected override async serveUnsigned(key: string): Promise<Response> {
    const stored = await this.stat(key)
    const contentType = stored?.contentType ?? OCTETS
    return this.serve(key, {
      'content-type': contentType,
      'content-disposition': contentDisposition(contentType, 'inline'),
      'cache-control': 'public, max-age=86400',
    })
  }
}
