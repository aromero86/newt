/** What is known of a file kept: how long it is, and the type it was kept with, if any. */
export type StoredFile = { size: number, contentType: string | null }

export type PutOptions = { contentType: string }

export type UploadUrlOptions = {
  /** For how many seconds the address works. */
  expiresIn: number
  contentType: string
  /** How long the file may be, where the adapter can refuse it as it comes (on disk; not on S3). */
  maxBytes: number
}

export type DownloadUrlOptions = {
  /** For how many seconds the address works. */
  expiresIn: number
  /** The type it is served as, whatever was uploaded with it: the module knows it, verified. */
  contentType: string
  /** The name the browser saves it under. */
  filename?: string
  /** `attachment` unless told; `inline` only for types a browser cannot run (see `contentDisposition`). */
  disposition?: 'attachment' | 'inline'
}

/** What an upload must be to be accepted, by what its bytes are and not by what the client said. */
export type UploadRule = { contentType: string, maxBytes: number }

/** Why an upload was not accepted: it never came, it is too long, or its bytes are of another type. */
export type UploadRefusal = 'missing' | 'too_large' | 'wrong_type'
