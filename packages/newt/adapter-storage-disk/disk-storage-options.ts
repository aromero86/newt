import type { Clock } from '../core'

export type DiskStorageOptions = {
  /** Where its files are: created if it is not there. With several instances, a volume they share. */
  folder: string
  /** The address `handler` is mounted at, as a browser reaches it: `https://app.example.com/api/files`. */
  baseUrl: string
  /** What its addresses are signed with, 32 characters or more. Change it, and every address given stops working. */
  secret: string
  /** What tells when an address expires: the real time unless told. */
  clock?: Clock
}
