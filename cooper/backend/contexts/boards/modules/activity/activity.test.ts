import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { BoardsBase } from '../../boards-base'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'

describe('activity', () => {
  let t: TestBoards
  let boardId: string
  let todo: string
  let doing: string

  beforeEach(async () => {
    t = await openTestBoards()
    t.auth.join('acme', 'ana')
    t.auth.join('acme', 'bea')
    t.auth.join('globex', 'carl')
    boardId = (await inAcme(() => t.modules.board.create({ name: 'Roadmap' }))).id
    ;[todo, doing] = await Promise.all(['To do', 'Doing'].map(name => inAcme(() => t.modules.column.add(boardId, { name })))).then(columns => columns.map(column => column.id))
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>, via: 'web' | 'mcp' = 'web') => t.as('ana', 'acme', fn, via)
  const activityOf = (cardId: string, size = 20) => inAcme(() => t.modules.activity.listForCard(cardId, { size }))

  test('records what happens to a card, who did it and how they came in, the newest first', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
    await inAcme(() => t.modules.card.edit(card.id, { title: 'Plan it' }))
    await inAcme(() => t.modules.card.move(card.id, { columnId: doing }), 'mcp')
    await inAcme(() => t.modules.card.assign(card.id, { assigneeId: 'bea' }))
    await inAcme(() => t.modules.card.unassign(card.id))
    await inAcme(() => t.modules.card.delete(card.id))
    await t.settled()

    const { items, total } = await activityOf(card.id)
    expect(total).toBe(6)
    expect(items.map(entry => [entry.kind, entry.actorId, entry.via])).toEqual([
      ['deleted', 'ana', 'web'],
      ['unassigned', 'ana', 'web'],
      ['assigned', 'ana', 'web'],
      ['moved', 'ana', 'mcp'],
      ['edited', 'ana', 'web'],
      ['created', 'ana', 'web'],
    ])
    expect(items.find(entry => entry.kind === 'moved')!.detail).toEqual({ fromColumnId: todo, toColumnId: doing })
    expect(items.find(entry => entry.kind === 'edited')!.detail).toMatchObject({ changed: 'title', title: 'Plan it' })
    expect(items.find(entry => entry.kind === 'assigned')!.detail).toEqual({ assigneeId: 'bea', previousAssigneeId: null })

    // Page after page, by the cursor.
    const first = await activityOf(card.id, 4)
    const rest = await inAcme(() => t.modules.activity.listForCard(card.id, { size: 4, cursor: first.items.at(-1)!.id }))
    expect([...first.items, ...rest.items].map(entry => entry.kind)).toEqual(items.map(entry => entry.kind))
    expect(rest.hasMore).toBe(false)
  })

  test('credits nobody for what boards does on its own, from a worker', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan', assigneeId: 'bea' }))
    await t.auth.revoke('acme', 'bea')
    await t.settled()

    const [latest] = (await activityOf(card.id)).items
    expect(latest).toMatchObject({ kind: 'unassigned', actorId: null, via: null, detail: { previousAssigneeId: 'bea' } })
  })

  test('records each event once, however many times its job runs', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
    await t.settled()
    const told = { ...card, by: 'ana', via: 'web' as const }
    const event = { id: Bun.randomUUIDv7(), name: 'card.created', occurredAt: new Date().toISOString() }

    await t.modules.activity.recordCreated(told, event)
    await t.modules.activity.recordCreated(told, event)

    expect((await activityOf(card.id)).total).toBe(2)
  })

  test('records nothing of a workspace auth deleted, for an event whose job runs late', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
    await t.settled()
    await t.auth.deleteWorkspace('acme')
    await t.settled()

    // A job of the card's, run after the workspace's log was purged.
    const event = { id: Bun.randomUUIDv7(), name: 'card.edited', occurredAt: new Date().toISOString() }
    await t.modules.activity.recordEdited({ dto: card, changes: { title: 'Plan it' }, previous: { title: 'Plan' }, by: 'ana', via: 'web' }, event)

    const { db } = t.boards.base as BoardsBase
    expect(await db.selectFrom('activity').select('id').where('workspaceId', '=', 'acme').execute()).toEqual([])
  })

  test('shows a workspace\'s activity only in it', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
    await t.settled()

    expect((await t.as('carl', 'globex', () => t.modules.activity.listForCard(card.id, { size: 20 }))).total).toBe(0)
  })

  test('writes a line as a card moves, at once, with no job to wait for', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
    await inAcme(() => t.modules.card.move(card.id, { columnId: doing }), 'mcp')

    // In memory, right after the commit: no job, nothing to wait for.
    expect(t.lines).toEqual([`[boards] #${card.number} "Plan" moved from column ${todo} to ${doing} by ana (mcp)`])
  })
})
