import { expect, test } from 'bun:test'
import { runContexts } from 'newt/application'
import { NoopTracer, runAsActor, setTracer } from 'newt/core'
import { config, type Config } from './config'
import { PRODUCTS } from './contexts/auth/modules/product/product.schema'
import { cooperTracer, openContexts, stopContexts } from './open-contexts'
import { RecordingMailer } from './shared/mail/recording-mailer'
import { ConsoleTracer } from './shared/observability/console-tracer'

/** cooper's settings for a test: every database in memory, every server on a free port. */
function testConfig(): Config {
  return {
    ...config,
    auth: { ...config.auth, database: ':memory:', port: 0 },
    boards: { ...config.boards, database: ':memory:', port: 0 },
    backoffice: { ...config.backoffice, database: ':memory:', port: 0 },
  }
}

test('opens the three contexts, serves each on its own port, and stops them', async () => {
  const mailer = new RecordingMailer()
  const mails = mailer.mails
  const contexts = await openContexts(testConfig(), { mailer })
  expect(contexts.all.map(context => context.name)).toEqual(['auth', 'boards', 'backoffice'])

  const app = runContexts(contexts.all.map(context => ({ context, serve: context.serving() })), { signals: false })
  try {
    const servers = Object.values(app.servers)
    expect(Object.keys(app.servers)).toEqual(['auth', 'boards', 'backoffice'])
    expect(new Set(servers.map(server => server.port)).size).toBe(3)
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

test('traces a use case across contexts: auth\'s calls inside the backoffice\'s that made them', async () => {
  const lines: string[] = []
  const contexts = await openContexts(testConfig())
  setTracer(new ConsoleTracer(line => lines.push(line)))
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
    setTracer(new NoopTracer())
    await stopContexts(contexts)
  }
})

test('traces to OpenTelemetry\'s collector when COOPER_OTLP_URL says where, to the console under COOPER_TRACE, or nowhere', async () => {
  const exported: string[] = []
  const collector = Bun.serve({ port: 0, fetch: async request => { exported.push(`${new URL(request.url).pathname} ${await request.text()}`); return new Response('{}') } })
  try {
    const tracer = cooperTracer({ ...testConfig(), otlpUrl: collector.url.origin, trace: true })!
    await tracer.startActiveSpan('user.get', {}, async span => span.end())
    await tracer.startActiveSpan('job.claim', {}, async span => span.end())
    await tracer.flush!()

    expect(exported).toHaveLength(1)
    expect(exported[0]).toStartWith('/v1/traces ')
    expect(exported[0]).toContain('"user.get"')
    expect(exported[0]).toContain('"cooper"')
    expect(exported[0]).not.toContain('job.claim')
  } finally {
    await collector.stop()
  }

  expect(cooperTracer({ ...testConfig(), otlpUrl: undefined, trace: true })).toBeDefined()
  expect(cooperTracer({ ...testConfig(), otlpUrl: undefined, trace: false })).toBeUndefined()
})
