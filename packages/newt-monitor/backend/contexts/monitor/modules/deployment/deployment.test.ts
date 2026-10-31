import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { Page } from 'newt/core'
import type { Browser } from 'newt/testing'
import { openTestMonitor, type TestMonitor } from '../../../../testing/open-test-monitor'
import { serveTestApp, type TestApp } from '../../../../testing/serve-test-app'
import type { DeploymentDTO } from './deployment'

const REPOSITORY = 'https://github.com/acme/shop'

let monitor: TestMonitor
let app: TestApp
let as: Browser
let id: string
/** What GitHub was asked, and what it answers: each commit's title, none for one it does not have. */
let asked: string[]
let titles: Record<string, string>

beforeEach(async () => {
  asked = []
  titles = { c1: 'Cards can be moved', c2: 'Boards can be archived' }
  monitor = await openTestMonitor({
    titles: {
      title: async (repository, commit) => {
        asked.push(`${repository}@${commit}`)
        return titles[commit] ?? null
      },
    },
  })
  as = await monitor.signedIn()
  app = serveTestApp()
  id = (await (await as('/api/apps', { method: 'POST', json: { name: 'shop', url: app.url, key: app.key, repository: `${REPOSITORY}.git` } })).json() as { id: string }).id
  await idle()
})

afterEach(async () => {
  await app.stop()
  await monitor.close()
})

const idle = () => monitor.monitor.base.jobs.idle()
const deployments = async () => ((await (await as(`/api/apps/${id}/deployments`)).json()) as Page<DeploymentDTO>).items

/** Its instances, each built from a commit, read now and collected. */
async function deployed(...instances: [string, string | null][]) {
  for (const [instance, commit] of instances) app.sample(instance, { at: new Date(Date.now() - 2_000), commit })
  await monitor.modules.instances.collect(id)
  await idle()
}

describe('deployment', () => {
  test('records each commit its instances were built from once, the newest first, with its title from GitHub', async () => {
    // Two instances of one commit, then a rolling deployment of another.
    await deployed(['a', 'c1'], ['b', 'c1'])
    await deployed(['c', 'c2'])

    expect((await deployments()).map(each => [each.commit, each.title])).toEqual([['c2', 'Boards can be archived'], ['c1', 'Cards can be moved']])
    // Asked once per commit, of the repository as it is kept: without its `.git`.
    expect(asked).toEqual([`${REPOSITORY}@c1`, `${REPOSITORY}@c2`])
    const instances = (await (await as(`/api/apps/${id}/instances`)).json()) as { instances: { instanceId: string, commit: string | null }[] }
    expect(instances.instances.map(each => [each.instanceId, each.commit]).sort()).toEqual([['a', 'c1'], ['b', 'c1'], ['c', 'c2']])
  })

  test('records nothing of an instance that does not say its commit', async () => {
    await deployed(['a', null])
    expect(await deployments()).toEqual([])
  })

  test('keeps a commit without a title until its repository tells it, or the application says where its code is', async () => {
    await as(`/api/apps/${id}`, { method: 'PATCH', json: { repository: '' } })
    await deployed(['a', 'c1'])
    expect((await deployments()).map(each => each.title)).toEqual([null])
    expect(asked).toEqual([])

    await as(`/api/apps/${id}`, { method: 'PATCH', json: { repository: REPOSITORY } })
    await idle()
    expect((await deployments()).map(each => each.title)).toEqual(['Cards can be moved'])
  })

  test('refuses a repository that is not on GitHub', async () => {
    const answer = await as(`/api/apps/${id}`, { method: 'PATCH', json: { repository: 'https://gitlab.com/acme/shop' } })
    expect(answer.status).toBe(400)
  })
})
