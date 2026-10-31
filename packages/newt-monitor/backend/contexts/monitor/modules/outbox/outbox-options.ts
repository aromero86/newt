import type { MetricsStore } from '../../../../shared/metrics-store/metrics-store'

/** What the module is given besides its deps: each application's DuckDB, where its datasets are. */
export type Outbox_Options = { store: MetricsStore }
