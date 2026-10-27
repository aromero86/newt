import { describe, expect, test } from 'bun:test'
import { histogramBucketMs, histogramBucketOf, histogramPercentile } from './histogram'

describe('a duration histogram', () => {
  test('puts each time in a bucket that stands for it within 5%', () => {
    for (const ms of [0.3, 1, 7.5, 42, 180, 999, 12_345, 600_000]) {
      const near = histogramBucketMs(histogramBucketOf(ms))
      expect(Math.abs(near - ms) / ms).toBeLessThan(0.05)
    }
    expect(histogramBucketOf(0.01)).toBe(0)
  })

  test('says its percentiles from its buckets, summed however they came', () => {
    const histogram: Record<string, number> = {}
    for (let ms = 1; ms <= 100; ms++) {
      const bucket = String(histogramBucketOf(ms))
      histogram[bucket] = (histogram[bucket] ?? 0) + 1
    }
    expect(histogramPercentile(histogram, 50)).toBeCloseTo(50, -0.7)
    expect(histogramPercentile(histogram, 99)! / 99).toBeGreaterThan(0.95)
    expect(histogramPercentile({}, 50)).toBeNull()
  })
})
