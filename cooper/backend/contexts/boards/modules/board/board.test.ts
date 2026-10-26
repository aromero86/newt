import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'

describe('board', () => {
  let t: TestBoards

  beforeEach(async () => {
    t = await openTestBoards()
  })

  afterEach(() => t.close())

  const create = (name: string) => t.modules.board.create({ name })

  test('lists boards by pages, the newest first', async () => {
    for (const name of ['Roadmap', 'Bugs', 'Launch']) await create(name)

    const first = await t.modules.board.list({ size: 2 })
    expect(first.items.map(board => String(board.name))).toEqual(['Launch', 'Bugs'])
    expect(first).toMatchObject({ hasMore: true, total: 3 })

    const next = await t.modules.board.list({ size: 2, cursor: first.items[1]!.id })
    expect(next.items.map(board => String(board.name))).toEqual(['Roadmap'])
    expect(next.hasMore).toBe(false)
  })

  test('keeps a name as a board\'s name: trimmed, one space between words, 1 to 60 characters', async () => {
    expect(String((await create('  Road   map ')).name)).toBe('Road map')
    await expect(create('   ')).rejects.toMatchObject({ code: 'board.invalid_name' })
    await expect(create('x'.repeat(61))).rejects.toMatchObject({ code: 'board.invalid_name' })
  })

  test('renames a board, describes it, or both', async () => {
    const bugs = await create('Bugs')

    expect(await t.modules.board.update(bugs.id, { description: 'What is broken' })).toMatchObject({ name: 'Bugs', description: 'What is broken' })
    expect(String((await t.modules.board.update(bugs.id, { name: ' Known  bugs ' })).name)).toBe('Known bugs')
    expect(String((await t.modules.board.get(bugs.id)).name)).toBe('Known bugs')
  })

  test('archives a board: out of every list', async () => {
    const roadmap = await create('Roadmap')

    await t.modules.board.archive(roadmap.id)

    await expect(t.modules.board.get(roadmap.id)).rejects.toMatchObject({ code: 'board.not_found' })
    expect((await t.modules.board.list({ size: 10 })).total).toBe(0)
  })
})
