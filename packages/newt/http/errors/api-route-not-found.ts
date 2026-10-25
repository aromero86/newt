import { NotFoundError } from '../../core'
import { message } from '../../core/internal'

export class ApiRouteNotFound extends NotFoundError {
  readonly code = 'route_not_found'
  constructor(method: string, path: string) {
    super(message('route_not_found', { method, path }))
  }
}
