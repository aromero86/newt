/**
 * What only a repository does to an entity: read all its fields, the ones its public
 * schema leaves out of `toDTO` too, to store them. See `markPersisted`.
 */
export const storedFields = Symbol('storedFields')
