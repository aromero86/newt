/**
 * What every event of a card carries besides what happened: its own id and when it
 * was told. A handler sees only the payload, so whoever reacts once per event (the
 * activity log) keys on this id.
 */
export type CardEventStamp = { eventId: string, at: string }

export function cardEventStamp(): CardEventStamp {
  return { eventId: Bun.randomUUIDv7(), at: new Date().toISOString() }
}
