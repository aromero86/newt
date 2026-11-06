export type S3StorageOptions = {
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  region?: string
  /** Where it is, for anything but AWS: `https://<account>.r2.cloudflarestorage.com`, MinIO's. */
  endpoint?: string
  /** `https://<bucket>.<endpoint>/…` rather than `https://<endpoint>/<bucket>/…`. */
  virtualHostedStyle?: boolean
}

export type S3PublicStorageOptions = S3StorageOptions & {
  /** Where its files are read from: the bucket's address, or a CDN's. */
  publicUrl: string
}
