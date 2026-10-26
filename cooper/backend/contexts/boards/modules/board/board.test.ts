import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'

describe('board', () => {
  let t: TestBoards

  beforeEach(async () => {
    t = await openTestBoards()
    t.auth.join('acme', 'ana')
    t.auth.join('globex', 'bea')
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>) => t.as('ana', 'acme', fn)
  const create = (name: string) => inAcme(() => t.modules.board.create({ name }))

  test('lists a workspace\'s boards by pages, the newest first', async () => {
    for (const name of ['Roadmap', 'Bugs', 'Launch']) await create(name)

    const first = await inAcme(() => t.modules.board.list({ size: 2 }))
    expect(first.items.map(board => String(board.name))).toEqual(['Launch', 'Bugs'])
    expect(first).toMatchObject({ hasMore: true, total: 3 })

    const next = await inAcme(() => t.modules.board.list({ size: 2, cursor: first.items[1]!.id }))
    expect(next.items.map(board => String(board.name))).toEqual(['Roadmap'])
    expect(next.hasMore).toBe(false)
  })

  test('keeps a name as a board\'s name: trimmed, one space between words, 1 to 60 characters', async () => {
    expect(String((await create('  Road   map ')).name)).toBe('Road map')
    await expect(create('   ')).rejects.toMatchObject({ code: 'board.invalid_name' })
    await expect(create('x'.repeat(61))).rejects.toMatchObject({ code: 'board.invalid_name' })
  })

  test('gives a name to one board of a workspace, whatever its case; another workspace has its own', async () => {
    await create('Roadmap')

    await expect(create('ROADMAP')).rejects.toMatchObject({ code: 'board.name_taken' })
    expect((await t.as('bea', 'globex', () => t.modules.board.create({ name: 'roadmap' }))).workspaceId).toBe('globex')

    const bugs = await create('Bugs')
    await expect(inAcme(() => t.modules.board.update(bugs.id, { name: 'roadMAP' }))).rejects.toMatchObject({ code: 'board.name_taken' })
    expect((await inAcme(() => t.modules.board.update(bugs.id, { description: 'What is broken' }))).description).toBe('What is broken')
  })

  test('gives a name to one of several boards created with it at once, whatever its case', async () => {
    const created = await Promise.allSettled(['Roadmap', 'ROADMAP', 'roadmap', 'RoadMap'].map(create))

    expect(created.filter(each => each.status === 'fulfilled')).toHaveLength(1)
    for (const each of created.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'board.name_taken' })
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(1)
  })

  test('folds only A to Z when comparing names: letters beyond them are told apart by their case', async () => {
    await Promise.all([create('Ärger'), create('ärger')])

    await expect(create('äRGER')).rejects.toMatchObject({ code: 'board.name_taken' })
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(2)
  })

  test('archives a board: out of every list, and its name free again', async () => {
    const roadmap = await create('Roadmap')

    await inAcme(() => t.modules.board.archive(roadmap.id))

    await expect(inAcme(() => t.modules.board.get(roadmap.id))).rejects.toMatchObject({ code: 'board.not_found' })
    expect((await inAcme(() => t.modules.board.list({ size: 10 }))).total).toBe(0)
    expect((await create('Roadmap')).id).not.toBe(roadmap.id)
  })

  test('shows a workspace\'s boards to its members only, and nobody else\'s', async () => {
    const roadmap = await create('Roadmap')

    await expect(t.as('bea', 'globex', () => t.modules.board.get(roadmap.id))).rejects.toMatchObject({ code: 'board.not_found' })
    await expect(t.as('bea', 'acme', () => t.modules.board.list({ size: 10 }))).rejects.toMatchObject({ code: 'workspace.not_found' })
    expect((await t.modules.board.listOf('acme', { size: 10 })).items.map(board => board.id)).toEqual([roadmap.id])
  })
})
