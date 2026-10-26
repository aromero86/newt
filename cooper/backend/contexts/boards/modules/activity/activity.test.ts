import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
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

  test('writes a line as a card moves, at once, with no job to wait for', async () => {
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo, title: 'Plan' }))
    await inAcme(() => t.modules.card.move(card.id, { columnId: doing }), 'mcp')

    // In memory, right after the commit: no job, nothing to wait for.
    expect(t.lines).toEqual([`[boards] #${card.number} "Plan" moved from column ${todo} to ${doing} by ana (mcp)`])
  })
})
