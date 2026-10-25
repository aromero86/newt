import type { Job } from './job'

/**
 * Whether a write on a claimed job still belongs to its claim: each claim counts one
 * more attempt, so once it was claimed again (by another worker, or by this one after
 * its lease ran out) the claim before it changes nothing.
 */
export function isSameClaim(stored: Job, claimed: Job): boolean {
  return stored.status === 'running' && stored.attempts === claimed.attempts
}
