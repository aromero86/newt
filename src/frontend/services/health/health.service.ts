import { inject } from '../../core/injector/inject'
import { Store } from '../../core/store/store'
import { HealthApi } from './health.api'

type Health = 'checking' | 'up' | 'down'

/** Whether the backend answers. The app shows it until there are real screens. */
export class HealthService {

  private readonly api = inject(HealthApi)
  private readonly store = new Store<{ health: Health }>({ health: 'checking' })

  readonly health = this.store.select('health')

  async check(): Promise<void> {
    this.store.patch({ health: 'checking' })
    try {
      await this.api.check()
      this.store.patch({ health: 'up' })
    } catch {
      this.store.patch({ health: 'down' })
    }
  }
}
