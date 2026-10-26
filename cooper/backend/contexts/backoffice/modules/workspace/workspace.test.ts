import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { UserDTO } from '../../../auth/modules/user/user.schema'
import { runInWorkspace } from '../../../boards/workspace-scope'
import { openTestBackoffice, type TestBackoffice } from '../../testing/open-test-backoffice'

describe('workspace', () => {
  let t: TestBackoffice
  let sam: UserDTO
  let ana: UserDTO
  let bob: UserDTO

  beforeEach(async () => {
    t = await openTestBackoffice()
    sam = await t.staffMember('Sam')
    ana = await t.signUp('Ana')
    bob = await t.signUp('Bob')
  })

  afterEach(() => t.close())

  /** Ana's workspace, with Bob in it. */
  async function acme() {
    const tenant = await t.as(ana, () => t.auth.modules.tenant.create({ name: 'Acme' }))
    await t.auth.modules.access.admit({ userId: bob.id, productId: 'cooper', tenantId: tenant.id, role: 'member' })
    await t.settled()
    return tenant
  }

  test('lists the workspaces, the newest first, with their admin and their cards; by name too', async () => {
    const first = await acme()
    const second = await t.as(bob, () => t.auth.modules.tenant.create({ name: 'Globex' }))
    await t.board(ana, first.id, 'Roadmap', ['One', 'Two'])
    await t.settled()
    const cards = await t.boards.modules.card.countByWorkspace([first.id, second.id])

    const all = await t.as(sam, () => t.modules.workspace.list({}, { size: 10 }))
    expect(all.items.map(each => [each.name, each.admin?.name, each.cards])).toEqual([
      ['Globex', 'Bob', cards[1]!.cards],
      ['Acme', 'Ana', cards[0]!.cards],
    ])
    expect(cards[0]!.cards).toBeGreaterThanOrEqual(2)

    const found = await t.as(sam, () => t.modules.workspace.list({ name: ' ACME ' }, { size: 10 }))
    expect(found.items.map(each => each.id)).toEqual([first.id])
  })

  test('puts a workspace\'s page together: its admin, members and boards with their cards', async () => {
    const tenant = await acme()
    const roadmap = await t.board(ana, tenant.id, 'Roadmap', ['One', 'Two', 'Three'])
    const empty = await t.board(ana, tenant.id, 'Empty', [])

    const detail = await t.as(sam, () => t.modules.workspace.get(tenant.id))
    expect(detail).toMatchObject({ id: tenant.id, name: 'Acme', admin: { id: ana.id, name: 'Ana' }, members: 2 })
    expect(detail.boards).toBeGreaterThanOrEqual(2)

    const members = await t.as(sam, () => t.modules.workspace.members(tenant.id, { size: 10 }))
    expect(members.items.map(member => [member.name, member.role])).toEqual([['Ana', 'admin'], ['Bob', 'member']])

    const boards = await t.as(sam, () => t.modules.workspace.boards(tenant.id, { size: 10 }))
    expect(boards.items).toContainEqual(expect.objectContaining({ id: roadmap.id, name: 'Roadmap', cards: 3 }))
    expect(boards.items).toContainEqual(expect.objectContaining({ id: empty.id, cards: 0 }))
  })

  test('shows the boards created last across every workspace, archived ones out', async () => {
    const acmeTenant = await acme()
    const globex = await t.as(bob, () => t.auth.modules.tenant.create({ name: 'Globex' }))
    await t.settled()
    const roadmap = await t.board(ana, acmeTenant.id, 'Roadmap', [])
    const old = await t.board(bob, globex.id, 'Old', [])
    await t.as(bob, () => runInWorkspace(globex.id, () => t.boards.modules.board.archive(old.id)))

    const recent = await t.as(sam, () => t.modules.workspace.recentBoards())
    expect(recent[0]).toMatchObject({ id: roadmap.id, name: 'Roadmap', workspaceName: 'Acme' })
    expect(recent.map(board => [board.name, board.workspaceName])).toContainEqual(['Welcome', 'Globex'])
    expect(recent.map(board => [board.name, board.workspaceName])).toContainEqual(['Welcome', 'Acme'])
    expect(recent.some(board => board.id === old.id)).toBe(false)
  })

  test('a workspace that is not there is not found', async () => {
    await expect(t.as(sam, () => t.modules.workspace.get('0190a0a0-0000-7000-8000-000000000000'))).rejects.toMatchObject({ status: 404 })
    await expect(t.as(sam, () => t.modules.workspace.boards('0190a0a0-0000-7000-8000-000000000000', { size: 10 }))).rejects.toMatchObject({ status: 404 })
  })
})
