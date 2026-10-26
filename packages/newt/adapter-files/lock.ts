import { closeSync, openSync, readFileSync, unlinkSync, utimesSync, writeSync } from 'node:fs'
import { open, stat, utimes } from 'node:fs/promises'
import { ConcurrencyConflict } from '../core'
import { isMissing } from './is-missing'
import { readIfAny } from './read-if-any'
import { removeIfAny } from './remove-if-any'

/** How long a process waits for the lock before it gives up. */
const LOCK_TIMEOUT_MS = 10_000
/** How often a holder touches its lock, to say it is still alive. */
const HEARTBEAT_MS = 1_000
/** A lock not touched for this long is left behind, whoever it names. */
const STALE_MS = 5_000
/** A lock naming nobody (not one of ours) is left behind once it is this old. */
const FOREIGN_STALE_MS = 1_000
/** A guard of a takeover is held for a read and a removal: one this old was left by a crash. */
const GUARD_STALE_MS = 5_000

/**
 * Takes the lock file, waiting while another holder has it, and gives back what
 * releases it. The file says who holds it: a process id and a token of this taking,
 * so a holder only ever lets go of its own (two stores of one process, two Workers,
 * share the process id and still wait for each other).
 *
 * While held, its holder touches it every second. A lock is left behind, and taken
 * over, when the process it names is not alive, or when it has not been touched for
 * 5 s whatever it names (its process died and its id went to another one: a reboot, a
 * container restart), or, naming nobody, once it is older than a second.
 *
 * Removing a lock (letting go of one's own, or taking over one left behind) is done
 * holding a guard of that very token, made with an exclusive create, and only if the
 * lock still holds that token once the guard is held. No one else can remove it
 * meanwhile, so no new lock can take its place before it goes: two holders never
 * both get it.
 *
 * A holder whose process stops for 5 s (a long synchronous step, a GC pause, SIGSTOP,
 * a suspended machine) cannot touch it, and may find it taken over when it goes on.
 * So what it writes goes through `fenced`, which checks it still holds the lock
 * before writing: see there.
 *
 * Every process sharing the folder must see the others' ids: one host, one process
 * namespace.
 */
export async function lock(path: string): Promise<Lock> {
  const token = `${process.pid}:${Bun.randomUUIDv7()}`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    if (await create(path, token)) return held(path, token)
    const seen = await readIfAny(path)
    if (seen !== undefined && await isLeft(path, seen)) {
      await removeIfStill(path, seen)
      continue
    }
    if (Date.now() > deadline) throw new Error(`The store is locked by ${seen ?? 'another process'} (${path})`)
    await Bun.sleep(5)
  }
}

/** A lock taken: what writes holding it, and what lets go of it. */
export type Lock = {
  /**
   * Runs `fn`, which must be synchronous, only if the lock is still this one's, and
   * throws a `ConcurrencyConflict` otherwise (it was taken over while its holder was
   * stopped). It holds the guard of its token meanwhile, so no one can take it over
   * between the check and `fn`, and touches it. What is left: a process stopped for
   * 5 s inside `fn` itself, holding that guard (taken as left by a crash).
   */
  fenced<T>(fn: () => T): T
  release(): Promise<void>
}

/** Keeps the lock touched while held. */
function held(path: string, token: string): Lock {
  const heartbeat = setInterval(() => {
    const now = new Date()
    utimes(path, now, now).catch(() => {})
  }, HEARTBEAT_MS)
  heartbeat.unref()
  return {
    fenced: fn => {
      const guard = guardOf(path, token)
      if (!createSync(guard)) throw new ConcurrencyConflict()
      try {
        if (readSync(path) !== token) throw new ConcurrencyConflict()
        const now = new Date()
        utimesSync(path, now, now)
        return fn()
      } finally {
        removeIfAnySync(guard)
      }
    },
    release: async () => {
      clearInterval(heartbeat)
      await removeIfStill(path, token)
    },
  }
}

/** The guard of a token: whoever holds it is the only one that may remove a lock holding that token. */
function guardOf(path: string, token: string): string {
  return `${path}.${Bun.hash(token).toString(36)}.guard`
}

function createSync(path: string): boolean {
  try {
    const file = openSync(path, 'wx')
    try {
      writeSync(file, `${process.pid}`)
    } finally {
      closeSync(file)
    }
    return true
  } catch (error) {
    if ((error as { code?: string }).code === 'EEXIST') return false
    throw error
  }
}

function removeIfAnySync(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
}

function readSync(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
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

async function isLeft(path: string, seen: string): Promise<boolean> {
  const holder = Number.parseInt(seen.split(':')[0] ?? '', 10)
  if (!Number.isInteger(holder)) return isOlderThan(path, FOREIGN_STALE_MS)
  return !isAlive(holder) || isOlderThan(path, STALE_MS)
}

/**
 * Removes the lock if it still holds `seen`, holding a guard of that token: whoever
 * else would remove it (its holder letting go, another process taking it over) waits
 * for the same guard, so between the check and the removal it stays as it was.
 */
async function removeIfStill(path: string, seen: string): Promise<void> {
  const guard = guardOf(path, seen)
  if (!await create(guard, `${process.pid}`)) {
    // Someone else is removing it; a guard left by a crash halfway goes, to try again.
    if (await isOlderThan(guard, GUARD_STALE_MS)) await removeIfAny(guard)
    return
  }
  try {
    if ((await readIfAny(path)) === seen) await removeIfAny(path)
  } finally {
    await removeIfAny(guard)
  }
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
