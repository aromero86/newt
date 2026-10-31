import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBackoffice, type TestBackoffice } from '../../testing/open-test-backoffice'

describe('staff', () => {
  let t: TestBackoffice

  beforeEach(async () => {
    t = await openTestBackoffice()
  })

  afterEach(() => t.close())

  test('lets the staff in, and refuses anyone else', async () => {
    const sam = await t.staffMember('Sam')
    const ana = await t.signUp('Ana')

    expect(await t.as(sam, () => t.modules.staff.me())).toMatchObject({ id: sam.id, email: 'sam@cooper.test' })
    await expect(t.as(ana, () => t.modules.staff.enter())).rejects.toMatchObject({ code: 'staff.not_staff' })
    await expect(t.as(ana, () => t.modules.staff.me())).rejects.toMatchObject({ code: 'staff.not_staff' })
  })

  test('grants by email, lists the staff, and revokes, which counts at once', async () => {
    const sam = await t.staffMember('Sam')
    const ana = await t.signUp('Ana')

    const granted = await t.as(sam, () => t.modules.staff.grant({ email: ' ANA@cooper.test ' }))
    expect(granted).toMatchObject({ userId: ana.id, name: 'Ana', email: 'ana@cooper.test' })
    // Given twice, it is given once.
    expect(await t.as(sam, () => t.modules.staff.grant({ email: 'ana@cooper.test' }))).toEqual(granted)
    expect((await t.as(sam, () => t.modules.staff.list({ size: 10 }))).items.map(member => member.name)).toEqual(['Sam', 'Ana'])
    await t.as(ana, () => t.modules.staff.enter())

    await t.as(sam, () => t.modules.staff.revoke(ana.id))
    await expect(t.as(ana, () => t.modules.staff.enter())).rejects.toMatchObject({ code: 'staff.not_staff' })
    expect((await t.as(sam, () => t.modules.staff.list({ size: 10 }))).total).toBe(1)
  })

  test('never grants to an email without an account, nor lets anyone take their own access away', async () => {
    const sam = await t.staffMember('Sam')

    await expect(t.as(sam, () => t.modules.staff.grant({ email: 'nobody@cooper.test' }))).rejects.toMatchObject({ code: 'staff.account_not_found' })
    await expect(t.as(sam, () => t.modules.staff.grant({ email: 'not an email' }))).rejects.toThrow('Write a valid email')
    await expect(t.as(sam, () => t.modules.staff.revoke(sam.id))).rejects.toMatchObject({ code: 'staff.own_access_not_revocable' })
    await t.as(sam, () => t.modules.staff.enter())
  })

  test('two of the staff revoking each other at once leave one of them', async () => {
    const sam = await t.staffMember('Sam')
    const ana = await t.signUp('Ana')
    await t.as(sam, () => t.modules.staff.grant({ email: 'ana@cooper.test' }))

    const results = await Promise.allSettled([
      t.as(sam, () => t.modules.staff.revoke(ana.id)),
      t.as(ana, () => t.modules.staff.revoke(sam.id)),
    ])
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'access.last_staff_not_revocable' } })
    const left = await t.as(sam, () => t.modules.staff.list({ size: 10 })).catch(() => t.as(ana, () => t.modules.staff.list({ size: 10 })))
    expect(left.total).toBe(1)
  })

  test('only the staff grant: auth checks it again', async () => {
    const ana = await t.signUp('Ana')
    await t.signUp('Bob')

    await expect(t.as(ana, () => t.modules.staff.grant({ email: 'bob@cooper.test' }))).rejects.toMatchObject({ status: 403 })
  })
})
