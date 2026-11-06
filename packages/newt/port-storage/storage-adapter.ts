import type { DownloadUrlOptions, PutOptions, StoredFile, UploadUrlOptions } from './file-types'
import type { OpenFile } from './open-file'

/**
 * Where a context's files are kept: the port every storage adapter implements. It only
 * knows bytes under keys; which file is whose, and who may see it, is a module's. A
 * module never holds an adapter: it asks its base for `Files` (`base.storage.private.in('x')`).
 *
 * Keys come checked (`assertStorageKey`), each adapter takes them as they are.
 */
export interface StorageAdapter {
  /** Keeps `body` under `key`, replacing what was there. */
  put(key: string, body: Blob | Uint8Array<ArrayBuffer> | string, options: PutOptions): Promise<StoredFile>
  /** What is kept under `key` as a stream, null when nothing is. */
  open(key: string): Promise<OpenFile | null>
  /** The first `bytes` bytes kept under `key`, null when nothing is. */
  head(key: string, bytes: number): Promise<Uint8Array | null>
  /** How long what is kept under `key` is, and its type, null when nothing is. */
  stat(key: string): Promise<StoredFile | null>
  /** Forgets `key`: nothing kept under it is no error, as a job may run twice. */
  delete(key: string): Promise<void>
  /**
   * An address a client sends the file to with a `PUT`, for `expiresIn` seconds. Only a
   * hint to the adapter what its type and length will be: S3 does not hold a client to
   * them, so it is `Files.verifyUpload` that has the last word.
   */
  uploadUrl(key: string, options: UploadUrlOptions): Promise<string>
  /** An address anyone holding it can read the file from, for `expiresIn` seconds. */
  signedUrl(key: string, options: DownloadUrlOptions): Promise<string>
}

/** An adapter whose files anyone may read: each has one address, for good. */
export interface PublicStorageAdapter extends StorageAdapter {
  url(key: string): string
}
