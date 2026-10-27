import { z } from 'zod'

/** The fewest days the minute detail is kept: the daily summary is made of days at least two days old. */
export const MIN_MINUTE_DAYS = 3

/** How long the monitor keeps an application's metrics: its minutes, with their actor, and its days, without; and its traces. */
export const RetentionSchema = z.object({
  id: z.uuidv7(),
  appId: z.uuidv7(),
  /** How many days each minute is kept, with its actor: 30 by default. */
  minuteDays: z.number().int().min(MIN_MINUTE_DAYS).max(3650).default(30),
  /** How many days each day's summary, without actor, is kept: null for ever. */
  dayDays: z.number().int().min(MIN_MINUTE_DAYS).max(36500).nullable().default(null),
  /** How many days each trace is kept: 7 by default. */
  traceDays: z.number().int().min(1).max(365).default(7),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

/** What a client sends to change it: either, or both. */
export const RetentionChangeSchema = RetentionSchema.pick({ minuteDays: true, dayDays: true, traceDays: true }).partial()
  .refine(change => change.minuteDays !== undefined || change.dayDays !== undefined || change.traceDays !== undefined, 'Say what changes: minuteDays, dayDays or traceDays')

export type RetentionRowDTO = z.infer<typeof RetentionSchema>
export type RetentionDTO = Pick<RetentionRowDTO, 'minuteDays' | 'dayDays' | 'traceDays'>
export type RetentionChangeDTO = z.input<typeof RetentionChangeSchema>
