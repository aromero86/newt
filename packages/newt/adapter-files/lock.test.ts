import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat, unlink, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lock } from './lock'

let folder: string
let path: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'framework-lock-'))
  path = join(folder, '_lock')
})

afterEach(() => rm(folder, { recursive: true, force: true }))

/** Whether `lock` is still waiting after a while. */
async function stillWaiting(taking: Promise<unknown>): Promise<boolean> {
  return Promise.race([taking.then(() => false), Bun.sleep(50).then(() => true)])
}

describe('lock', () => {
  test('releasing lets go only of its own taking', async () => {
    const release = await lock(path)
    await Bun.write(path, 'someone-else')

    await release()

    expect(await Bun.file(path).text()).toBe('someone-else')
  })

  test('waits for a lock of a process alive, and takes it once let go', async () => {
    await Bun.write(path, `${process.ppid}:other`)

    const taking = lock(path)
    expect(await stillWaiting(taking)).toBe(true)
    await unlink(path)

    await (await taking)()
  })

  test('a process it may not signal is alive all the same', async () => {
    await Bun.write(path, '1:init')

    const taking = lock(path)
    expect(await stillWaiting(taking)).toBe(true)
    await unlink(path)

    await (await taking)()
  })

  test('a lock naming nobody is left behind only once it is older than a second', async () => {
    await Bun.write(path, 'garbage')

    const taking = lock(path)
    expect(await stillWaiting(taking)).toBe(true)
    const old = new Date(Date.now() - 5_000)
    await utimes(path, old, old)

    const release = await taking
    expect(await Bun.file(path).text()).toStartWith(`${process.pid}:`)
    await release()
  })

  test('two takings of one process wait for each other: a lock with its id is not its own', async () => {
    const release = await lock(path)

    const taking = lock(path)
    expect(await stillWaiting(taking)).toBe(true)
    await release()

    await (await taking)()
  })

  test('a lock not touched for 5 s is left behind, even when the process it names is alive', async () => {
    // A process that died holding it, whose id went to another one after a restart.
    await Bun.write(path, '1:before-the-restart')
    const old = new Date(Date.now() - 6_000)
    await utimes(path, old, old)

    const release = await lock(path)

    expect(await Bun.file(path).text()).toStartWith(`${process.pid}:`)
    await release()
  })

  test('its holder keeps it touched', async () => {
    const release = await lock(path)
    const old = new Date(Date.now() - 60_000)
    await utimes(path, old, old)

    await Bun.sleep(1_200)

    expect(Date.now() - (await stat(path)).mtimeMs).toBeLessThan(1_000)
    await release()
  })

  test('processes taking over one lock left behind together: one at a time all the same', async () => {
    const counter = join(folder, 'counter')
    await Bun.write(counter, '0')
    await Bun.write(path, '999999999:dead')
    const start = Date.now() + 500
    const script = `
      const { lock } = await import(${JSON.stringify(join(import.meta.dir, 'lock.ts'))})
      while (Date.now() < ${start}) await Bun.sleep(0)
      const release = await lock(${JSON.stringify(path)})
      const now = Number(await Bun.file(${JSON.stringify(counter)}).text())
      await Bun.sleep(30)
      await Bun.write(${JSON.stringify(counter)}, String(now + 1))
      await release()`
    const processes = Array.from({ length: 10 }, () => Bun.spawn(['bun', '-e', script]))

    expect(await Promise.all(processes.map(each => each.exited))).toEqual(Array(10).fill(0))
    expect(await Bun.file(counter).text()).toBe('10')
  }, 20_000)
})
