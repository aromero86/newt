import { expect, test } from 'bun:test'
import { config, type Config } from './config'
import { openContexts, stopContexts } from './open-contexts'
import type { Mail } from './shared/mail/mailer'

/** cooper's settings for a test: every database in memory, every server on a free port. */
function testConfig(): Config {
  return {
    ...config,
    auth: { ...config.auth, dbPath: ':memory:', port: 0 },
    boards: { ...config.boards, dbPath: ':memory:', port: 0 },
    backoffice: { ...config.backoffice, dbPath: ':memory:', port: 0 },
  }
}

test('opens the three contexts, serves each on its own port, and stops them', async () => {
  const mails: Mail[] = []
  const contexts = await openContexts(testConfig(), { mailer: { send: async mail => { mails.push(mail) } } })
  expect(contexts.all.map(context => context.name)).toEqual(['auth', 'boards', 'backoffice'])

  const servers = contexts.all.map(context => context.serve())
  for (const context of contexts.all) context.start()
  try {
    expect(new Set(servers.map(server => server.port)).size).toBe(3)
    for (const [index, context] of contexts.all.entries()) {
      const response = await fetch(new URL('/api/health', servers[index]!.url))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'ok', context: context.name })
    }
    // The API's own addresses are never the frontend's.
    expect((await fetch(new URL('/api/nothing', servers[0]!.url))).status).toBe(404)
  } finally {
    await Promise.all(servers.map(server => server.stop()))
    await stopContexts(contexts)
  }
  expect(mails).toEqual([])
})
