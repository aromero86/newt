import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { CardDTO } from '../../../boards/modules/card/card.schema'
import { openTestBackoffice, type TestBackoffice } from '../../testing/open-test-backoffice'

describe('metric', () => {
  let t: TestBackoffice

  beforeEach(async () => {
    t = await openTestBackoffice()
  })

  afterEach(() => t.close())

  const today = () => new Date().toISOString().slice(0, 10)

  test('counts what auth and boards tell, once their workers ran', async () => {
    const sam = await t.staffMember('Sam')
    const ana = await t.signUp('Ana')
    const acme = await t.as(ana, () => t.auth.modules.tenant.create({ name: 'Acme' }))
    await t.board(ana, acme.id, 'Roadmap', ['One', 'Two', 'Three'])

    // Nothing yet: the numbers are a projection, a moment behind.
    expect((await t.as(sam, () => t.modules.metric.overview())).totals).toEqual({ cards: 0, workspaces: 0, signUps: 0 })

    await t.settled()

    const { cards } = (await t.boards.modules.card.countByWorkspace([acme.id]))[0]!
    expect(cards).toBeGreaterThanOrEqual(3)
    const overview = await t.as(sam, () => t.modules.metric.overview())
    expect(overview.totals).toEqual({ cards, workspaces: 1, signUps: 2 })
    expect(overview.cardsPerDay).toHaveLength(30)
    expect(overview.cardsPerDay.at(-1)).toEqual({ day: today(), count: cards })
    expect(overview.workspacesPerDay.at(-1)).toEqual({ day: today(), count: 1 })
    expect(overview.signUpsPerDay.slice(0, -1).every(day => day.count === 0)).toBe(true)
  })

  test('counts by the day of the context\'s clock, and shows the days up to its today', async () => {
    await t.close()
    let time = Date.parse('2027-03-15T12:00:00Z')
    t = await openTestBackoffice({ clock: { now: () => new Date(time) } })
    const sam = await t.staffMember('Sam')
    await t.settled()

    expect((await t.as(sam, () => t.modules.metric.overview())).signUpsPerDay.at(-1)).toEqual({ day: '2027-03-15', count: 1 })

    time += 2 * 24 * 60 * 60_000
    const { signUpsPerDay } = await t.as(sam, () => t.modules.metric.overview())
    expect(signUpsPerDay.slice(-3)).toEqual([{ day: '2027-03-15', count: 1 }, { day: '2027-03-16', count: 0 }, { day: '2027-03-17', count: 0 }])
  })

  test('counts a card once, however many times its worker runs', async () => {
    const card = { id: '0190a0a0-0000-7000-8000-000000000001', workspaceId: 'w', createdAt: new Date().toISOString() } as CardDTO
    await t.modules.metric.recordCard(card)
    await t.modules.metric.recordCard(card)

    const sam = await t.staffMember('Sam')
    expect((await t.as(sam, () => t.modules.metric.overview())).totals.cards).toBe(1)
  })
})
