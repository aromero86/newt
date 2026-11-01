import { message } from '../messages/message'
import { DomainError } from './domain-error'

/**
 * Someone did something more often than a rate limit lets them: a 429, with how long
 * to wait in its `Retry-After`. `limit` names the one they ran into.
 */
export class TooManyRequests extends DomainError {
  readonly status = 429
  readonly code = 'too_many_requests'
  constructor(readonly limit: string, readonly retryAfterMs: number) {
    super(message('too_many_requests', { retryAfterSeconds: Math.ceil(retryAfterMs / 1000) }))
  }
}
