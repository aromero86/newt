import type { MetricsStore } from './services/metrics-store'

/** What the module is given besides its deps: where it keeps each application's DuckDB. */
export type Metrics_Options = { store: MetricsStore }
