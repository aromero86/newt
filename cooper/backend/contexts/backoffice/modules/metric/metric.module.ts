import { Module, UseCase } from 'newt/core'
import type { TenantDTO } from '../../../auth/modules/tenant/tenant.schema'
import type { UserDTO } from '../../../auth/modules/user/user.schema'
import type { CardDTO } from '../../../boards/modules/card/card.schema'
import type { CooperBase } from '../../../../shared/cooper-base'
import type { Metric_Deps } from './metric.deps'
import type { Metric_Options } from './metric-options'
import { registerMetricRoutes } from './metric.routes'
import { METRIC_DATASETS, type DayCountDTO, type MetricsOverviewDTO } from './metric.schema'
import { registerMetricWorkers } from './metric.workers'

const DAY_MS = 24 * 60 * 60_000

/** The day of a moment, in UTC: `2026-10-26`. */
const dayOf = (iso: string) => iso.slice(0, 10)

/**
 * cooper's numbers: cards made, workspaces opened, people signed up. They are a
 * projection (ch. 28): the truth lives in auth and boards, with their transactions;
 * workers follow their events and append a row for each to the analytics, which
 * this module reads back added up. It is a moment behind, and never in the way of
 * what it counts.
 */
export class Metric_Module extends Module {

  static initialize(base: CooperBase, deps: Metric_Deps, options: Metric_Options): Metric_Module {
    const module = new Metric_Module(base, options)
    registerMetricRoutes(base, module, deps)
    registerMetricWorkers(module, deps)
    return module
  }

  private constructor(base: CooperBase, private readonly options: Metric_Options) {
    super('metric', base.invocations)
  }

  /** A card was made, in a board of a workspace. */
  @UseCase()
  async recordCard(card: CardDTO): Promise<void> {
    await this.options.analytics.append(METRIC_DATASETS.cardCreated, [{ id: card.id, workspaceId: card.workspaceId, day: dayOf(card.createdAt) }])
  }

  /** A workspace was made. */
  @UseCase()
  async recordWorkspace(tenant: TenantDTO): Promise<void> {
    await this.options.analytics.append(METRIC_DATASETS.workspaceCreated, [{ id: tenant.id, day: dayOf(tenant.createdAt) }])
  }

  /** Someone made an account. */
  @UseCase()
  async recordSignUp(user: UserDTO): Promise<void> {
    await this.options.analytics.append(METRIC_DATASETS.userSignedUp, [{ id: user.id, day: dayOf(user.createdAt) }])
  }

  /** The totals, and each of the last days, today included. */
  @UseCase()
  async overview(): Promise<MetricsOverviewDTO> {
    const days = this.lastDays()
    const { analytics } = this.options
    const [cards, workspaces, signUps, cardsPerDay, workspacesPerDay, signUpsPerDay] = await Promise.all([
      analytics.count(METRIC_DATASETS.cardCreated),
      analytics.count(METRIC_DATASETS.workspaceCreated),
      analytics.count(METRIC_DATASETS.userSignedUp),
      this.perDay(METRIC_DATASETS.cardCreated, days),
      this.perDay(METRIC_DATASETS.workspaceCreated, days),
      this.perDay(METRIC_DATASETS.userSignedUp, days),
    ])
    return { totals: { cards, workspaces, signUps }, cardsPerDay, workspacesPerDay, signUpsPerDay }
  }

  /** How many rows of a dataset each day has, a day with none too. */
  private async perDay(dataset: string, days: string[]): Promise<DayCountDTO[]> {
    const counts = new Map((await this.options.analytics.countBy(dataset, 'day', { from: days[0] })).map(each => [each.value, each.count]))
    return days.map(day => ({ day, count: counts.get(day) ?? 0 }))
  }

  /** The days the overview shows, the oldest first and today last. */
  private lastDays(): string[] {
    const today = Date.now()
    return Array.from({ length: this.options.days }, (_, index) => dayOf(new Date(today - (this.options.days - 1 - index) * DAY_MS).toISOString()))
  }
}
