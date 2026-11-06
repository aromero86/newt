import { join } from 'node:path'
import { DiskPublicStorage, DiskStorage } from '@newt-kit/newt/adapter-storage-disk'
import { S3PublicStorage, S3Storage } from '@newt-kit/newt/adapter-storage-s3'
import { CONTENT_SECURITY_POLICY, type ContentSecurityPolicy } from '@newt-kit/newt/http'
import type { PublicStorageAdapter, StorageAdapter } from '@newt-kit/newt/port-storage'
import type { Config } from '../../config'
import type { CooperBase } from '../cooper-base'

/** Where the contexts keep files, from `config.ts`. */
export type FilesConfig = Config['boards']['files']

/** How long a file sent to the disk's routes may be: as long as any module takes. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const s3Options = ({ endpoint, region, accessKeyId, secretAccessKey }: NonNullable<FilesConfig['s3']>) =>
  ({ endpoint, region, accessKeyId, secretAccessKey })

const diskOptions = (files: FilesConfig, context: string, kind: string, publicUrl: string) => ({
  folder: join(files.folder, `${context}-${kind}`),
  baseUrl: `${publicUrl}/api/files`,
  secret: files.secret,
})

/** A context's private files: in the private bucket, under its name, or in a folder of its own. */
export function openPrivateStorage(files: FilesConfig, context: string, publicUrl: string): Promise<StorageAdapter> {
  return files.s3
    ? S3Storage.open({ ...s3Options(files.s3), bucket: files.s3.privateBucket })
    : DiskStorage.open(diskOptions(files, context, 'private', publicUrl))
}

/** A context's public files: in the public bucket, under its name, or in a folder of its own. */
export function openPublicStorage(files: FilesConfig, context: string, publicUrl: string): Promise<PublicStorageAdapter> {
  return files.s3
    ? S3PublicStorage.open({ ...s3Options(files.s3), bucket: files.s3.publicBucket, publicUrl: files.s3.publicUrl })
    : DiskPublicStorage.open(diskOptions(files, context, 'public', publicUrl))
}

/**
 * Files on disk are served by the context itself. The routes are public: the signature
 * says who may. On S3 there is nothing to mount: the bucket answers.
 */
export function mountFilesOnDisk(base: CooperBase, storage: StorageAdapter | undefined): void {
  if (!(storage instanceof DiskStorage)) return
  base.http.get('/files/*', storage.handler, { public: true })
  base.http.put('/files/*', storage.handler, { public: true, crossOrigin: true, maxBodyBytes: MAX_UPLOAD_BYTES })
}

/**
 * What a context's pages may reach for its files, besides themselves: on S3, the bucket
 * they upload to and where public files are read from; on disk, the context that serves
 * the pictures (`picturesAt`), which may be another's.
 */
export function filesPolicy(files: FilesConfig, picturesAt: string): ContentSecurityPolicy {
  const pictures = new URL(files.s3?.publicUrl ?? picturesAt).origin
  return {
    'img-src': [...CONTENT_SECURITY_POLICY['img-src']!, pictures],
    'connect-src': [...CONTENT_SECURITY_POLICY['connect-src']!, ...(files.s3 ? [new URL(files.s3.endpoint).origin] : [])],
  }
}
