import type { Base } from '../../base/base'
import type { Health_Module } from './health.module'

export function registerHealthRoutes(base: Base, health: Health_Module) {
  base.http.get('/health', async () => Response.json(await health.check()), { public: true })
}
