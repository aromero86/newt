import type { MonitorIdentity } from 'newt/monitor'
import type { ApplicationDescription } from 'newt/runtime'

/** Where an application's monitor endpoint is, and the key to sign with. */
export type Endpoint = { url: string, key: string }

/**
 * What the monitor asks an application, through its monitor endpoint
 * (`serveMonitor`): a port, since an application is no module of the monitor's. Each
 * call either answers or throws `AppCallFailed`, which says why.
 */
export interface AppClient {
  /** Which application, and which process of it. */
  identity(endpoint: Endpoint): Promise<MonitorIdentity>
  /** What it is made of, as `describeApplication` says it. */
  structure(endpoint: Endpoint): Promise<ApplicationDescription>
}
