import { readdir } from 'node:fs/promises'
import { isMissing } from './is-missing'

/** The names in a folder, none when there is no folder. */
export async function namesIn(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}
