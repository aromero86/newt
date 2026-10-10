import type { Base } from '../../base/base'
import { Module } from '../../core/module/module'
import { UseCase } from '../../core/unit-of-work/use-case.decorator'
import { registerHealthRoutes } from './health.routes'

export class Health_Module extends Module {

  static async initialize(base: Base) {
    const module = new Health_Module(base)
    registerHealthRoutes(base, module)
    return module
  }

  private constructor(base: Base) {
    super('health', base.transactions)
  }

  @UseCase('health.check')
  async check() {
    return { status: 'ok' as const }
  }
}
