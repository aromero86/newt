import { unlink } from 'node:fs/promises'
import { isMissing } from './is-missing'

export async function removeIfAny(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (!isMissing(error)) throw error
  }
}
