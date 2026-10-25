import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, unlink, utimes } from 'node:fs/promises'
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
})
