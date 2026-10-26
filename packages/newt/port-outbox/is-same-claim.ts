import type { Job } from './job'

/**
 * Whether a write on a claimed job still belongs to its claim: each claim writes a
 * `lockedBy` no claim used before, and counts one more attempt, so once it was claimed
 * again (by another worker, by this one after its lease ran out, or after a `retry`
 * that started its attempts over) the claim before it changes nothing.
 */
export function isSameClaim(stored: Job, claimed: Job): boolean {
  return stored.status === 'running' && stored.lockedBy === claimed.lockedBy && stored.attempts === claimed.attempts
}
