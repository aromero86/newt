/** What is known of a file kept: how long it is, and the type it was kept with, if any. */
export type StoredFile = { size: number, contentType: string | null }

export type PutOptions = { contentType: string }

/** What an adapter is told of an upload: the address takes a file of exactly `size` bytes. */
export type UploadAddressOptions = {
  /** For how many seconds the address works. */
  expiresIn: number
  contentType: string
  /** How long the client says the file is: the address takes that length and no other. */
  size: number
}

export type UploadUrlOptions = UploadAddressOptions & {
  /** How long the file may be: `DEFAULT_MAX_UPLOAD_BYTES` unless told. */
  maxBytes?: number
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
export type UploadRule = {
  contentType: string
  /** How long the file may be: `DEFAULT_MAX_UPLOAD_BYTES` unless told. */
  maxBytes?: number
}

/** Why an upload was not accepted: it never came, it is too long, or its bytes are of another type. */
export type UploadRefusal = 'missing' | 'too_large' | 'wrong_type'
