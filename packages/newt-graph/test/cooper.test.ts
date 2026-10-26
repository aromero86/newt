import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { contextsFromEslint } from '../src/config'
import { analyze } from '../src/extract/analyze'
import type { Graph } from '../src/model'
import { chainOf, GraphIndex } from '../src/page/client/graph-index'

// cooper, the example application, read as `bun run cooper:graph` reads it: from the
// repository's root, its contexts' uses from its eslint.config.js.
const repo = join(import.meta.dir, '..', '..', '..')
const eslint = await contextsFromEslint(repo)
const graph = analyze({ root: join(repo, 'cooper', 'backend'), base: repo, uses: eslint?.uses })
const index = new GraphIndex(graph)

const has = (g: Graph, kind: string, from: string, to: string) => g.edges.some(edge => edge.kind === kind && edge.from === from && edge.to === to)

describe('cooper', () => {
  test('has its three contexts, with the uses newt-eslint declares', () => {
    expect(graph.contexts.map(({ id, uses }) => ({ id, uses }))).toEqual([
      { id: 'auth', uses: [] },
      { id: 'backoffice', uses: ['auth', 'boards'] },
      { id: 'boards', uses: ['auth'] },
    ])
    expect(graph.warnings).toEqual([])
  })

  test('has each context\'s modules, the shared ones in each context that initializes them', () => {
    const modules = (context: string) => graph.modules.filter(each => each.context === context).map(each => each.name).sort()
    expect(modules('auth')).toEqual(['access', 'invitation', 'oauthClient', 'oauthGrant', 'outbox', 'product', 'session', 'tenant', 'token', 'user'])
    expect(modules('boards')).toEqual(['activity', 'board', 'card', 'column', 'member', 'outbox', 'session', 'workspace'])
    expect(modules('backoffice')).toEqual(['job', 'metric', 'outbox', 'session', 'staff', 'user', 'workspace'])
    // backoffice's user module is its own class, not auth's.
    expect(graph.modules.find(each => each.id === 'backoffice/user')?.file).toBe('cooper/backend/contexts/backoffice/modules/user/user.module.ts')
  })

  test('card.create tells card.created, whose handlers record the activity, index the card and count it', () => {
    expect(has(graph, 'emits', 'boards/card.create', 'boards/card.created')).toBe(true)
    for (const handler of ['boards/activity.recordCreated', 'boards/card.indexCard', 'boards/card.notifyAssignee', 'boards/card.leaveRemovedColumn', 'boards/card.unassignMember', 'backoffice/metric.recordCard']) {
      expect(has(graph, 'triggers', 'boards/card.created', handler)).toBe(true)
    }
    const recordCard = graph.subscriptions.find(each => each.id === 'backoffice/metric.recordCard.on.card.created')!
    // A job of boards' outbox, run by boards' worker, though the backoffice reacts.
    expect(recordCard).toMatchObject({ strategy: 'handler', runsIn: 'boards', context: 'backoffice', handlers: ['backoffice/metric.recordCard'] })
  })

  test('tenant.created, in auth, prepares the workspace in boards', () => {
    expect(has(graph, 'triggers', 'auth/tenant.created', 'boards/workspace.prepare')).toBe(true)
    expect(graph.subscriptions.find(each => each.id === 'boards/workspace.prepare.on.tenant.created')).toMatchObject({ runsIn: 'auth', queue: 'workspace.prepare.on.tenant.created' })
  })

  test('access.revoked unassigns the member\'s cards, only for a workspace (when)', () => {
    expect(has(graph, 'emits', 'auth/access.revoke', 'auth/access.revoked')).toBe(true)
    expect(has(graph, 'triggers', 'auth/access.revoked', 'boards/card.unassignMember')).toBe(true)
    expect(graph.subscriptions.find(each => each.id === 'boards/card.unassignMember.on.access.revoked')?.filtered).toBe(true)
  })

  test('the nightly schedule purges the expired sessions', () => {
    expect(graph.events.find(each => each.id === 'auth/session.nightly')).toMatchObject({ schedule: { cron: '0 3 * * *' }, module: 'auth/session' })
    expect(has(graph, 'triggers', 'auth/session.nightly', 'auth/session.purgeExpired')).toBe(true)
  })

  test('card.removeColumn writes to column, as its writesTo says, and calls it', () => {
    expect(has(graph, 'writesTo', 'boards/card.removeColumn', 'boards/column')).toBe(true)
    expect(has(graph, 'calls', 'boards/card.removeColumn', 'boards/column.remove')).toBe(true)
  })

  test('follows a call through a port to the other context\'s use cases', () => {
    const viaPort = graph.edges.filter(edge => edge.kind === 'calls' && edge.from === 'boards/member.isMember')
    expect(viaPort.map(edge => [edge.to, edge.via])).toEqual([['auth/access.check', 'Workspaces.isMember'], ['auth/tenant.getMany', 'Workspaces.isMember']])
    // Each context's web session asks auth who a token is for, through the option its context gave it.
    expect(has(graph, 'calls', 'boards/session.complete', 'auth/token.verify')).toBe(true)
    expect(has(graph, 'calls', 'backoffice/session.me', 'backoffice/staff.me')).toBe(true)
    expect(has(graph, 'calls', 'boards/session.me', 'auth/user.get')).toBe(true)
  })

  test('a value chosen at run time is any of the modules it may be', () => {
    for (const context of ['auth', 'boards', 'backoffice']) expect(has(graph, 'calls', 'backoffice/job.retry', `${context}/outbox.retry`)).toBe(true)
  })

  test('routes carry their groups\' prefixes and middleware', () => {
    const route = graph.routes.find(each => each.id === 'boards/POST /api/workspaces/:workspaceId/boards/:boardId/cards')
    expect(route?.useCases.sort()).toEqual(['boards/card.create', 'boards/member.enter'])
    expect(graph.routes.some(each => each.id === 'auth/POST /oauth/token')).toBe(true)
  })

  test('module deps: modules, and ports with the module behind them', () => {
    const card = graph.modules.find(each => each.id === 'boards/card')!
    expect(card.deps.map(({ name, kind, target }) => ({ name, kind, target }))).toEqual([
      { name: 'board', kind: 'module', target: 'boards/board' },
      { name: 'column', kind: 'module', target: 'boards/column' },
      { name: 'member', kind: 'module', target: 'boards/member' },
      { name: 'access', kind: 'port', target: 'auth/access' },
    ])
    expect(card.deps[0]).toMatchObject({ file: 'cooper/backend/contexts/boards/modules/card/card.deps.ts' })
    const job = graph.modules.find(each => each.id === 'backoffice/job')!
    expect(job.deps.map(each => each.target).sort()).toEqual(['auth/outbox', 'backoffice/outbox', 'backoffice/staff', 'boards/outbox'])
  })

  test('the side effects of card.create, wave after wave', () => {
    const chain = chainOf(index, 'boards/card.create', 'down')
    const wave = (item: string) => {
      let found: number | undefined
      const walk = (node: (typeof chain.roots)[number]) => {
        if (node.item === item && !node.repeat) found ??= node.wave
        node.children.forEach(walk)
      }
      chain.roots.forEach(walk)
      return found
    }
    expect(wave('boards/card.create')).toBe(0)
    expect(wave('auth/access.check')).toBe(0)
    expect(wave('boards/card.created')).toBe(0)
    expect(wave('boards/activity.recordCreated')).toBe(1)
    expect(wave('backoffice/metric.recordCard')).toBe(1)
    // A card left in a removed column moves, and its move is recorded: a worker after a worker.
    expect(wave('boards/activity.recordMoved')).toBe(2)
    expect(chain.frames.length).toBeGreaterThan(3)
  })

  test('who can cause card.unassignMember: auth taking an access away, among others', () => {
    const chain = chainOf(index, 'boards/card.unassignMember', 'up')
    expect(chain.items.has('auth/access.revoked')).toBe(true)
    expect(chain.items.has('auth/access.revoke')).toBe(true)
    expect(chain.items.has('boards/card.create')).toBe(true)
  })

  test('agrees with cooper running: every handler a context registers, and every schedule', async () => {
    // Opened as its tests open it, in memory and never served: what the workers register is what runs.
    const { openContexts, stopContexts } = await import(join(repo, 'cooper', 'backend', 'open-contexts.ts'))
    const { config } = await import(join(repo, 'cooper', 'backend', 'config.ts'))
    const { RecordingMailer } = await import(join(repo, 'cooper', 'backend', 'shared', 'mail', 'recording-mailer.ts'))
    const memory = { database: ':memory:', port: 0 }
    const contexts = await openContexts({
      ...config,
      auth: { ...config.auth, ...memory },
      boards: { ...config.boards, ...memory },
      backoffice: { ...config.backoffice, ...memory },
    }, { mailer: new RecordingMailer() })
    try {
      type Running = { name: string, base: { jobs: unknown, schedules: unknown } }
      const running = (contexts.all as Running[]).flatMap(context => [...(context.base.jobs as { registrations: Map<string, unknown> }).registrations.keys()].map(queue => `${context.name}: ${queue}`))
      const read = graph.subscriptions.filter(each => each.strategy === 'handler').map(each => `${each.runsIn}: ${each.queue}`)
      expect(read.sort()).toEqual(running.sort())
      const schedules = (contexts.all as Running[]).flatMap(context => [...(context.base.schedules as { schedules: Map<string, unknown> }).schedules.keys()].map(name => `${context.name}/${name}`))
      expect(graph.events.filter(each => each.schedule).map(each => each.id).sort()).toEqual(schedules.sort())
    } finally {
      await stopContexts(contexts)
    }
  })
})
