/** Each bucket of a duration histogram is this much longer than the one before: 10%, so a percentile is within ±5%. */
export const HISTOGRAM_GROWTH = 1.1
/** The shortest time a histogram tells apart: anything quicker is in bucket 0. */
export const HISTOGRAM_FLOOR_MS = 0.1

/** The bucket a duration falls in: 0 up to 0.1 ms, then one every 10%. */
export function histogramBucketOf(ms: number): number {
  return ms <= HISTOGRAM_FLOOR_MS ? 0 : Math.ceil(Math.log(ms / HISTOGRAM_FLOOR_MS) / Math.log(HISTOGRAM_GROWTH))
}

/** The time a bucket stands for: the middle of its range, as near as ±5% to any time in it. */
export function histogramBucketMs(bucket: number): number {
  return bucket === 0 ? HISTOGRAM_FLOOR_MS / 2 : HISTOGRAM_FLOOR_MS * HISTOGRAM_GROWTH ** (bucket - 0.5)
}

/** A percentile (0 to 100) of a histogram, by bucket: null for one with nothing in it. */
export function histogramPercentile(histogram: Record<string, number>, percentile: number): number | null {
  const buckets = Object.entries(histogram).map(([bucket, count]) => [Number(bucket), count] as const).filter(([, count]) => count > 0).sort(([a], [b]) => a - b)
  const total = buckets.reduce((sum, [, count]) => sum + count, 0)
  if (total === 0) return null
  const rank = Math.max(1, Math.ceil((percentile / 100) * total))
  let seen = 0
  for (const [bucket, count] of buckets) {
    seen += count
    if (seen >= rank) return histogramBucketMs(bucket)
  }
  return histogramBucketMs(buckets.at(-1)![0])
}
