import { expect, test } from 'bun:test'
import { runContexts } from 'newt/application'
import { runAsActor } from 'newt/core'
import { config, type Config } from './config'
import { openContexts, stopContexts } from './open-contexts'
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

test('lets no member into a deleted workspace whose accesses are not taken away yet', async () => {
  const contexts = await openContexts(testConfig())
  try {
    const { access, tenant, user } = contexts.auth.modules
    const signUp = (name: string) => user.signUp({ email: `${name.toLowerCase()}@cooper.test`, name, password: 'a long password' })
    const [ana, bob] = [await signUp('Ana'), await signUp('Bob')]
    const asAna = <T>(fn: () => Promise<T>) => runAsActor({ userId: ana.id, via: 'web' }, fn)
    const acme = await asAna(() => tenant.create({ name: 'Acme' }))
    await asAna(() => access.grant({ userId: bob.id, productId: 'cooper', tenantId: acme.id }))
    await contexts.auth.base.jobs.idle()
    await contexts.auth.base.jobs.stop()

    // The second save of `delete` fails, and its worker does not run: the accesses stay.
    access.revokeTenant = async () => { throw new Error('the database went away') }
    await expect(asAna(() => tenant.delete(acme.id))).rejects.toThrow('the database went away')
    expect(await access.check(bob.id, 'cooper', acme.id)).not.toBeNull()

    const { member } = contexts.boards.modules
    await expect(runAsActor({ userId: bob.id, via: 'web' }, () => member.enter(acme.id))).rejects.toMatchObject({ code: 'workspace.not_found' })
    expect(await member.find(acme.id, bob.id)).toBeNull()
  } finally {
    await stopContexts(contexts)
  }
})
