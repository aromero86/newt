/** How many things happened on one day (`2026-10-26`, UTC). */
export type DayCountDTO = { day: string, count: number }

/** cooper's numbers, as the staff's overview shows them: from the analytics, a moment behind. */
export type MetricsOverviewDTO = {
  /** Every one there has ever been. */
  totals: {
    cards: number
    workspaces: number
    signUps: number
  }
  /** The last days, today last, one entry for each day, those with none too. */
  cardsPerDay: DayCountDTO[]
  workspacesPerDay: DayCountDTO[]
  signUpsPerDay: DayCountDTO[]
}

/** The datasets of the analytics the backoffice feeds, one row for each thing that happened, by its id. */
export const METRIC_DATASETS = {
  cardCreated: 'card_created',
  workspaceCreated: 'workspace_created',
  userSignedUp: 'user_signed_up',
} as const
