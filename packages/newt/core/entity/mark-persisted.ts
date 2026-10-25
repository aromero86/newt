/**
 * What only a repository does to an entity: mark it saved. A symbol, kept out of the
 * entity's public face so a use case cannot call it by mistake; the package does not
 * export it.
 */
export const markPersisted = Symbol('markPersisted')
