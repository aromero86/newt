import type { Ref } from './ref'

/** A neighbour module whose rows can stand in as a named reference. */
export interface RefFinder {
  find(criteria: { id: string[] }): Promise<Ref[]>
}
