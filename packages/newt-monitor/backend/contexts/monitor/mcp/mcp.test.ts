import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { freePort, type Browser } from 'newt/testing'
import { openTestMonitor, type TestMonitor } from '../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../testing/serve-test-app'

const CALLBACK = 'http://localhost:6274/oauth/callback'

let monitor: TestMonitor
let app: TestApp
let as: Browser
let url: string

beforeEach(async () => {
  const port = await freePort()
  url = `http://localhost:${port}`
  monitor = await openTestMonitor({ port, publicUrl: url })
  as = await monitor.signedIn()
  app = serveTestApp()
  app.add('boards', { card: { useCases: ['create'] } })
  await as('/api/apps', { method: 'POST', json: { name: 'shop', url: app.url, key: app.key } })
  await monitor.monitor.base.jobs.idle()
})

afterEach(async () => {
  await app.stop()
  await monitor.close()
})

/** What an MCP client does, as Claude would: finds out how to sign in, registers, sends the person to the monitor with PKCE, trades the code. */
async function connect(): Promise<{ access_token: string, refresh_token: string, clientId: string }> {
  // It only knows the MCP server's address: the 401 says where to find the rest.
  const refused = await fetch(`${url}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  expect(refused.status).toBe(401)
  const metadataUrl = refused.headers.get('www-authenticate')!.match(/resource_metadata="([^"]+)"/)![1]!
  const resource = (await (await fetch(metadataUrl)).json()) as { resource: string, authorization_servers: string[] }
  expect(resource).toEqual(expect.objectContaining({ resource: `${url}/mcp`, authorization_servers: [url] }))
  const server = (await (await fetch(new URL('/.well-known/oauth-authorization-server', resource.authorization_servers[0]))).json()) as Record<string, string>

  const registered = await fetch(server.registration_endpoint!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK] }) })
  const { client_id: clientId } = (await registered.json()) as { client_id: string }

  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url')
  const challenge = new Bun.CryptoHasher('sha256').update(verifier).digest('base64url')
  const authorize = new URL(server.authorization_endpoint!)
  authorize.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 's', resource: resource.resource }).toString()
  const consent = (await as(authorize.toString())).headers.get('location')!
  expect(consent).toStartWith(`${url}/authorize/`)
  const request = consent.split('/authorize/')[1]!
  expect(await (await as(`/api/authorizations/${request}`)).json()).toMatchObject({ clientName: 'Claude', redirectHost: 'localhost:6274', open: true })
  const { redirectTo } = (await (await as(`/api/authorizations/${request}/approve`, { method: 'POST' })).json()) as { redirectTo: string }
  expect(new URL(redirectTo).searchParams.get('state')).toBe('s')

  const tokens = await fetch(server.token_endpoint!, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: new URL(redirectTo).searchParams.get('code')!, code_verifier: verifier, client_id: clientId, redirect_uri: CALLBACK }),
  })
  expect(tokens.status).toBe(200)
  return { ...((await tokens.json()) as { access_token: string, refresh_token: string }), clientId }
}

async function mcpClient(accessToken: string): Promise<Client> {
  const client = new Client({ name: 'monitor-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }))
  return client
}

/** A tool's answer, read back from its JSON. */
async function use<T = unknown>(client: Client, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[], isError?: boolean }
  if (result.isError) throw new Error(result.content[0]!.text)
  return JSON.parse(result.content[0]!.text) as T
}

describe('the MCP server', () => {
  test('reads what the monitor knows, for the person who connected it through OAuth', async () => {
    const client = await mcpClient((await connect()).access_token)
    try {
      expect((await client.listTools()).tools.map(tool => tool.name).toSorted()).toEqual([
        'dead_jobs', 'error_codes', 'errors_totals', 'event_totals', 'get_structure', 'get_trace', 'list_apps', 'list_traces',
        'list_versions', 'queues', 'system_and_instances', 'system_series', 'use_case_series', 'use_case_totals',
      ])
      const apps = await use<{ items: { id: string, name: string, connection: string }[] }>(client, 'list_apps')
      expect(apps.items).toMatchObject([{ name: 'shop', connection: 'up' }])
      const appId = apps.items[0]!.id
      expect(await use(client, 'get_structure', { appId })).toMatchObject({ description: { contexts: [{ name: 'boards' }] } })
      expect(await use(client, 'use_case_totals', { appId, window: '1h' })).toEqual([])
      expect(await use(client, 'system_and_instances', { appId })).toEqual({ system: null, instances: [] })
      // A wrong question is the tool's error, as the route's would be.
      await expect(use(client, 'use_case_series', { appId, context: 'boards' })).rejects.toThrow()
    } finally {
      await client.close()
    }
  })

  test('lets in no one without a token of its own, refreshes one once, and forgets one copied or given back', async () => {
    const missing = await fetch(`${url}/mcp`, { method: 'POST' })
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${url}/.well-known/oauth-protected-resource/mcp"`)
    expect((await fetch(`${url}/mcp`, { method: 'POST', headers: { authorization: 'Bearer not-a-token' } })).status).toBe(401)
    // A session's cookie opens the monitor's pages, not its MCP server.
    expect((await as('/mcp', { method: 'POST', json: {} })).status).toBe(401)

    const { refresh_token: refreshToken, clientId } = await connect()
    const form = (fields: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) })
    const refreshed = await fetch(`${url}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }))
    const { access_token: accessToken } = (await refreshed.json()) as { access_token: string }
    await (await mcpClient(accessToken)).close()
    // The refresh token it replaced, brought again, was copied: what it gave stops working.
    expect((await fetch(`${url}/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }))).status).toBe(400)
    expect((await fetch(`${url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${accessToken}` } })).status).toBe(401)

    const again = await connect()
    expect((await fetch(`${url}/oauth/revoke`, form({ token: again.access_token, client_id: again.clientId }))).status).toBe(200)
    expect((await fetch(`${url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${again.access_token}` } })).status).toBe(401)
  })

  test('sends the person back with nothing when they say no, and never to an address the client did not register', async () => {
    const registered = await fetch(`${url}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CALLBACK] }) })
    const { client_id: clientId } = (await registered.json()) as { client_id: string }
    const challenge = new Bun.CryptoHasher('sha256').update('v'.repeat(43)).digest('base64url')
    const ask = (redirect: string) => as(`${url}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256' })}`)

    expect((await ask('https://elsewhere.example/callback')).headers.get('location')).toStartWith(`${url}/authorize/error?`)
    const request = (await ask(CALLBACK)).headers.get('location')!.split('/authorize/')[1]!
    const { redirectTo } = (await (await as(`/api/authorizations/${request}/deny`, { method: 'POST' })).json()) as { redirectTo: string }
    expect(new URL(redirectTo).searchParams.get('error')).toBe('access_denied')
    expect((await as(`/api/authorizations/${request}/approve`, { method: 'POST' })).status).toBe(409)
  })

  test('refuses a client whose Basic credentials do not decode, as any client it does not know', async () => {
    const basic = { authorization: `Basic ${Buffer.from('a%zz:b').toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }
    for (const [endpoint, fields] of [['token', { grant_type: 'refresh_token', refresh_token: 'r' }], ['revoke', { token: 't' }]] as const) {
      const refused = await fetch(`${url}/oauth/${endpoint}`, { method: 'POST', headers: basic, body: new URLSearchParams(fields) })
      expect(refused.status).toBe(401)
      expect(await refused.json()).toMatchObject({ error: 'invalid_client' })
    }
  })
})
