import { afterAll, describe, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { join } from 'node:path'
import { runAsActor } from 'newt/core'
import { PostgresStore } from 'newt/adapter-postgres'
import { describeAnalyticsContract } from 'newt/port-analytics/contract'
import { config, type Config } from './config'
import { PRODUCTS } from './contexts/auth/modules/product/product.schema'
import { inWorkspace } from './contexts/boards/workspace-scope'
import { openContexts, stopContexts } from './open-contexts'
import { SqlAnalytics } from './shared/analytics/sql-analytics'
import { connectStore } from './shared/open-store'

/**
 * cooper on Postgres, when there is one to test against: `COOPER_TEST_POSTGRES_URL`,
 * an address on a server where it may make databases. Without it, these tests are
 * skipped. Each context gets a database of its own, `cooper_test_<context>`, dropped
 * and made again: never one that matters.
 */
const url = process.env.COOPER_TEST_POSTGRES_URL

const CONTEXTS = ['auth', 'boards', 'backoffice', 'analytics'] as const

/** The address of a fresh, empty database of that name, on the same server. */
async function fresh(name: (typeof CONTEXTS)[number]): Promise<string> {
  const database = `cooper_test_${name}`
  const admin = new SQL(url!)
  await admin.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE ${database}`)
  await admin.close()
  const address = new URL(url!)
  address.pathname = `/${database}`
  return address.toString()
}

/** cooper's settings, every context on a fresh Postgres database. */
async function postgresConfig(): Promise<Config> {
  return {
    ...config,
    auth: { ...config.auth, database: await fresh('auth'), port: 0 },
    boards: { ...config.boards, database: await fresh('boards'), port: 0 },
    backoffice: { ...config.backoffice, database: await fresh('backoffice'), port: 0 },
    trace: false,
  }
}

if (url) {
  describe('cooper on Postgres', () => {
    test('opens every context migrated, and works across them as on SQLite', async () => {
      const settings = await postgresConfig()
      const contexts = await openContexts(settings, { mailer: { send: async () => {} } })
      const settled = async () => {
        for (let round = 0; round < 2; round++) for (const context of contexts.all) await context.base.jobs.idle()
      }
      try {
        const { user, tenant, access } = contexts.auth.modules
        const ana = await user.signUp({ email: 'ana@cooper.test', name: 'Ana', password: 'a long password' })
        await access.admit({ userId: ana.id, productId: PRODUCTS.backoffice, tenantId: null, role: 'member' })
        const asAna = <T>(fn: () => Promise<T>) => runAsActor({ userId: ana.id, via: 'web' }, fn)
        const acme = await asAna(() => tenant.create({ name: 'Acme' }))
        await settled()

        const { board, column, card, member } = contexts.boards.modules
        const found = await asAna(() => inWorkspace(member, acme.id, async () => {
          const roadmap = await board.create({ name: 'Roadmap' })
          await expect(board.create({ name: 'ROADMAP' })).rejects.toMatchObject({ code: 'board.name_taken' })
          const todo = await column.add(roadmap.id, { name: 'To do' })
          const cards = await Promise.all(['Plan', 'Design', 'Plan again'].map(title => card.create(roadmap.id, { columnId: todo.id, title })))
          expect(cards.map(each => each.number).toSorted()).toEqual([1, 2, 3])
          await settled()
          return card.search({ text: 'PLAN' }, { size: 10 })
        }))
        expect(found.items.map(each => each.title).toSorted()).toEqual(['Plan', 'Plan again'])
        // The welcome board's card, and the three above.
        expect(await card.countByWorkspace([acme.id])).toEqual([{ workspaceId: acme.id, cards: 4 }])

        const overview = await asAna(() => contexts.backoffice.modules.metric.overview())
        expect(overview.totals).toEqual({ cards: 4, workspaces: 1, signUps: 1 })
        expect(overview.cardsPerDay.at(-1)!.count).toBe(4)
      } finally {
        await stopContexts(contexts)
      }

      // The migrations script sees each database up to date.
      for (const context of ['auth', 'boards', 'backoffice'] as const) {
        const store = await connectStore(settings[context].database, join(import.meta.dir, 'contexts', context, 'migrations'))
        try {
          expect((await store.migrations.status()).pending).toEqual([])
        } finally {
          await store.close()
        }
      }
    }, 30_000)
  })

  const stores: PostgresStore[] = []
  afterAll(async () => {
    for (const store of stores.splice(0)) await store.close()
  })
  describeAnalyticsContract('SqlAnalytics on Postgres', {
    async open() {
      for (const store of stores.splice(0)) await store.close()
      const store = await PostgresStore.open({ url: await fresh('analytics'), migrations: join(import.meta.dir, 'shared/analytics/migrations/postgres') })
      stores.push(store)
      return new SqlAnalytics(store)
    },
    rows: (analytics, dataset) => analytics.rows(dataset),
  })
}
