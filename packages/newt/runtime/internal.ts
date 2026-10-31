// What other pieces of newt need from the runtime and applications must not reach: this
// file is not a subpath of the package. Each export says which piece uses it.

/** The store contract suite runs a second worker on the same store, to check claims. */
export { JobQueue } from './jobs/job-queue'
/** The monitor starts the instance's sampler, and running the contexts stops it, on the way out. */
export { applicationSampler, InstanceSampler } from './metrics/instance-sampler'
/** The monitor samples the instance into the application's metrics, when it set them. */
export { applicationMetrics } from './metrics/set-metrics'
