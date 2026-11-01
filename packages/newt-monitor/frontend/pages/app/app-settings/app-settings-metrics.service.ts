import { FormStore, Store, inject } from 'newt-kit-react'
import { toast } from 'newt-kit-react-ui/toast'
import { z } from 'zod'
import { MIN_MINUTE_DAYS, RetentionApi } from '../../../api/retention'
import { AppService } from '../app.service'

const days = (most: number) => z.coerce.number<string>().int('Whole days').min(MIN_MINUTE_DAYS, `At least ${MIN_MINUTE_DAYS} days`).max(most, `At most ${most} days`)

/** The retention's form: days as typed; the daily summary's empty for ever. */
const RetentionSchema = z.object({
  minuteDays: days(3650),
  dayDays: z.union([z.literal('').transform(() => null), days(36500)]),
  resourceMinuteDays: days(3650),
  traceDays: z.coerce.number<string>().int('Whole days').min(1, 'At least a day').max(365, 'At most 365 days'),
})

type MetricsState = {
  loaded: boolean
}

/** How long an application's metrics are kept: changed here, applied at the next nightly keep. */
export class AppSettingsMetricsService {

  private readonly api = inject(RetentionApi)
  private readonly app = inject(AppService)
  private readonly store = new Store<MetricsState>({ loaded: false })

  /** Whether the retention it has was read: until then there is nothing to save over. */
  readonly loaded = this.store.select('loaded')
  readonly form = new FormStore(RetentionSchema, { minuteDays: '', dayDays: '', resourceMinuteDays: '', traceDays: '' })

  async load(): Promise<void> {
    try {
      const retention = await this.api.retention(this.app.appId)
      this.form.reset({ minuteDays: String(retention.minuteDays), dayDays: retention.dayDays === null ? '' : String(retention.dayDays), resourceMinuteDays: String(retention.resourceMinuteDays), traceDays: String(retention.traceDays) })
      this.store.patch({ loaded: true })
    } catch (error) {
      toast.error((error as Error).message)
    }
  }

  async save(): Promise<void> {
    await this.form.submit(async retention => {
      await this.api.change(this.app.appId, retention)
      toast.success('Saved: what is older goes tonight')
    })
  }
}
