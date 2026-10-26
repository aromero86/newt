import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'
import { MAX_CARDS, type CardCreateDTO } from './card.schema'

describe('card', () => {
  let t: TestBoards
  let boardId: string
  let todo: string
  let doing: string
  let done: string

  beforeEach(async () => {
    t = await openTestBoards()
    t.auth.join('acme', 'ana')
    t.auth.join('acme', 'bea')
    t.auth.join('globex', 'carl')
    boardId = (await inAcme(() => t.modules.board.create({ name: 'Roadmap' }))).id
    ;[todo, doing, done] = await Promise.all(['To do', 'Doing', 'Done'].map(name => inAcme(() => t.modules.column.add(boardId, { name })))).then(columns => columns.map(column => column.id))
  })

  afterEach(() => t.close())

  const inAcme = <T>(fn: () => Promise<T>) => t.as('ana', 'acme', fn)
  const create = (title: string, input: Partial<CardCreateDTO> = {}) => inAcme(() => t.modules.card.create(boardId, { columnId: todo, title, ...input }))
  /** Each column's cards from the top, as `#number@position`. */
  const columns = async () => {
    const cards = await inAcme(() => t.modules.card.listInBoard(boardId))
    const of = (columnId: string) => cards.filter(card => card.columnId === columnId).map(card => `#${card.number}@${card.position}`)
    return { todo: of(todo), doing: of(doing), done: of(done) }
  }

  test('numbers a board\'s cards #1, #2… and puts each new one at the bottom of its column', async () => {
    await create('Plan')
    await create('Design', { columnId: doing })
    await create('Build')

    expect(await columns()).toEqual({ todo: ['#1@0', '#3@1'], doing: ['#2@0'], done: [] })
    expect((await inAcme(() => t.modules.card.getByNumber(boardId, 2))).title).toBe('Design')
  })

  test('gives distinct numbers and places to cards created at once', async () => {
    const created = await Promise.all(Array.from({ length: 20 }, (_, i) => create(`Task ${i}`)))

    const sorted = (values: number[]) => values.toSorted((a, b) => a - b)
    expect(sorted(created.map(card => card.number))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(sorted(created.map(card => card.position))).toEqual(Array.from({ length: 20 }, (_, i) => i))
  })

  test('holds up to MAX_CARDS cards in a board, however many are created at once', async () => {
    await Promise.all(Array.from({ length: MAX_CARDS - 3 }, (_, i) => create(`Task ${i}`)))

    const created = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => create(`More ${i}`)))

    expect(created.filter(each => each.status === 'fulfilled')).toHaveLength(3)
    for (const each of created.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'card.too_many' })
    expect(await inAcme(() => t.modules.card.listInBoard(boardId))).toHaveLength(MAX_CARDS)
  })

  test('creates a card only in a column of its board', async () => {
    const other = await inAcme(() => t.modules.board.create({ name: 'Other' }))
    const elsewhere = await inAcme(() => t.modules.column.add(other.id, { name: 'To do' }))

    await expect(create('Lost', { columnId: elsewhere.id })).rejects.toMatchObject({ code: 'card.column_not_in_board' })
  })

  test('edits a card\'s title and description', async () => {
    const plan = await create('Plan')

    const edited = await inAcme(() => t.modules.card.edit(plan.id, { title: ' Plan the launch ', description: 'Dates, people' }))

    expect(edited).toMatchObject({ title: 'Plan the launch', description: 'Dates, people', number: 1 })
  })

  test('assigns a card only to a member of its workspace', async () => {
    const plan = await create('Plan')

    await expect(inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'carl' }))).rejects.toMatchObject({ code: 'card.assignee_not_member' })
    await expect(create('Design', { assigneeId: 'carl' })).rejects.toMatchObject({ code: 'card.assignee_not_member' })

    expect((await inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))).assigneeId).toBe('bea')
    expect((await inAcme(() => t.modules.card.unassign(plan.id))).assigneeId).toBeNull()
  })
})
