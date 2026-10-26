/**
 * What only a repository does to an entity: check, before saving it, that it may be
 * saved. See `markPersisted`.
 */
export const assertSavable = Symbol('assertSavable')
