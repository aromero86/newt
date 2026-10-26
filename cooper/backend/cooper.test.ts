import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { serve } from 'newt/http'
import { browser, freePort, type Browser } from 'newt/testing'
import { config, type Config } from './config'
import { openContexts, stopContexts } from './open-contexts'
import type { Mail } from './shared/mail/mailer'
import { RecordingMailer } from './shared/mail/recording-mailer'

/**
 * cooper end to end: auth and boards open as the server opens them, on SQLite in
 * memory, and boards used as its UI uses it, over HTTP.
 */

function testConfig(authPort: number, boardsPort: number): Config {
  const boardsUrl = `http://localhost:${boardsPort}`
  return {
    ...config,
    auth: { ...config.auth, database: ':memory:', port: authPort, boardsPublicUrl: boardsUrl },
    boards: { ...config.boards, database: ':memory:', port: boardsPort, publicUrl: boardsUrl },
  }
}

let contexts: Awaited<ReturnType<typeof openContexts>>
let servers: Server<undefined>[]
let mails: Mail[]

beforeEach(async () => {
  const mailer = new RecordingMailer()
  mails = mailer.mails
  contexts = await openContexts(testConfig(freePort(), freePort()), { mailer })
  // For now boards is told who sends a request by an `x-user` header (chapter 22 signs them in through auth).
  contexts.boards.base.http.authenticateWith(async request => {
    const userId = request.headers.get('x-user')
    return userId ? { userId, via: 'web' as const } : null
  })
  servers = [serve(contexts.auth.serving()), serve(contexts.boards.serving())]
})

afterEach(async () => {
  await Promise.all(servers.map(server => server.stop()))
  await stopContexts(contexts)
})

const boardsUrl = (path: string) => new URL(path, contexts.boards.config.publicUrl).toString()

/** Until the background work is done: auth's jobs (boards' reactions to auth's events among them), then boards'. */
async function settled() {
  await contexts.auth.base.jobs.idle()
  await contexts.boards.base.jobs.idle()
}

/**
 * Someone signs up to cooper. For now boards is told who they are by an `x-user`
 * header on each request (chapter 22 signs them in through auth's pages).
 */
async function signUp(email: string, name: string): Promise<{ as: Browser, id: string }> {
  const { id } = await contexts.auth.modules.user.signUp({ email, name, password: 'a long password' })
  const as = browser()
  return { as: (address, init) => as(address, { ...init, headers: { 'x-user': id } }), id }
}

/** boards' API, as its UI calls it. */
async function call<T = unknown>(as: Browser, method: string, path: string, json?: unknown) {
  const response = await as(boardsUrl(`/api${path}`), { method, json })
  return { status: response.status, body: (response.status === 204 ? null : await response.json()) as T }
}

type Workspace = { id: string, name: string, adminId: string, isAdmin: boolean, createdAt: string }
type View = { board: { id: string, name: string }, columns: { id: string, name: string }[], cards: { id: string, title: string, assigneeId: string | null }[] }

/** Ana's workspace Acme, with its welcome board, and Bob in it, who accepted her invitation. */
async function acmeWithBob() {
  const ana = await signUp('ana@cooper.test', 'Ana')
  const acme = (await call<Workspace>(ana.as, 'POST', '/workspaces', { name: 'Acme' })).body
  const invited = await call<{ id: string, email: string, status: string }>(ana.as, 'POST', `/workspaces/${acme.id}/invitations`, { email: 'bob@cooper.test' })
  expect(invited).toMatchObject({ status: 201, body: { email: 'bob@cooper.test', status: 'pending' } })
  await settled()
  const token = mails.findLast(mail => mail.to === 'bob@cooper.test')!.text.match(/invitations\/([A-Za-z0-9_-]{43})/)![1]!

  const bob = await signUp('bob@cooper.test', 'Bob')
  expect(await call(browser(), 'GET', `/invitations/${token}`)).toEqual({ status: 200, body: { workspaceName: 'Acme', email: 'bob@cooper.test', invitedBy: 'Ana' } })
  expect(await call(bob.as, 'POST', `/invitations/${token}/accept`)).toEqual({ status: 200, body: { workspaceId: acme.id } })
  return { ana, bob, acme, token }
}

async function welcomeOf(as: Browser, workspaceId: string): Promise<View> {
  const boards = (await call<{ items: { id: string }[] }>(as, 'GET', `/workspaces/${workspaceId}/boards`)).body
  return (await call<View>(as, 'GET', `/workspaces/${workspaceId}/boards/${boards.items[0]!.id}/view`)).body
}

describe('workspaces, through boards', () => {
  test('a new workspace is its maker\'s, and gets its welcome board a moment later', async () => {
    const { as, id } = await signUp('ana@cooper.test', 'Ana')
    expect(await call(as, 'POST', '/workspaces', { name: '' })).toMatchObject({ status: 400, body: { code: 'validation' } })

    const created = await call<Workspace>(as, 'POST', '/workspaces', { name: 'Acme' })
    expect(created).toMatchObject({ status: 201, body: { name: 'Acme', adminId: id, isAdmin: true } })
    const acme = created.body
    expect((await call(as, 'GET', '/workspaces')).body).toEqual([acme])
    expect((await call(as, 'GET', `/workspaces/${acme.id}/boards`)).body).toMatchObject({ total: 0 })

    await settled()
    const welcome = await welcomeOf(as, acme.id)
    expect(welcome.board.name).toBe('Welcome')
    expect(welcome.columns.map(column => column.name)).toEqual(['To do', 'Doing', 'Done'])

    expect(await call(as, 'PATCH', `/workspaces/${acme.id}`, { name: 'Acme Inc' })).toMatchObject({ status: 200, body: { id: acme.id, name: 'Acme Inc', isAdmin: true } })
    expect(await call(as, 'GET', `/workspaces/${acme.id}/members`)).toEqual({ status: 200, body: [{ id, name: 'Ana', email: 'ana@cooper.test', isAdmin: true }] })
  })

  test('an invitation is accepted by who has its email, and only its admin manages the workspace', async () => {
    const { ana, bob, acme, token } = await acmeWithBob()

    expect((await call(bob.as, 'GET', '/workspaces')).body).toEqual([{ ...acme, isAdmin: false }])
    expect((await call(ana.as, 'GET', `/workspaces/${acme.id}/members`)).body).toEqual([
      { id: ana.id, name: 'Ana', email: 'ana@cooper.test', isAdmin: true },
      { id: bob.id, name: 'Bob', email: 'bob@cooper.test', isAdmin: false },
    ])
    expect((await call(ana.as, 'GET', `/workspaces/${acme.id}/invitations`)).body).toEqual([])
    // Spent: the link opens nothing any more.
    expect(await call(browser(), 'GET', `/invitations/${token}`)).toMatchObject({ status: 409, body: { code: 'invitation.not_open' } })

    // A member works in it, but only its admin renames it, invites or deletes it.
    expect(await call(bob.as, 'PATCH', `/workspaces/${acme.id}`, { name: 'Mine' })).toMatchObject({ status: 403, body: { code: 'tenant.not_admin' } })
    expect((await call(bob.as, 'GET', `/workspaces/${acme.id}/invitations`)).status).toBe(403)
    expect((await call(bob.as, 'DELETE', `/workspaces/${acme.id}`)).status).toBe(403)

    // A pending invitation, revoked by the admin.
    const carla = (await call<{ id: string }>(ana.as, 'POST', `/workspaces/${acme.id}/invitations`, { email: 'carla@cooper.test' })).body
    expect((await call(ana.as, 'GET', `/workspaces/${acme.id}/invitations`)).body).toEqual([expect.objectContaining({ id: carla.id, email: 'carla@cooper.test', status: 'pending' })])
    expect((await call(ana.as, 'DELETE', `/workspaces/${acme.id}/invitations/${carla.id}`)).status).toBe(204)
    expect((await call(ana.as, 'GET', `/workspaces/${acme.id}/invitations`)).body).toEqual([])

    // Somebody else, signed in, is told it does not exist.
    const eve = await signUp('eve@cooper.test', 'Eve')
    expect(await call(eve.as, 'GET', `/workspaces/${acme.id}/members`)).toMatchObject({ status: 404, body: { code: 'workspace.not_found' } })
    expect((await call(browser(), 'GET', '/workspaces')).status).toBe(401)
  })

  test('someone removed from a workspace leaves their cards unassigned, a moment later', async () => {
    const { ana, bob, acme } = await acmeWithBob()
    await settled()
    const card = (await welcomeOf(ana.as, acme.id)).cards[0]!
    expect((await call(ana.as, 'POST', `/workspaces/${acme.id}/cards/${card.id}/assign`, { assigneeId: bob.id })).body).toMatchObject({ assigneeId: bob.id })

    expect(await call(ana.as, 'DELETE', `/workspaces/${acme.id}/members/${ana.id}`)).toMatchObject({ status: 409 })
    expect((await call(ana.as, 'DELETE', `/workspaces/${acme.id}/members/${bob.id}`)).status).toBe(204)
    expect((await call(bob.as, 'GET', `/workspaces/${acme.id}/boards`)).status).toBe(404)
    await settled()

    expect((await call<{ assigneeId: string | null }>(ana.as, 'GET', `/workspaces/${acme.id}/cards/${card.id}`)).body.assigneeId).toBeNull()
    expect((await call(ana.as, 'GET', `/workspaces/${acme.id}/members`)).body).toEqual([expect.objectContaining({ id: ana.id })])
  })

  test('a deleted workspace loses its boards, and nobody enters it', async () => {
    const { ana, bob, acme } = await acmeWithBob()
    await settled()
    expect((await contexts.boards.modules.board.listOf(acme.id, { size: 10 })).total).toBe(1)

    expect((await call(ana.as, 'DELETE', `/workspaces/${acme.id}`)).status).toBe(204)
    await settled()

    expect(await contexts.boards.modules.board.listOf(acme.id, { size: 10 })).toMatchObject({ items: [], total: 0 })
    expect(await contexts.boards.modules.card.countByWorkspace([acme.id])).toEqual([{ workspaceId: acme.id, cards: 0 }])
    expect((await call(ana.as, 'GET', '/workspaces')).body).toEqual([])
    expect((await call(bob.as, 'GET', `/workspaces/${acme.id}/boards`)).status).toBe(404)
  })
})
