import { describe, expect, test } from 'bun:test'
import { isSameClaim } from './is-same-claim'
import type { Job } from './job'

const job = (over: Partial<Job> = {}): Job => ({
  id: 'j1',
  queue: 'notification.orderPlaced.on.order.placed',
  event: '{}',
  status: 'running',
  attempts: 2,
  runAfter: '',
  lockedBy: 'worker-1',
  lockedUntil: '',
  lastError: null,
  createdAt: '',
  updatedAt: '',
  ...over,
})

describe('isSameClaim', () => {
  test('a write belongs to the claim that is still running', () => {
    expect(isSameClaim(job(), job())).toBe(true)
  })

  test('once claimed again, the claim before it changes nothing', () => {
    expect(isSameClaim(job({ attempts: 3 }), job({ attempts: 2 }))).toBe(false)
  })

  test('a job no longer running belongs to no claim', () => {
    for (const status of ['pending', 'done', 'dead'] as const) {
      expect(isSameClaim(job({ status }), job())).toBe(false)
    }
  })
})
