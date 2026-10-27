import { z } from 'zod'

/** The fewest days the minute detail is kept: the daily summary is made of days at least two days old. */
export const MIN_MINUTE_DAYS = 3

/** How long the monitor keeps an application's metrics: its minutes, with their actor, and its days, without. */
export const RetentionSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  /** How many days each minute is kept, with its actor: 30 by default. */
  minuteDays: z.number().int().min(MIN_MINUTE_DAYS).max(3650).default(30),
  /** How many days each day's summary, without actor, is kept: null for ever. */
  dayDays: z.number().int().min(MIN_MINUTE_DAYS).max(36500).nullable().default(null),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** What a client sends to change it: either, or both. */
export const RetentionChangeSchema = RetentionSchema.pick({ minuteDays: true, dayDays: true }).partial()
  .refine(change => change.minuteDays !== undefined || change.dayDays !== undefined, 'Say what changes: minuteDays or dayDays')

export type RetentionRowDTO = z.infer<typeof RetentionSchema>
export type RetentionDTO = Pick<RetentionRowDTO, 'minuteDays' | 'dayDays'>
export type RetentionChangeDTO = z.input<typeof RetentionChangeSchema>
