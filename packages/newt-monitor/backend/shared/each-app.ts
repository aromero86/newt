import { log } from 'newt-kit/core'

/**
 * Runs something for each application, one after another. One that throws (its DuckDB
 * unreadable, a conflict) is logged and told as `failed`: the others go on all the same.
 */
export async function eachApp<T>(appIds: Iterable<string>, run: (appId: string) => Promise<T>, failed: (appId: string, message: string) => T): Promise<T[]> {
  const outcomes: T[] = []
  for (const appId of appIds) {
    try {
      outcomes.push(await run(appId))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('an application failed: the others go on', { appId, message })
      outcomes.push(failed(appId, message))
    }
  }
  return outcomes
}
