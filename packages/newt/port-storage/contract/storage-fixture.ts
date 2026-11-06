import type { StorageAdapter } from '../storage-adapter'

/** How the storage suite gets an adapter with nothing in it, and how a client talks to its addresses. */
export type StorageFixture<S extends StorageAdapter = StorageAdapter> = {
  open(): Promise<S>
  close?(storage: S): Promise<void>
  /** What a client's `fetch` is to its addresses: `fetch` unless told. */
  send?(storage: S, address: string, init?: RequestInit): Promise<Response>
}
