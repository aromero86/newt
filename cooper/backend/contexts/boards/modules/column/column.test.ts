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

  test('renames a column', async () => {
    const todo = await add('To do')
    expect((await inAcme(() => t.modules.column.rename(todo.id, { name: ' Backlog ' }))).name).toBe('Backlog')
  })

  test('adds columns only to a board of the workspace', async () => {
    await expect(inAcme(() => t.modules.column.add('nope', { name: 'To do' }))).rejects.toMatchObject({ code: 'board.not_found' })
  })
})
