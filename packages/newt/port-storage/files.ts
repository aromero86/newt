import type { DownloadUrlOptions, PutOptions, StoredFile, UploadRefusal, UploadRule, UploadUrlOptions } from './file-types'
import type { OpenFile } from './open-file'
import { matchesType, SNIFF_BYTES } from './sniff-type'
import type { PublicStorageAdapter, StorageAdapter } from './storage-adapter'
import { assertStorageKey } from './storage-key'
import { UploadTooLarge } from './upload-too-large'

/** How long an uploaded file may be, unless a module says otherwise. */
export const DEFAULT_MAX_UPLOAD_BYTES = 1024 * 1024

/**
 * The files of one part of a context, as a module holds them: what it asks for under a
 * key is kept under the part's prefix, so modules and contexts sharing a bucket never
 * meet. A module takes its own, `base.storage.private.in('attachment')`.
 */
export abstract class Files<A extends StorageAdapter = StorageAdapter> {
  constructor(protected readonly adapter: A, protected readonly prefix: string) {
    assertStorageKey(prefix)
  }

  /** The files under `prefix` of these. */
  abstract in(prefix: string): Files<A>

  put(key: string, body: Blob | Uint8Array<ArrayBuffer> | string, options: PutOptions): Promise<StoredFile> {
    return this.adapter.put(this.full(key), body, options)
  }

  open(key: string): Promise<OpenFile | null> {
    return this.adapter.open(this.full(key))
  }

  stat(key: string): Promise<StoredFile | null> {
    return this.adapter.stat(this.full(key))
  }

  delete(key: string): Promise<void> {
    return this.adapter.delete(this.full(key))
  }

  /**
   * Where a client sends the file with a `PUT`: a file of exactly the `size` it said, which
   * is refused here if longer than `maxBytes`. What it sends is not trusted until `verifyUpload`.
   */
  async uploadUrl(key: string, { maxBytes = DEFAULT_MAX_UPLOAD_BYTES, ...address }: UploadUrlOptions): Promise<string> {
    if (!Number.isSafeInteger(address.size) || address.size < 0) throw new Error(`${address.size} is no length of a file`)
    if (address.size > maxBytes) throw new UploadTooLarge(maxBytes)
    return this.adapter.uploadUrl(this.full(key), address)
  }

  /**
   * Whether what a client uploaded is what the rule says, by how long it really is and by
   * its first bytes: why it is not, or null when it is. What the client said of it counts
   * for nothing, nor does what it told S3.
   */
  async verifyUpload(key: string, { contentType, maxBytes = DEFAULT_MAX_UPLOAD_BYTES }: UploadRule): Promise<UploadRefusal | null> {
    const full = this.full(key)
    const stored = await this.adapter.stat(full)
    if (!stored) return 'missing'
    if (stored.size > maxBytes) return 'too_large'
    const head = await this.adapter.head(full, SNIFF_BYTES)
    return head && matchesType(head, contentType) ? null : 'wrong_type'
  }

  protected full(key: string): string {
    const full = `${this.prefix}/${key}`
    assertStorageKey(full)
    return full
  }
}

/** Files no one reads but through an address a module signed, once it asked who may. */
export class PrivateFiles extends Files {
  in(prefix: string): PrivateFiles {
    return new PrivateFiles(this.adapter, this.full(prefix))
  }

  signedUrl(key: string, options: DownloadUrlOptions): Promise<string> {
    return this.adapter.signedUrl(this.full(key), options)
  }
}

/** Files anyone may read, each at one address for good: what an avatar is. */
export class PublicFiles extends Files<PublicStorageAdapter> {
  in(prefix: string): PublicFiles {
    return new PublicFiles(this.adapter, this.full(prefix))
  }

  url(key: string): string {
    return this.adapter.url(this.full(key))
  }
}
