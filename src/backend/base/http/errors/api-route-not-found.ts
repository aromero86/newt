import { NotFoundError } from '../../../core/errors/not-found-error'

export class ApiRouteNotFound extends NotFoundError {
  readonly code = 'api.route_not_found'
  constructor(method: string, path: string) {
    super(`No API route for ${method} ${path}`)
  }
}
