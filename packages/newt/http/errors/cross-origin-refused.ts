import { ForbiddenError } from '../../core'
import { message } from '../../core/internal'

/**
 * A request that writes, sent by a page of another origin the route does not take
 * calls from (`cors`): what a forged form or script of another site would send.
 */
export class CrossOriginRefused extends ForbiddenError {
  readonly code = 'cross_origin_refused'
  constructor() {
    super(message('cross_origin_refused'))
  }
}
