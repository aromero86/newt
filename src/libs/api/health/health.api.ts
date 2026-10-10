import { Requester } from '../core/requester'

/** The backend's `health` module: whether it answers. */
export class HealthApi extends Requester {
  protected readonly path = '/health'

  check() {
    return this.get<{ status: 'ok' }>('')
  }
}
