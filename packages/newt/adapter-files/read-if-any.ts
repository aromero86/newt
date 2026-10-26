import { readFile } from 'node:fs/promises'
import { isMissing } from './is-missing'

/** A file's text, or `undefined` when there is none. */
export async function readIfAny(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
}
