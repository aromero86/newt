import { link, open, rename, stat } from 'node:fs/promises'
import { isMissing } from './is-missing'
import { readIfAny } from './read-if-any'
import { removeIfAny } from './remove-if-any'

/** How long a process waits for the lock before it gives up. */
const LOCK_TIMEOUT_MS = 10_000

/**
 * Takes the lock file, waiting while another process holds it, and gives back what
 * releases it. The file says who holds it: a process id and a token of this taking.
 *
 * A lock is left behind when its process dies, and is taken over: one naming a
 * process that is not alive, or this very process (which only asks once it let go of
 * its own, so a lock with its id is from an earlier life: a container restarts with
 * the same id), or nobody, if it is older than a second. Taking one over is a rename
 * to a name of one's own first, so only one of the processes waiting gets it; and if
 * what it renamed is not what it read (someone took it meanwhile) it puts it back.
 *
 * Every process sharing the folder must see the others' ids: one host, one process
 * namespace.
 */
export async function lock(path: string): Promise<() => Promise<void>> {
  const token = `${process.pid}:${Bun.randomUUIDv7()}`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    if (await create(path, token)) return () => release(path, token)
    const seen = await readIfAny(path)
    if (seen !== undefined && await isLeft(path, seen)) {
      await takeOver(path, seen)
      continue
    }
    if (Date.now() > deadline) throw new Error(`The store is locked by ${seen ?? 'another process'} (${path})`)
    await Bun.sleep(5)
  }
}

async function create(path: string, token: string): Promise<boolean> {
  try {
    const file = await open(path, 'wx')
    try {
      await file.writeFile(token)
    } finally {
      await file.close()
    }
    return true
  } catch (error) {
    if ((error as { code?: string }).code === 'EEXIST') return false
    throw error
  }
}

/** Lets go of the lock, if it is still this taking's. */
async function release(path: string, token: string): Promise<void> {
  if ((await readIfAny(path)) === token) await removeIfAny(path)
}

async function isLeft(path: string, seen: string): Promise<boolean> {
  const holder = Number.parseInt(seen.split(':')[0] ?? '', 10)
  if (!Number.isInteger(holder)) return isOlderThan(path, 1_000)
  return holder === process.pid || !isAlive(holder)
}

/** Moves a lock left behind out of the way, unless someone took it since it was read. */
async function takeOver(path: string, seen: string): Promise<void> {
  const aside = `${path}.${process.pid}.${Bun.randomUUIDv7()}.left`
  try {
    await rename(path, aside)
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
  if ((await readIfAny(aside)) !== seen) {
    // A live lock, taken between the read and the rename: back where it was, unless
    // the place is taken again already, which only a live lock could do.
    try {
      await link(aside, path)
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error
    }
  }
  await removeIfAny(aside)
}

async function isOlderThan(path: string, ms: number): Promise<boolean> {
  try {
    return Date.now() - (await stat(path)).mtimeMs > ms
  } catch (error) {
    return isMissing(error)
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM'
  }
}
