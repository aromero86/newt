/**
 * What a save of an application's rows throws, from its `after`, on finding that the
 * application was deleted while the use case ran (a call to it takes seconds): what
 * the monitor knew of it is already forgotten, so the rows would stay for good. It
 * rolls the save back, and `unlessAppGone` says it was not saved.
 */
class AppGone extends Error {}

/**
 * In a save's `after`, so in its transaction: rolls it back if the application is no
 * longer there. A delete committed before it is seen; one after it forgets its rows.
 */
export async function assertAppThere(isThere: () => Promise<boolean>): Promise<void> {
  if (!await isThere()) throw new AppGone()
}

/** Runs a save that may find its application gone (`assertAppThere`): whether it saved. */
export async function unlessAppGone(save: () => Promise<void>): Promise<boolean> {
  try {
    await save()
    return true
  } catch (error) {
    if (error instanceof AppGone) return false
    throw error
  }
}
