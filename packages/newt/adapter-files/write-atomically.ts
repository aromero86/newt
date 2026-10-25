import { mkdir, open, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Writes a file whole or not at all: to a temporary one first, flushed to the disk,
 * then renamed over it. A crash halfway leaves the old one, never half of the new.
 */
export async function writeAtomically(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Bun.randomUUIDv7()}.tmp`
  const file = await open(temporary, 'w')
  try {
    await file.writeFile(content)
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(temporary, path)
  await syncFolder(dirname(path))
}

/** Flushes a folder's entries, so a rename in it survives a crash. Not every system can. */
async function syncFolder(path: string): Promise<void> {
  try {
    const folder = await open(path, 'r')
    try {
      await folder.sync()
    } finally {
      await folder.close()
    }
  } catch {
    // A system that cannot flush a folder keeps the rename in its own time.
  }
}
