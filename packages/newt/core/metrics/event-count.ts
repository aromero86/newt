/**
 * How many times an event was told in a minute, in a context, in the same scopes and by
 * the same actor: what an application counts of its events for whoever monitors it.
 */
export type EventCount = {
  /** The minute's start, ISO: `2026-01-01T10:04:00.000Z`. */
  minute: string
  context: string
  /** `card.created` */
  event: string
  /** The scopes it was told in, each by name and the id of its value: `{ workspace: '01a1…' }`. */
  scopes: Record<string, string>
  /** Who told it (the actor's user), null for no one: a worker, a schedule. */
  actor: string | null
  count: number
}

/** The minutes closed since a cursor, and the cursor to ask from next time. */
export type EventCounts = {
  counts: EventCount[]
  /** The last minute closed: every count up to it, included, is in. */
  until: string
}
