import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'
import { WELCOME_BOARD } from './workspace.schema'

describe('workspace', () => {
  let t: TestBoards

  beforeEach(async () => {
    t = await openTestBoards()
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>) => t.as('ana', 'acme', fn)
  /** The welcome board of acme, as its screen shows it: each column with its cards' titles. */
  const welcome = async () => {
    const boards = await inAcme(() => t.modules.board.list({ size: 10 }))
    const view = await inAcme(() => t.modules.workspace.boardView(boards.items[0]!.id))
    return {
      boards: boards.items.map(board => String(board.name)),
      columns: view.columns.map(column => [column.name, view.cards.filter(card => card.columnId === column.id).map(card => card.title)]),
    }
  }

  test('gives a new workspace its welcome board, a moment after auth creates it', async () => {
    await t.auth.createWorkspace('acme', 'ana')
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)

    await t.settled()

    expect(await welcome()).toEqual({
      boards: ['Welcome'],
      columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
    })
  })

  test('prepares a workspace once, however many times its work runs, and finishes one left halfway', async () => {
    t.auth.join('acme', 'ana')
    // A first run that stopped halfway: the board and one column.
    const board = await inAcme(() => t.modules.board.create({ name: 'welcome' }))
    await inAcme(() => t.modules.column.add(board.id, { name: 'To do' }))

    await t.auth.createWorkspace('acme', 'ana')
    await t.settled()
    await t.auth.createWorkspace('acme', 'ana')
    await t.settled()

    expect(await welcome()).toEqual({
      boards: ['welcome'],
      columns: [['To do', [WELCOME_BOARD.card.title]], ['Doing', []], ['Done', []]],
    })
  })

  test('removes all a workspace has once auth deletes it, and nothing of any other', async () => {
    await t.auth.createWorkspace('acme', 'ana')
    await t.auth.createWorkspace('globex', 'bea')
    await t.settled()

    await t.auth.deleteWorkspace('acme')
    await t.settled()

    expect(await t.modules.board.listOf('acme', { size: 10 })).toMatchObject({ items: [], total: 0 })
    expect(await t.modules.card.countByWorkspace(['acme', 'globex'])).toEqual([{ workspaceId: 'acme', cards: 0 }, { workspaceId: 'globex', cards: 1 }])
    expect((await t.modules.board.listOf('globex', { size: 10 })).total).toBe(1)

    // Its work run again, as after a failure halfway: nothing left to remove, nothing fails.
    await t.auth.deleteWorkspace('acme')
    await t.settled()
    expect((await t.auth.jobs()).map(job => job.status)).toEqual(['done', 'done', 'done', 'done'])
    expect((await t.modules.board.listOf('globex', { size: 10 })).total).toBe(1)
  })

  test('leaves the cards of someone who left a workspace without an assignee', async () => {
    await t.auth.createWorkspace('acme', 'ana')
    t.auth.join('acme', 'bea')
    await t.settled()
    const { columns, cards } = await inAcme(async () => t.modules.workspace.boardView((await t.modules.board.list({ size: 1 })).items[0]!.id))
    const mine = await inAcme(() => t.modules.card.create(cards[0]!.boardId, { columnId: columns[1]!.id, title: 'Mine', assigneeId: 'ana' }))
    await inAcme(() => t.modules.card.assign(cards[0]!.id, { assigneeId: 'bea' }))

    await t.auth.revoke('acme', 'bea')
    await t.settled()

    expect((await inAcme(() => t.modules.card.get(cards[0]!.id))).assigneeId).toBeNull()
    expect((await inAcme(() => t.modules.card.get(mine.id))).assigneeId).toBe('ana')
  })

  test('takes a card left in a removed column to the first one, a moment later', async () => {
    await t.auth.createWorkspace('acme', 'ana')
    await t.settled()
    const { board, columns, cards } = await inAcme(async () => t.modules.workspace.boardView((await t.modules.board.list({ size: 1 })).items[0]!.id))
    const [todo, doing] = [columns[0]!, columns[1]!]
    await inAcme(() => t.modules.card.create(board.id, { columnId: doing.id, title: 'Already there' }))

    // As if a card were moved into it while it was being removed: the column goes with a card in it.
    await inAcme(() => t.modules.column.remove(todo.id))
    await t.settled()

    const view = await inAcme(() => t.modules.workspace.boardView(board.id))
    expect(view.columns.map(column => column.name)).toEqual(['Doing', 'Done'])
    expect(view.cards.map(card => [card.columnId, card.position, card.title])).toEqual([
      [doing.id, 0, 'Already there'],
      [doing.id, 1, cards[0]!.title],
    ])
  })
})
