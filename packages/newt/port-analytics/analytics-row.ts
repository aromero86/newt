/** A row of an analytical dataset: anything, with an id that makes it unique. */
export type AnalyticsRow = { id: string, [field: string]: unknown }
