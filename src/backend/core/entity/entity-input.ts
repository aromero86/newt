/** What builds an entity: its data, where id and timestamps are optional. */
export type EntityInput<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string, createdAt?: string, updatedAt?: string }
