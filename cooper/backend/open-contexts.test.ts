import { expect, test } from 'bun:test'
import { runContexts } from 'newt/application'
import { config, type Config } from './config'
import { openContexts } from './open-contexts'
import { RecordingMailer } from './shared/mail/recording-mailer'

/** cooper's settings for a test: every database in memory, every server on a free port. */
function testConfig(): Config {
  return {
    ...config,
    auth: { ...config.auth, database: ':memory:', port: 0 },
    boards: { ...config.boards, database: ':memory:', port: 0 },
  }
}

test('opens the two contexts, serves each on its own port, and stops them', async () => {
  const mailer = new RecordingMailer()
  const mails = mailer.mails
  const contexts = await openContexts(testConfig(), { mailer })
  expect(contexts.all.map(context => context.name)).toEqual(['auth', 'boards'])

  const app = runContexts(contexts.all.map(context => ({ context, serve: context.serving() })), { signals: false })
  try {
    const servers = Object.values(app.servers)
    expect(Object.keys(app.servers)).toEqual(['auth', 'boards'])
    expect(new Set(servers.map(server => server.port)).size).toBe(2)
    for (const server of servers) {
      const response = await fetch(new URL('/api/health', server.url))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'ok' })
    }
    // The API's own addresses are never the frontend's.
    expect((await fetch(new URL('/api/nothing', servers[0]!.url))).status).toBe(404)
  } finally {
    await app.stop()
  }
  expect(mails).toEqual([])
})
