import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { openTestBackoffice, type TestBackoffice } from '../../testing/open-test-backoffice'

describe('user', () => {
  let t: TestBackoffice

  beforeEach(async () => {
    t = await openTestBackoffice()
  })

  afterEach(() => t.close())

  test('lists the accounts, the newest first; by email or name too', async () => {
    const sam = await t.staffMember('Sam')
    await t.signUp('Ana')
    await t.signUp('Bob')

    const all = await t.as(sam, () => t.modules.user.list({}, { size: 10 }))
    expect(all.items.map(user => user.name)).toEqual(['Bob', 'Ana', 'Sam'])
    expect((await t.as(sam, () => t.modules.user.list({ text: 'ANA@cooper.test' }, { size: 10 }))).items.map(user => user.name)).toEqual(['Ana'])
    expect((await t.as(sam, () => t.modules.user.list({ text: 'bob' }, { size: 10 }))).items.map(user => user.name)).toEqual(['Bob'])
  })

  test('shows an account with the workspaces it belongs to, and whether it is of the staff', async () => {
    const sam = await t.staffMember('Sam')
    const ana = await t.signUp('Ana')
    const acme = await t.as(ana, () => t.auth.modules.tenant.create({ name: 'Acme' }))
    const globex = await t.as(ana, () => t.auth.modules.tenant.create({ name: 'Globex' }))
    await t.settled()

    expect(await t.as(sam, () => t.modules.user.get(ana.id))).toMatchObject({ id: ana.id, name: 'Ana', staff: false, workspaces: 2 })
    expect(await t.as(sam, () => t.modules.user.get(sam.id))).toMatchObject({ staff: true, workspaces: 0 })

    const workspaces = await t.as(sam, () => t.modules.user.workspaces(ana.id, { size: 10 }))
    expect(workspaces.items.map(each => [each.workspaceId, each.name, each.role])).toEqual([[globex.id, 'Globex', 'admin'], [acme.id, 'Acme', 'admin']])
  })
})
