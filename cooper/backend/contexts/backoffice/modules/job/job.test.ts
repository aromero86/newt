import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { UserDTO } from '../../../auth/modules/user/user.schema'
import { openTestBackoffice, type TestBackoffice } from '../../testing/open-test-backoffice'

describe('job', () => {
  let t: TestBackoffice
  let sam: UserDTO

  beforeEach(async () => {
    t = await openTestBackoffice()
    sam = await t.staffMember('Sam')
  })

  afterEach(() => t.close())

  test('a job of boards that dies is listed with its last error, retried, and then done', async () => {
    const tenant = await t.as(sam, () => t.auth.modules.tenant.create({ name: 'Acme' }))
    await t.settled()
    // A reaction to boards' cards that fails while the "mail server" is down, at its only attempt.
    // It is the test's own, of no module: its queue names none.
    let down = true
    t.boards.modules.card.events.created.subscribe(() => {
      if (down) throw new Error('the mail server is down')
    // eslint-disable-next-line newt/queue-name
    }, { strategy: 'handler', queue: 'test.tellSomeone.on.card.created', attempts: 1 })
    await t.board(sam, tenant.id, 'Roadmap', ['One'])
    await t.settled()

    const dead = await t.as(sam, () => t.modules.job.dead('boards', { size: 10 }))
    expect(dead.items).toEqual([expect.objectContaining({
      context: 'boards',
      queue: 'test.tellSomeone.on.card.created',
      event: 'card.created',
      attempts: 1,
      lastError: expect.stringContaining('the mail server is down'),
    })])
    expect((await t.as(sam, () => t.modules.job.dead('auth', { size: 10 }))).items).toEqual([])

    down = false
    await t.as(sam, () => t.modules.job.retry('boards', dead.items[0]!.id))
    await t.settled()

    expect((await t.as(sam, () => t.modules.job.dead('boards', { size: 10 }))).total).toBe(0)
    const jobs = await t.boards.base.store.outbox.list()
    expect(jobs.find(job => job.id === dead.items[0]!.id)?.status).toBe('done')
    // Done is done: it is not run again.
    await expect(t.as(sam, () => t.modules.job.retry('boards', dead.items[0]!.id))).rejects.toMatchObject({ code: 'outbox.job_not_dead', status: 409 })
  })

  test('a job that is not there, or a context that is not one, is refused', async () => {
    await expect(t.as(sam, () => t.modules.job.retry('auth', '0190a0a0-0000-7000-8000-000000000000'))).rejects.toMatchObject({ code: 'outbox.job_not_found', status: 404 })
    await expect(t.as(sam, () => t.modules.job.dead('nowhere' as 'auth', { size: 10 }))).rejects.toThrow()
  })
})
