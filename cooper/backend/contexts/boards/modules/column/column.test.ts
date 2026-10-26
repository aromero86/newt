import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'
import { MAX_COLUMNS } from './column.schema'

describe('column', () => {
  let t: TestBoards
  let boardId: string

  beforeEach(async () => {
    t = await openTestBoards()
    t.auth.join('acme', 'ana')
    boardId = (await inAcme(() => t.modules.board.create({ name: 'Roadmap' }))).id
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>) => t.as('ana', 'acme', fn)
  const add = (name: string) => inAcme(() => t.modules.column.add(boardId, { name }))
  const names = async () => (await inAcme(() => t.modules.column.list(boardId))).map(column => `${column.position}:${column.name}`)

  test('adds columns at the end of the board, up to ten', async () => {
    for (let i = 1; i <= MAX_COLUMNS; i++) await add(`Step ${i}`)

    await expect(add('One more')).rejects.toMatchObject({ code: 'column.too_many' })
    expect(await names()).toEqual(Array.from({ length: MAX_COLUMNS }, (_, i) => `${i}:Step ${i + 1}`))
  })

  test('lets in only the columns that fit, when many are added at once', async () => {
    for (let i = 1; i <= 5; i++) await add(`Step ${i}`)

    const added = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => add(`More ${i}`)))

    expect(added.filter(each => each.status === 'fulfilled')).toHaveLength(5)
    for (const each of added.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'column.too_many' })
    expect((await names()).map(name => Number(name.split(':')[0]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  test('moves a column, and the others take the places left', async () => {
    const [, , done] = [await add('To do'), await add('Doing'), await add('Done')]

    await inAcme(() => t.modules.column.move(done.id, { position: 0 }))
    expect(await names()).toEqual(['0:Done', '1:To do', '2:Doing'])

    await inAcme(() => t.modules.column.move(done.id, { position: 99 }))
    expect(await names()).toEqual(['0:To do', '1:Doing', '2:Done'])
  })

  test('gives each of two moves at once its turn, and leaves no gap', async () => {
    const [todo, doing, done] = [await add('To do'), await add('Doing'), await add('Done')]

    await Promise.all([
      inAcme(() => t.modules.column.move(done.id, { position: 0 })),
      inAcme(() => t.modules.column.move(todo.id, { position: 2 })),
    ])

    const order = await names()
    expect(order.map(name => name.split(':')[0])).toEqual(['0', '1', '2'])
    expect(order.map(name => name.split(':')[1]).sort()).toEqual([todo.name, doing.name, done.name].sort())
  })

  test('renames a column', async () => {
    const todo = await add('To do')
    expect((await inAcme(() => t.modules.column.rename(todo.id, { name: ' Backlog ' }))).name).toBe('Backlog')
  })

  test('removes a column only when no card is in it, and the others move left', async () => {
    const [todo, doing] = [await add('To do'), await add('Doing'), await add('Done')]
    const card = await inAcme(() => t.modules.card.create(boardId, { columnId: todo.id, title: 'Write the plan' }))

    await expect(inAcme(() => t.modules.card.removeColumn(todo.id))).rejects.toMatchObject({ code: 'card.column_not_empty' })

    await inAcme(() => t.modules.card.move(card.id, { columnId: doing.id }))
    await inAcme(() => t.modules.card.removeColumn(todo.id))
    expect(await names()).toEqual(['0:Doing', '1:Done'])
  })

  test('keeps a board\'s last column, where its cards go when another one is removed', async () => {
    const [todo, doing] = [await add('To do'), await add('Doing')]

    // Its last two removed at once: one of them is.
    const removed = await Promise.allSettled([todo, doing].map(column => inAcme(() => t.modules.card.removeColumn(column.id))))

    expect(removed.filter(each => each.status === 'fulfilled')).toHaveLength(1)
    expect(removed.find(each => each.status === 'rejected')?.reason).toMatchObject({ code: 'column.last' })
    const [last] = await inAcme(() => t.modules.column.list(boardId))
    expect(await names()).toEqual([`0:${last!.name}`])
    await expect(inAcme(() => t.modules.card.removeColumn(last!.id))).rejects.toMatchObject({ code: 'column.last' })
  })

  test('adds columns only to a board of the workspace', async () => {
    await expect(inAcme(() => t.modules.column.add('nope', { name: 'To do' }))).rejects.toMatchObject({ code: 'board.not_found' })
  })
})
