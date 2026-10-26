import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'
import type { CardCreateDTO, CardDTO } from './card.schema'

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

  test('never gives a deleted card\'s number again, and closes the gap it leaves', async () => {
    const [, second] = [await create('Plan'), await create('Design'), await create('Build')]

    await inAcme(() => t.modules.card.delete(second.id))
    await create('Ship')

    expect(await columns()).toEqual({ todo: ['#1@0', '#3@1', '#4@2'], doing: [], done: [] })
  })

  test('moves a card to another column, or within its own, and the others make room', async () => {
    const [plan, design, build] = [await create('Plan'), await create('Design'), await create('Build')]

    await inAcme(() => t.modules.card.move(design.id, { columnId: doing }))
    await inAcme(() => t.modules.card.move(build.id, { columnId: doing, position: 0 }))
    await inAcme(() => t.modules.card.move(plan.id, { columnId: doing, position: 1 }))
    expect(await columns()).toEqual({ todo: [], doing: ['#3@0', '#1@1', '#2@2'], done: [] })

    await inAcme(() => t.modules.card.move(design.id, { columnId: doing, position: 0 }))
    expect(await columns()).toEqual({ todo: [], doing: ['#2@0', '#3@1', '#1@2'], done: [] })
  })

  test('gives each of two moves of the same card at once its turn, and leaves no gap', async () => {
    const [plan] = [await create('Plan'), await create('Design'), await create('Build')]

    const moved = await Promise.all([
      inAcme(() => t.modules.card.move(plan.id, { columnId: doing })),
      inAcme(() => t.modules.card.move(plan.id, { columnId: done })),
    ])

    expect(moved.map(card => card.columnId).sort()).toEqual([doing, done].sort())
    const after = await columns()
    expect(after.todo).toEqual(['#2@0', '#3@1'])
    expect([...after.doing, ...after.done]).toEqual(['#1@0'])
  })

  test('moves a card only to a column of its board', async () => {
    const plan = await create('Plan')
    const other = await inAcme(() => t.modules.board.create({ name: 'Other' }))
    const elsewhere = await inAcme(() => t.modules.column.add(other.id, { name: 'To do' }))

    await expect(inAcme(() => t.modules.card.move(plan.id, { columnId: elsewhere.id }))).rejects.toMatchObject({ code: 'card.column_not_in_board' })
    await expect(create('Lost', { columnId: elsewhere.id })).rejects.toMatchObject({ code: 'card.column_not_in_board' })
  })

  test('edits a card\'s title and description', async () => {
    const plan = await create('Plan')

    const edited = await inAcme(() => t.modules.card.edit(plan.id, { title: ' Plan the launch ', description: 'Dates, people' }))

    expect(edited).toMatchObject({ title: 'Plan the launch', description: 'Dates, people', number: 1 })
  })

  test('assigns a card only to a member of its workspace, and tells them by email once saved', async () => {
    const plan = await create('Plan')

    await expect(inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'carl' }))).rejects.toMatchObject({ code: 'card.assignee_not_member' })

    await inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
    expect(t.mails).toEqual([])
    await t.settled()
    expect(t.mails.map(mail => [mail.to, mail.subject])).toEqual([['bea@cooper.test', '#1 Plan is yours']])
    expect(t.mails[0]!.text).toContain(`/workspaces/acme/boards/${boardId}?card=1`)

    // Assigning it again to the same one changes nothing, and tells nothing.
    await inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
    await t.settled()
    expect(t.mails).toHaveLength(1)
  })

  test('tells the assignee of a card created for them, and nobody of one assigned and unassigned at once', async () => {
    await create('Plan', { assigneeId: 'bea' })
    const design = await create('Design')
    await inAcme(() => t.modules.card.assign(design.id, { assigneeId: 'ana' }))
    await inAcme(() => t.modules.card.unassign(design.id))

    await t.settled()

    expect(t.mails.map(mail => mail.subject)).toEqual(['#1 Plan is yours'])
  })

  test('searches the workspace\'s cards by text, column and assignee, by pages', async () => {
    await create('Write the plan', { description: 'Dates and PEOPLE' })
    await create('Design the logo', { columnId: doing, assigneeId: 'bea' })
    await create('Plan the party', { columnId: doing })
    await create('100% done_ish')
    const search = (input: object, size = 10) => inAcme(() => t.modules.card.search(input, { size }))
    const titles = (page: { items: CardDTO[] }) => page.items.map(card => card.title)

    expect(titles(await search({ text: 'PLAN' }))).toEqual(['Write the plan', 'Plan the party'])
    expect(titles(await search({ text: 'people' }))).toEqual(['Write the plan'])
    expect(titles(await search({ text: '%' }))).toEqual(['100% done_ish'])
    expect(titles(await search({ text: 'plan', filter: { field: 'column', op: 'eq', value: doing } }))).toEqual(['Plan the party'])
    expect(titles(await search({ filter: { or: [{ field: 'assignee', op: 'eq', value: 'bea' }, { field: 'number', op: 'eq', value: 4 }] } }))).toEqual(['Design the logo', '100% done_ish'])

    const first = await search({}, 3)
    expect(first).toMatchObject({ hasMore: true, total: 4 })
    await expect(search({ filter: { field: 'title', op: 'eq', value: 'x' } })).rejects.toThrow()
  })

  test('counts cards by workspace and by board, for the backoffice', async () => {
    await create('Plan')
    await create('Design')
    const other = await inAcme(() => t.modules.board.create({ name: 'Other' }))
    const column = await inAcme(() => t.modules.column.add(other.id, { name: 'To do' }))
    await inAcme(() => t.modules.card.create(other.id, { columnId: column.id, title: 'Elsewhere' }))

    expect(await t.modules.card.countByWorkspace(['acme', 'globex'])).toEqual([{ workspaceId: 'acme', cards: 3 }, { workspaceId: 'globex', cards: 0 }])
    expect(await t.modules.card.countByBoard('acme')).toEqual([{ boardId, cards: 2 }, { boardId: other.id, cards: 1 }].sort((a, b) => a.boardId.localeCompare(b.boardId)))
  })
})
