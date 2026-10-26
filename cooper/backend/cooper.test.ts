import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Server } from 'bun'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { runAsActor } from 'newt/core'
import { serve } from 'newt/http'
import { browser, freePort, type Browser } from 'newt/testing'
import { config, type Config } from './config'
import { inWorkspace } from './contexts/boards/workspace-scope'
import { openContexts, stopContexts } from './open-contexts'
import type { Mail } from './shared/mail/mailer'

/**
 * cooper end to end: auth, boards and backoffice open as the server opens them, on
 * SQLite in memory, and boards used as its UI and an MCP client use it, over HTTP.
 */

function testConfig(authPort: number, boardsPort: number): Config {
  const [authUrl, boardsUrl] = [`http://localhost:${authPort}`, `http://localhost:${boardsPort}`]
  return {
    ...config,
    auth: { ...config.auth, dbPath: ':memory:', port: authPort, publicUrl: authUrl, boardsPublicUrl: boardsUrl },
    boards: { ...config.boards, dbPath: ':memory:', port: boardsPort, publicUrl: boardsUrl, authPublicUrl: authUrl },
    backoffice: { ...config.backoffice, dbPath: ':memory:', port: 0, authPublicUrl: authUrl },
  }
}

let contexts: Awaited<ReturnType<typeof openContexts>>
let servers: Server<undefined>[]
let mails: Mail[]

beforeEach(async () => {
  mails = []
  contexts = await openContexts(testConfig(freePort(), freePort()), { mailer: { send: async mail => { mails.push(mail) } } })
  servers = [serve(contexts.auth.serving()), serve(contexts.boards.serving())]
})

afterEach(async () => {
  await Promise.all(servers.map(server => server.stop()))
  await stopContexts(contexts)
})

const authUrl = (path: string) => new URL(path, contexts.auth.config.publicUrl).toString()
const boardsUrl = (path: string) => new URL(path, contexts.boards.config.publicUrl).toString()

/** Until the background work is done: auth's jobs (boards' reactions to auth's events among them), then boards'. */
async function settled() {
  await contexts.auth.base.jobs.idle()
  await contexts.boards.base.jobs.idle()
}

/** Someone signs up to cooper from boards, as its UI does it: boards' sign-in, auth's pages, back to boards. */
async function signUp(email: string, name: string): Promise<{ as: Browser, id: string }> {
  const as = browser()
  const started = await as(boardsUrl('/api/session/sign-in?returnTo=/'))
  const kept = await as(started.headers.get('location')!)
  const request = kept.headers.get('location')!.split('/authorize/')[1]!
  const user = (await (await as(authUrl('/api/session/sign-up'), { method: 'POST', json: { email, name, password: 'a long password' } })).json()) as { id: string }
  const { redirectTo } = (await (await as(authUrl(`/api/authorizations/${request}/approve`), { method: 'POST' })).json()) as { redirectTo: string }
  expect((await as(redirectTo)).headers.get('location')).toBe('/')
  return { as, id: user.id }
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
    expect(await call(as, 'GET', '/session')).toEqual({ status: 200, body: { user: { id, name: 'Ana', email: 'ana@cooper.test' } } })
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

describe('the MCP server', () => {
  const CALLBACK = 'http://localhost:6274/oauth/callback'

  /** An MCP client signs Ana in through OAuth, as Claude would: registers, sends her to auth with PKCE, trades the code. */
  async function connect(as: Browser): Promise<string> {
    // It only knows the MCP server's address: the 401 says where to find the rest.
    const refused = await fetch(boardsUrl('/mcp'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(refused.status).toBe(401)
    const metadataUrl = refused.headers.get('www-authenticate')!.match(/resource_metadata="([^"]+)"/)![1]!
    const resource = (await (await fetch(metadataUrl)).json()) as { resource: string, authorization_servers: string[] }
    expect(resource).toEqual(expect.objectContaining({ resource: boardsUrl('/mcp'), authorization_servers: [contexts.auth.config.publicUrl] }))
    const server = (await (await fetch(new URL('/.well-known/oauth-authorization-server', resource.authorization_servers[0]))).json()) as Record<string, string>

    const registered = await fetch(server.registration_endpoint!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK] }) })
    const { client_id: clientId } = (await registered.json()) as { client_id: string }

    const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
    const challenge = new Bun.CryptoHasher('sha256').update(verifier).digest('base64url')
    const authorize = new URL(server.authorization_endpoint!)
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 's', resource: resource.resource }).toString()
    const request = (await as(authorize.toString())).headers.get('location')!.split('/authorize/')[1]!
    const { redirectTo } = (await (await as(authUrl(`/api/authorizations/${request}/approve`), { method: 'POST' })).json()) as { redirectTo: string }
    const code = new URL(redirectTo).searchParams.get('code')!

    const tokens = await fetch(server.token_endpoint!, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: CALLBACK }),
    })
    return ((await tokens.json()) as { access_token: string }).access_token
  }

  async function mcpClient(accessToken: string): Promise<Client> {
    const client = new Client({ name: 'cooper-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(boardsUrl('/mcp')), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }))
    return client
  }

  /** A tool's answer, read back from its JSON. */
  async function use<T = unknown>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[], isError?: boolean }
    if (result.isError) throw new Error(result.content[0]!.text)
    return JSON.parse(result.content[0]!.text) as T
  }

  test('works with the boards of the person who connected it through OAuth', async () => {
    const { ana, bob, acme } = await acmeWithBob()
    await settled()
    const client = await mcpClient(await connect(ana.as))
    try {
      expect((await client.listTools()).tools.map(tool => tool.name).toSorted()).toEqual(['assign_card', 'create_card', 'get_board', 'list_boards', 'list_members', 'list_workspaces', 'move_card', 'search_cards'])
      expect(await use(client, 'list_workspaces')).toEqual([{ id: acme.id, name: 'Acme', isAdmin: true }])
      expect(await use(client, 'list_members', { workspaceId: acme.id })).toEqual([
        { id: ana.id, name: 'Ana', email: 'ana@cooper.test', isAdmin: true },
        { id: bob.id, name: 'Bob', email: 'bob@cooper.test', isAdmin: false },
      ])

      const boards = await use<{ items: { id: string, name: string }[] }>(client, 'list_boards', { workspaceId: acme.id })
      expect(boards.items.map(board => board.name)).toEqual(['Welcome'])
      const board = await use<{ columns: { id: string, name: string, cards: unknown[] }[], members: { id: string }[] }>(client, 'get_board', { workspaceId: acme.id, boardId: boards.items[0]!.id })
      expect(board.columns.map(column => [column.name, column.cards.length])).toEqual([['To do', 1], ['Doing', 0], ['Done', 0]])
      expect(board.members.map(member => member.id)).toEqual([ana.id, bob.id])
      const [todo, doing] = [board.columns[0]!, board.columns[1]!]

      const card = await use<{ id: string, number: number }>(client, 'create_card', { workspaceId: acme.id, boardId: boards.items[0]!.id, columnId: todo.id, title: 'Ship the MCP server' })
      expect(card.number).toBe(2)
      expect(await use(client, 'move_card', { workspaceId: acme.id, cardId: card.id, columnId: doing.id })).toMatchObject({ columnId: doing.id, position: 0 })
      expect(await use(client, 'assign_card', { workspaceId: acme.id, cardId: card.id, assigneeId: bob.id })).toMatchObject({ assignee: { id: bob.id, name: 'Bob' } })
      expect(await use(client, 'search_cards', { workspaceId: acme.id, text: 'mcp', assigneeId: bob.id })).toMatchObject({ items: [{ id: card.id }], total: 1 })
      expect(await use(client, 'assign_card', { workspaceId: acme.id, cardId: card.id, assigneeId: null })).toMatchObject({ assignee: null })

      // Its activity says the assistant did it, as Ana.
      await settled()
      const activity = await runAsActor({ userId: ana.id, via: 'web' }, () => inWorkspace(contexts.boards.modules.member, acme.id, () => contexts.boards.modules.activity.listForCard(card.id, { size: 10 })))
      expect(activity.items.map(entry => [entry.kind, entry.actorId, entry.via])).toEqual([
        ['unassigned', ana.id, 'mcp'],
        ['assigned', ana.id, 'mcp'],
        ['moved', ana.id, 'mcp'],
        ['created', ana.id, 'mcp'],
      ])

      // As on the web: a workspace the person is not in does not exist to them.
      const result = (await client.callTool({ name: 'list_boards', arguments: { workspaceId: '01900000-0000-7000-8000-000000000000' } })) as { isError?: boolean, content: { text: string }[] }
      expect(result.isError).toBe(true)
      expect(result.content[0]!.text).toContain('no workspace')
    } finally {
      await client.close()
    }
  })

  test('refuses a request without a token of auth\'s for it, and says where to get one', async () => {
    const missing = await fetch(boardsUrl('/mcp'), { method: 'POST' })
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${boardsUrl('/.well-known/oauth-protected-resource/mcp')}"`)
    const forged = await fetch(boardsUrl('/mcp'), { method: 'POST', headers: { authorization: 'Bearer not-a-token' } })
    expect(forged.headers.get('www-authenticate')).toContain('error="invalid_token"')

    // Open to a client in a browser, such as the MCP inspector.
    const preflight = await fetch(boardsUrl('/mcp'), { method: 'OPTIONS', headers: { origin: 'http://localhost:6274', 'access-control-request-method': 'POST' } })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-headers')).toContain('authorization')
    for (const path of ['/oauth/register', '/oauth/token', '/.well-known/oauth-authorization-server']) {
      expect((await fetch(authUrl(path), { method: 'OPTIONS' })).headers.get('access-control-allow-origin')).toBe('*')
    }
    expect(await (await fetch(boardsUrl('/.well-known/oauth-protected-resource'))).json()).toMatchObject({ resource: boardsUrl('/mcp') })
  })
})
