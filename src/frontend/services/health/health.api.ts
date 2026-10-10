import { Requester } from '../../core/requester/requester'

export class HealthApi extends Requester {
  protected readonly path = '/health'

  check() {
    return this.get<{ status: 'ok' }>('')
  }
}
