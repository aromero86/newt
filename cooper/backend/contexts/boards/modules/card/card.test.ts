import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { openTestBoards, type TestBoards } from '../../testing/open-test-boards'
import { MAX_CARDS, type CardCreateDTO, type CardDTO } from './card.schema'

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
  /** Where a card is now, and its assignee. */
  const card = (id: string) => inAcme(() => t.modules.card.get(id))
  /** The board's first column, where the cards of a removed one go. */
  const firstColumn = async () => (await inAcme(() => t.modules.column.list(boardId)))[0]!.id
  /**
   * The next call of a use case waits until `release`: before it runs, or after it
   * read what it answers. A use case paused between its check and its save, or
   * another one's, for something else to happen in between.
   */
  function hold<M extends object>(module: M, useCase: keyof M & string, at: 'before' | 'after') {
    const original = (module[useCase] as (...args: unknown[]) => Promise<unknown>).bind(module)
    const { promise: reached, resolve: reach } = Promise.withResolvers<void>()
    const { promise: released, resolve: release } = Promise.withResolvers<void>()
    spyOn(module, useCase as never).mockImplementationOnce((async (...args: unknown[]) => {
      if (at === 'before') { reach(); await released }
      const answer = await original(...args)
      if (at === 'after') { reach(); await released }
      return answer
    }) as never)
    return { reached, release }
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

    // The last one deleted, its number stays taken: five more at once get #21 to #25.
    await inAcme(() => t.modules.card.delete(created.find(card => card.number === 20)!.id))
    const more = await Promise.all(Array.from({ length: 5 }, (_, i) => create(`More ${i}`)))
    expect(sorted(more.map(card => card.number))).toEqual([21, 22, 23, 24, 25])
  })

  test('never gives a deleted card\'s number again, and closes the gap it leaves', async () => {
    const [, second] = [await create('Plan'), await create('Design'), await create('Build')]

    await inAcme(() => t.modules.card.delete(second.id))
    await create('Ship')

    expect(await columns()).toEqual({ todo: ['#1@0', '#3@1', '#4@2'], doing: [], done: [] })
  })

  test('never gives the number of the last card again, once it is deleted', async () => {
    const [, , build] = [await create('Plan'), await create('Design'), await create('Build')]

    await inAcme(() => t.modules.card.delete(build.id))
    await create('Ship')

    expect(await columns()).toEqual({ todo: ['#1@0', '#2@1', '#4@2'], doing: [], done: [] })
  })

  test('holds up to MAX_CARDS cards in a board, however many are created at once', async () => {
    await Promise.all(Array.from({ length: MAX_CARDS - 3 }, (_, i) => create(`Task ${i}`)))

    const created = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => create(`More ${i}`)))

    expect(created.filter(each => each.status === 'fulfilled')).toHaveLength(3)
    for (const each of created.filter(each => each.status === 'rejected')) expect(each.reason).toMatchObject({ code: 'card.too_many' })
    expect(await inAcme(() => t.modules.card.listInBoard(boardId))).toHaveLength(MAX_CARDS)
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

  test('takes a card moved into a column being removed to the first column, when the column\'s worker runs first', async () => {
    const plan = await create('Plan')
    // The move checked the column is there, and waits to save.
    const checked = hold(t.modules.column, 'list', 'after')
    const moving = inAcme(() => t.modules.card.move(plan.id, { columnId: done }))
    await checked.reached

    await inAcme(() => t.modules.card.removeColumn(done))
    // Its worker finds no card in it yet.
    await t.settled()
    checked.release()
    await moving
    expect((await card(plan.id)).columnId).toBe(done)

    // The card's worker, after its save, finds its column gone.
    await t.settled()
    expect((await card(plan.id)).columnId).toBe(await firstColumn())
  })

  test('takes a card moved into a column being removed to the first column, when the card\'s worker runs first', async () => {
    const plan = await create('Plan')
    // The removal found the column empty, and waits to save.
    const counted = hold(t.modules.column, 'remove', 'before')
    const removing = inAcme(() => t.modules.card.removeColumn(done))
    await counted.reached

    await inAcme(() => t.modules.card.move(plan.id, { columnId: done }))
    // The card's worker finds its column still there.
    await t.settled()
    counted.release()
    await removing
    expect((await card(plan.id)).columnId).toBe(done)

    // The column's worker, after its save, finds the card in it.
    await t.settled()
    expect((await card(plan.id)).columnId).toBe(await firstColumn())
  })

  test('takes a card created in a column being removed to the first column', async () => {
    const checked = hold(t.modules.column, 'list', 'after')
    const creating = create('Plan', { columnId: done })
    await checked.reached
    await inAcme(() => t.modules.card.removeColumn(done))
    await t.settled()
    checked.release()
    const plan = await creating

    await t.settled()

    expect((await card(plan.id)).columnId).toBe(await firstColumn())
  })

  test('leaves unassigned a card given to someone as they leave the workspace, when auth\'s worker runs first', async () => {
    const plan = await create('Plan')
    // The assignment checked bea belongs, and waits to save.
    const checked = hold(t.modules.member, 'isMember', 'after')
    const assigning = inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
    await checked.reached

    await t.auth.revoke('acme', 'bea')
    // auth's worker finds no card of hers yet.
    await t.settled()
    checked.release()
    await assigning
    expect((await card(plan.id)).assigneeId).toBe('bea')

    // The card's worker, after its save, finds she has left.
    await t.settled()
    expect((await card(plan.id)).assigneeId).toBeNull()
    expect(t.mails).toEqual([])
  })

  test('leaves unassigned a card given to someone as they leave the workspace, when the card\'s worker runs first', async () => {
    const plan = await create('Plan')
    const checked = hold(t.modules.member, 'isMember', 'after')
    const assigning = inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
    await checked.reached
    // She has left, and auth's worker has not run yet.
    await t.auth.revoke('acme', 'bea')
    checked.release()
    await assigning

    // The card's worker, after its save, finds she has left; auth's, after, finds nothing more.
    await t.boards.base.jobs.idle()
    expect((await card(plan.id)).assigneeId).toBeNull()
    await t.settled()
    expect((await card(plan.id)).assigneeId).toBeNull()
    expect(t.mails).toEqual([])
  })

  test('leaves unassigned a card created for someone as they leave the workspace', async () => {
    const checked = hold(t.modules.member, 'isMember', 'after')
    const creating = create('Plan', { assigneeId: 'bea' })
    await checked.reached
    await t.auth.revoke('acme', 'bea')
    await t.settled()
    checked.release()
    const plan = await creating

    await t.settled()

    expect((await card(plan.id)).assigneeId).toBeNull()
  })

  test('keeps the cards of someone let in again before auth\'s worker ran', async () => {
    const plan = await create('Plan', { assigneeId: 'bea' })
    await t.auth.revoke('acme', 'bea')
    t.auth.join('acme', 'bea')

    await t.settled()

    expect((await card(plan.id)).assigneeId).toBe('bea')
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
    // The link opens the card on its board, in boards' UI.
    expect(t.mails[0]!.text).toBe(['Hi bea,', '', 'Card #1, "Plan", is assigned to you.', '', new URL(`/w/acme/boards/${boardId}?card=${plan.id}`, t.boards.config.publicUrl).toString()].join('\n'))

    // Assigning it again to the same one changes nothing, and tells nothing.
    await inAcme(() => t.modules.card.assign(plan.id, { assigneeId: 'bea' }))
    await t.settled()
    expect(t.mails).toHaveLength(1)
  })

  test('tells the assignee once, however many times the job of an assignment runs', async () => {
    const { id } = await create('Plan')
    const plan = await inAcme(() => t.modules.card.assign(id, { assigneeId: 'bea' }))

    // The job of one event, run twice (its first run failed after sending), and one of another event.
    await t.modules.card.notifyAssignee(plan, 'ana', 'event-1')
    await t.modules.card.notifyAssignee(plan, 'ana', 'event-1')
    await t.modules.card.notifyAssignee(plan, 'ana', 'event-2')

    expect(t.mails.map(mail => [mail.subject, mail.key])).toEqual([['#1 Plan is yours', 'card.notifyAssignee:event-1'], ['#1 Plan is yours', 'card.notifyAssignee:event-2']])
  })

  test('tells the assignee of a card created for them, and nobody of one assigned and unassigned at once', async () => {
    await create('Plan', { assigneeId: 'bea' })
    const design = await create('Design')
    // To someone else than who gives it, who would hear of it but for the card read again.
    await inAcme(() => t.modules.card.assign(design.id, { assigneeId: 'bea' }))
    await inAcme(() => t.modules.card.unassign(design.id))

    await t.settled()

    expect(t.mails.map(mail => mail.subject)).toEqual(['#1 Plan is yours'])
  })

  test('tells nobody of a card they created for themselves, or took', async () => {
    await create('Plan', { assigneeId: 'ana' })
    const design = await create('Design')
    await inAcme(() => t.modules.card.assign(design.id, { assigneeId: 'ana' }))
    // Given to someone else, they hear of it.
    await inAcme(() => t.modules.card.assign(design.id, { assigneeId: 'bea' }))

    await t.settled()

    expect(t.mails.map(mail => [mail.to, mail.subject])).toEqual([['bea@cooper.test', '#2 Design is yours']])
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

  test('finds a card by its title whatever the case of A to Z, and other letters as they are written', async () => {
    await create('Ärger im Büro')

    const found = await inAcme(() => t.modules.card.search({ text: 'ÄRGER IM' }, { size: 10 }))

    expect(found.items.map(card => card.title)).toEqual(['Ärger im Büro'])
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

  test('a reaction that keeps failing dies after its attempts, is listed, and runs once retried', async () => {
    // A reaction of the test's own, as if the mail server were down, at its only attempt.
    let down = true
    t.modules.card.events.created.subscribe(() => {
      if (down) throw new Error('the mail server is down')
    // eslint-disable-next-line newt/queue-name
    }, { strategy: 'handler', queue: 'test.tellSomeone.on.card.created', attempts: 1 })
    await create('Plan')
    await t.settled()

    const dead = await t.modules.outbox.dead({ size: 10 })
    expect(dead.items).toEqual([expect.objectContaining({ queue: 'test.tellSomeone.on.card.created', event: 'card.created', attempts: 1, lastError: expect.stringContaining('the mail server is down') })])

    down = false
    await t.modules.outbox.retry(dead.items[0]!.id)
    await t.settled()

    expect((await t.modules.outbox.dead({ size: 10 })).total).toBe(0)
    // Done is done: it is not run again.
    await expect(t.modules.outbox.retry(dead.items[0]!.id)).rejects.toMatchObject({ code: 'outbox.job_not_dead', status: 409 })
  })
})
