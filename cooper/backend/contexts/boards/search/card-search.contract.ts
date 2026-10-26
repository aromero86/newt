import { beforeEach, describe, expect, test } from 'bun:test'
import type { Criteria } from 'newt/core'
import type { CardDTO } from '../modules/card/card.schema'
import type { CardSearch } from './card-search'

/** A card as the search is handed it: these fields, and the rest as any card has them. */
function cardOf(fields: Partial<CardDTO> & Pick<CardDTO, 'title'>): CardDTO {
  return {
    id: Bun.randomUUIDv7(), workspaceId: 'acme', boardId: 'roadmap', columnId: 'todo', number: 1,
    description: '', assigneeId: null, position: 0, createdAt: '', updatedAt: '', ...fields,
  }
}

/** Checks an adapter of the cards' search keeps what `CardSearch` promises. */
export function describeCardSearchContract(name: string, open: () => CardSearch | Promise<CardSearch>): void {
  describe(`${name} keeps the CardSearch contract`, () => {
    let search: CardSearch

    beforeEach(async () => {
      search = await open()
    })

    const ids = async (text?: string, criteria: Criteria<CardDTO> = {}, workspaceId = 'acme') =>
      (await search.search(workspaceId, { text, criteria }, { size: 10 })).items

    test('finds cards by text in their title or description, whatever its case, by id', async () => {
      const plan = cardOf({ title: 'Write the plan', description: 'Dates and PEOPLE' })
      const party = cardOf({ title: 'Plan the party' })
      const umlaut = cardOf({ title: 'Ärger im Büro' })
      const percent = cardOf({ title: '100% done_ish' })
      for (const card of [plan, party, umlaut, percent]) await search.index(card)

      expect(await ids('PLAN')).toEqual([plan.id, party.id])
      expect(await ids('people')).toEqual([plan.id])
      expect(await ids('ärger IM')).toEqual([umlaut.id])
      // `%` and `_` are only themselves.
      expect(await ids('0%')).toEqual([percent.id])
      expect(await ids('_x')).toEqual([])
    })

    test('finds by criteria on the fields, alone or with text', async () => {
      const design = cardOf({ title: 'Design the logo', columnId: 'doing', assigneeId: 'bea' })
      const party = cardOf({ title: 'Plan the party', columnId: 'doing', number: 2 })
      const launch = cardOf({ title: 'Plan the launch', number: 3 })
      for (const card of [design, party, launch]) await search.index(card)

      expect(await ids('plan', { columnId: 'doing' })).toEqual([party.id])
      expect(await ids(undefined, { or: [{ assigneeId: 'bea' }, { number: 3 }] })).toEqual([design.id, launch.id])
      expect(await ids(undefined, { assigneeId: { in: ['bea', 'cy'] } })).toEqual([design.id])
    })

    test('finds a workspace\'s cards only', async () => {
      const ours = cardOf({ title: 'Plan' })
      await search.index(ours)
      await search.index(cardOf({ title: 'Plan', workspaceId: 'globex' }))

      expect(await ids('plan')).toEqual([ours.id])
    })

    test('keeps a card as it was indexed last, and forgets it when removed', async () => {
      const card = cardOf({ title: 'Plan' })
      await search.index(card)
      await search.index({ ...card, title: 'Design' })

      expect(await ids('plan')).toEqual([])
      expect(await ids('design')).toEqual([card.id])

      await search.remove(card.id)
      await search.remove(card.id)
      expect(await ids()).toEqual([])
    })

    test('keeps the newer of two copies of a card, whichever is indexed last', async () => {
      const card = cardOf({ title: 'Plan', updatedAt: '2026-01-01T10:00:00.000Z' })
      const edited = { ...card, title: 'Design', updatedAt: '2026-01-01T10:00:01.000Z' }
      await search.index(edited)
      await search.index(card)

      expect(await ids('plan')).toEqual([])
      expect(await ids('design')).toEqual([card.id])
    })

    test('keeps a removed card out when a copy from before its removal comes late', async () => {
      const card = cardOf({ title: 'Plan', updatedAt: new Date(Date.now() - 1000).toISOString() })
      await search.index(card)
      await search.remove(card.id)
      await search.index(card)

      expect(await ids()).toEqual([])
    })

    test('forgets every card of a workspace, and only those', async () => {
      const theirs = cardOf({ title: 'Plan', workspaceId: 'globex' })
      await search.index(theirs)
      for (let i = 0; i < 3; i++) await search.index(cardOf({ title: 'Plan' }))

      await search.removeWorkspace('acme')

      expect(await ids()).toEqual([])
      expect(await ids(undefined, {}, 'globex')).toEqual([theirs.id])
    })

    test('pages by id: the cursor is the last id of the page before, the total is every match', async () => {
      const cards = Array.from({ length: 5 }, (_, i) => cardOf({ title: `Task ${i}` }))
      for (const card of cards.toReversed()) await search.index(card)

      const first = await search.search('acme', { text: 'task', criteria: {} }, { size: 2 })
      expect(first).toMatchObject({ items: [cards[0]!.id, cards[1]!.id], hasMore: true, total: 5 })
      const last = await search.search('acme', { text: 'task', criteria: {} }, { size: 2, cursor: cards[3]!.id })
      expect(last).toMatchObject({ items: [cards[4]!.id], hasMore: false, total: 5 })
    })
  })
}
