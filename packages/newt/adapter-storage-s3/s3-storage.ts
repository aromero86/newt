import { S3Client } from 'bun'
import {
  contentDisposition,
  type DownloadUrlOptions,
  type OpenFile,
  type PublicStorageAdapter,
  type PutOptions,
  type StorageAdapter,
  type StoredFile,
  type UploadUrlOptions,
} from '../port-storage'
import type { S3PublicStorageOptions, S3StorageOptions } from './s3-storage-options'

const isMissing = (error: unknown) => (error as { code?: string }).code === 'NoSuchKey'

const orNull = <T>(read: Promise<T>): Promise<T | null> =>
  read.catch((error: unknown) => {
    if (isMissing(error)) return null
    throw error
  })

/**
 * Files in a bucket, which exists already: creating it, its CORS and who may read it are
 * the infrastructure's, so `open` only checks it is reached. An address to upload to does
 * not hold a client to a type or a length (Bun signs only the host): `Files.verifyUpload`
 * does, once it came. A bucket's own type for a file is the client's word, so what it is
 * served as is signed in each address to read it.
 */
export class S3Storage implements StorageAdapter {
  protected readonly client: S3Client

  protected constructor(options: S3StorageOptions) {
    this.client = new S3Client(options)
  }

  static async open(options: S3StorageOptions): Promise<S3Storage> {
    return new S3Storage(options).reached(options.bucket)
  }

  async put(key: string, body: Blob | Uint8Array<ArrayBuffer> | string, { contentType }: PutOptions): Promise<StoredFile> {
    const size = await this.client.write(key, body, { type: contentType })
    return { size, contentType }
  }

  async open(key: string): Promise<OpenFile | null> {
    const stored = await this.stat(key)
    return stored && { ...stored, stream: this.client.file(key).stream() }
  }

  async head(key: string, bytes: number): Promise<Uint8Array | null> {
    return orNull(this.client.file(key).slice(0, bytes).bytes().catch((error: unknown) => {
      // An empty file has no first byte to ask for.
      if ((error as { code?: string }).code === 'InvalidRange') return new Uint8Array()
      throw error
    }))
  }

  async stat(key: string): Promise<StoredFile | null> {
    const stats = await orNull(this.client.stat(key))
    return stats && { size: stats.size, contentType: stats.type || null }
  }

  async delete(key: string): Promise<void> {
    await this.client.delete(key)
  }

  async uploadUrl(key: string, { expiresIn, contentType }: UploadUrlOptions): Promise<string> {
    return this.client.presign(key, { method: 'PUT', expiresIn, type: contentType })
  }

  async signedUrl(key: string, { expiresIn, contentType, disposition, filename }: DownloadUrlOptions): Promise<string> {
    return this.client.presign(key, {
      method: 'GET',
      expiresIn,
      type: contentType,
      contentDisposition: contentDisposition(contentType, disposition, filename),
    })
  }

  /**
   * Itself, once the bucket answers. It reads a key that is not there: only a bucket that
   * exists, to credentials it takes, says `NoSuchKey`. (`exists` will not do: it says false
   * of a bucket that is not there either.) A bucket refuses as much to credentials that may
   * not list it: they need `s3:ListBucket` too, or a file that is not there is an error.
   */
  protected async reached(bucket: string): Promise<this> {
    try {
      await this.client.file('newt-storage-check').slice(0, 1).bytes()
      return this
    } catch (error) {
      if (isMissing(error)) return this
      throw new Error(`The bucket '${bucket}' cannot be reached: ${(error as Error).message}`, { cause: error })
    }
  }
}

/** Files of a bucket anyone may read: making it so is the bucket's own policy. */
export class S3PublicStorage extends S3Storage implements PublicStorageAdapter {
  private readonly publicUrl: string

  private constructor(options: S3PublicStorageOptions) {
    super(options)
    this.publicUrl = options.publicUrl.replace(/\/+$/, '')
  }

  static override async open(options: S3PublicStorageOptions): Promise<S3PublicStorage> {
    return new S3PublicStorage(options).reached(options.bucket)
  }

  url(key: string): string {
    return `${this.publicUrl}/${key}`
  }
}
