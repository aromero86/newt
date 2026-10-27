/**
 * How a use case's calls went in a minute, in a context, in the same scopes and by the
 * same actor: how many, how many runs more after a conflict, how long in all, and how
 * many took how long, by bucket of `histogramBucketOf`. Buckets sum: across minutes,
 * instances and filters, they say the mean and every percentile.
 */
export type UseCaseTiming = {
  /** The minute's start, ISO. */
  minute: string
  context: string
  /** `card.create` */
  useCase: string
  scopes: Record<string, string>
  actor: string | null
  calls: number
  /** The runs more after a conflict, among those calls. */
  retries: number
  /** Every call's time, summed, in milliseconds. */
  totalMs: number
  /** How many calls took each bucket's time: by the bucket's index, as text. */
  histogram: Record<string, number>
}

/** The minutes closed since a cursor, and the cursor to ask from next time. */
export type UseCaseTimings = {
  timings: UseCaseTiming[]
  /** The last minute closed: every timing up to it, included, is in. */
  until: string
}
