import { contentDisposition } from './content-disposition'
import type { DownloadUrlOptions, PutOptions, StoredFile, UploadAddressOptions } from './file-types'
import type { OpenFile } from './open-file'
import type { PublicStorageAdapter, StorageAdapter } from './storage-adapter'

type Kept = { bytes: Uint8Array<ArrayBuffer>, contentType: string | null }

const toBytes = async (body: Blob | Uint8Array<ArrayBuffer> | string): Promise<Uint8Array<ArrayBuffer>> =>
  typeof body === 'string' ? new TextEncoder().encode(body) : body instanceof Uint8Array ? body : new Uint8Array(await body.arrayBuffer())

/**
 * Files in the process's memory, for tests. Its addresses are `memory://`, which `send`
 * answers as a bucket would answer `fetch`: a test's client uploads through it. It keeps no
 * clock: that an address expires is each real adapter's to prove.
 */
export class MemoryStorage implements StorageAdapter {
  protected readonly kept = new Map<string, Kept>()

  async put(key: string, body: Blob | Uint8Array<ArrayBuffer> | string, { contentType }: PutOptions): Promise<StoredFile> {
    const bytes = await toBytes(body)
    this.kept.set(key, { bytes, contentType })
    return { size: bytes.byteLength, contentType }
  }

  async open(key: string): Promise<OpenFile | null> {
    const kept = this.kept.get(key)
    if (!kept) return null
    return { size: kept.bytes.byteLength, contentType: kept.contentType, stream: new Blob([kept.bytes]).stream() }
  }

  async head(key: string, bytes: number): Promise<Uint8Array | null> {
    return this.kept.get(key)?.bytes.slice(0, bytes) ?? null
  }

  async stat(key: string): Promise<StoredFile | null> {
    const kept = this.kept.get(key)
    return kept ? { size: kept.bytes.byteLength, contentType: kept.contentType } : null
  }

  async delete(key: string): Promise<void> {
    this.kept.delete(key)
  }

  async uploadUrl(key: string, { contentType, size }: UploadAddressOptions): Promise<string> {
    return `memory://upload/${key}?type=${encodeURIComponent(contentType)}&size=${size}`
  }

  async signedUrl(key: string, { contentType, disposition, filename }: DownloadUrlOptions): Promise<string> {
    return `memory://download/${key}?type=${encodeURIComponent(contentType)}&disposition=${encodeURIComponent(contentDisposition(contentType, disposition, filename))}`
  }

  /** What `fetch` would get from one of its addresses. */
  async send(address: string, init?: RequestInit): Promise<Response> {
    const url = new URL(address)
    const key = url.pathname.slice(1)
    if (url.host === 'upload' && init?.method === 'PUT') {
      const bytes = await new Response(init.body).bytes() as Uint8Array<ArrayBuffer>
      if (bytes.byteLength !== Number(url.searchParams.get('size'))) return new Response(null, { status: 403 })
      await this.put(key, bytes, { contentType: new Headers(init.headers).get('content-type') ?? 'application/octet-stream' })
      return new Response(null, { status: 200 })
    }
    const kept = this.kept.get(key)
    if (url.host !== 'download' || !kept) return new Response(null, { status: 404 })
    return new Response(kept.bytes, { headers: { 'content-type': url.searchParams.get('type')!, 'content-disposition': url.searchParams.get('disposition')! } })
  }
}

/** Public files in memory, for tests. */
export class MemoryPublicStorage extends MemoryStorage implements PublicStorageAdapter {
  url(key: string): string {
    return `memory://public/${key}`
  }
}
