/** What builds an entity: its data, where id and timestamps are optional, and the version it is stored with when read. */
export type EntityInput<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string, createdAt?: string, updatedAt?: string, version?: number }
