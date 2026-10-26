import { mkdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

/**
 * Writes each file under `root` that is not there yet, never one that is: what it
 * wrote and what it left as it was, as paths from `root`.
 */
export async function writeNew(root: string, files: Record<string, string>): Promise<{ written: string[], skipped: string[] }> {
  const written: string[] = []
  const skipped: string[] = []
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path)
    if (await Bun.file(file).exists()) {
      skipped.push(relative(root, file))
      continue
    }
    await mkdir(dirname(file), { recursive: true })
    await Bun.write(file, content)
    written.push(relative(root, file))
  }
  return { written, skipped }
}
