// newt/port-analytics/contract: the suite that checks an analytics adapter keeps the
// port's promises, and one in memory, for tests. It runs under `bun test` only.

export { describeAnalyticsContract } from './describe-analytics-contract'
export type { AnalyticsFixture } from './analytics-fixture'
export { MemoryAnalytics } from './memory-analytics'
