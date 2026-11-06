import type { StoredFile } from './file-types'

/** A file kept, to be read as it comes. */
export type OpenFile = StoredFile & { stream: ReadableStream<Uint8Array> }
