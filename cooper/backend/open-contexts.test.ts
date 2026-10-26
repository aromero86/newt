import { expect, test } from 'bun:test'
import { runAsActor } from 'newt/core'
import { config, type Config } from './config'
import { PRODUCTS } from './contexts/auth/modules/product/product.schema'
import { openContexts, stopContexts } from './open-contexts'
import type { Mail } from './shared/mail/mailer'
import { ConsoleTracer } from './shared/observability/console-tracer'

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
      expect(await response.json()).toEqual({ status: 'ok' })
    }
    // The API's own addresses are never the frontend's.
    expect((await fetch(new URL('/api/nothing', servers[0]!.url))).status).toBe(404)
  } finally {
    await Promise.all(servers.map(server => server.stop()))
    await stopContexts(contexts)
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

test('traces a use case across contexts: auth\'s calls inside the backoffice\'s that made them', async () => {
  const lines: string[] = []
  const contexts = await openContexts(testConfig(), { tracer: new ConsoleTracer(line => lines.push(line)) })
  try {
    const { access, user } = contexts.auth.modules
    const sam = await user.signUp({ email: 'sam@cooper.test', name: 'Sam', password: 'a long password' })
    await access.admit({ userId: sam.id, productId: PRODUCTS.backoffice, tenantId: null, role: 'member' })
    lines.length = 0

    await runAsActor({ userId: sam.id, via: 'web' }, () => contexts.backoffice.modules.staff.me())
    expect(lines.map(line => line.replace(/ \d+\.\d ms$/, ''))).toEqual([
      '[trace] backoffice staff.me',
      '[trace]   backoffice staff.enter',
      '[trace]     backoffice staff.isStaff',
      '[trace]       auth access.check',
      '[trace]   auth user.get',
    ])
  } finally {
    await stopContexts(contexts)
  }
})
