/**
 * What a handler sees of an event besides its payload: its id (the same for every
 * handler of it and every run of its job), its name, and when it happened.
 */
export type EventMeta = { id: string, name: string, occurredAt: string }
