import { matches, toPage, type Page, type PageRequest } from 'newt/core'
import type { CardDTO } from '../modules/card/card.schema'
import type { CardQuery, CardSearch } from './card-search'

/**
 * The cards' search in memory: every card in a map, each search a look at all of them.
 * Enough for one process; what it keeps is lost when the process ends, so boards
 * indexes every card again when it opens.
 */
export class MemoryCardSearch implements CardSearch {

  private readonly cards = new Map<string, CardDTO>()

  async index(card: CardDTO): Promise<void> {
    this.cards.set(card.id, card)
  }

  async remove(id: string): Promise<void> {
    this.cards.delete(id)
  }

  async removeWorkspace(workspaceId: string): Promise<void> {
    for (const card of this.cards.values()) if (card.workspaceId === workspaceId) this.cards.delete(card.id)
  }

  async search(workspaceId: string, { text, criteria }: CardQuery, page: PageRequest): Promise<Page<string>> {
    const wanted = text?.toLowerCase()
    const has = (card: CardDTO) => !wanted || card.title.toLowerCase().includes(wanted) || card.description.toLowerCase().includes(wanted)
    const ids = [...this.cards.values()]
      .filter(card => card.workspaceId === workspaceId && matches(card, criteria) && has(card))
      .map(card => card.id)
      .sort()
    const after = page.cursor === undefined ? ids : ids.filter(id => id > page.cursor!)
    return toPage(after.slice(0, page.size + 1), page.size, ids.length)
  }
}
