import type { CooperBase } from '../../../../shared/cooper-base'
import { staffRoutes } from '../../staff-routes'
import type { Metric_Deps } from './metric.deps'
import type { Metric_Module } from './metric.module'

export function registerMetricRoutes(base: CooperBase, metrics: Metric_Module, deps: Metric_Deps): void {
  const routes = staffRoutes(base, deps.staff)

  routes.get('/metrics', async () => Response.json(await metrics.overview()))
}
