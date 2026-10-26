import type { Criteria, Page, PageRequest } from 'newt/core'
import type { CardDTO } from '../modules/card/card.schema'

/** What a search asks: text its title or description has (whatever its case), and criteria on its fields. */
export type CardQuery = {
  text?: string
  criteria: Criteria<CardDTO>
}

/**
 * Where the cards are searched, as a port: an index of their text and fields beside
 * the table, kept by a worker as each card changes, so it is a moment behind. The
 * cards own the index: whatever happens to a card, they index it again or remove it.
 *
 * cooper keeps it in memory (`MemoryCardSearch`): one process, built again from the
 * table each time boards opens. Several processes, or more cards than memory holds,
 * need a search server (Elasticsearch, OpenSearch…): an adapter of this same port,
 * which passes `describeCardSearchContract`.
 */
export interface CardSearch {
  /**
   * Keeps the card as it is now, in place of what it kept of it before, unless that
   * is newer (a later `updatedAt`): two jobs indexing one card at once may hand it
   * an older copy last.
   */
  index(card: CardDTO): Promise<void>
  /**
   * Forgets a card for good: nothing happens if it never had it, and a copy of it
   * indexed afterwards is not kept if it is older than the removal, as a job that read
   * the card before it was deleted may hand it over after.
   */
  remove(id: string): Promise<void>
  /** Forgets every card of a workspace. */
  removeWorkspace(workspaceId: string): Promise<void>
  /** A page of the ids of the workspace's cards that match, by id, as `PageRequest` pages. */
  search(workspaceId: string, query: CardQuery, page: PageRequest): Promise<Page<string>>
}
