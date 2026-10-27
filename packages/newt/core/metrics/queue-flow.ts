/**
 * How a queue's jobs went in a minute, in a context, as a broker would say it: how
 * many were published into it, delivered (done), redelivered (failed, to run again)
 * and dead (out of attempts), and how long each waited in it before a worker took it,
 * by bucket of `histogramBucketOf`. What its handler did is its use case's timing.
 */
export type QueueFlow = {
  minute: string
  context: string
  /** `card.indexCard.on.card.created` */
  queue: string
  published: number
  delivered: number
  redelivered: number
  dead: number
  /** How long jobs waited, ready, before a worker took them: by the bucket's index, as text. */
  wait: Record<string, number>
}

/** The minutes closed since a cursor, and the cursor to ask from next time. */
export type QueueFlows = {
  flows: QueueFlow[]
  until: string
}
