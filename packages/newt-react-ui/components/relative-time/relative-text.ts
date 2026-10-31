/** Each unit, smallest first, with its size in seconds and the count of it that reads as the next unit. */
const units: [Intl.RelativeTimeFormatUnit, number, number][] = [
  ['second', 1, 60],
  ['minute', 60, 60],
  ['hour', 3600, 24],
  ['day', 24 * 3600, 7],
  ['week', 7 * 24 * 3600, 5],
  ['month', 30 * 24 * 3600, 12],
  ['year', 365 * 24 * 3600, Infinity],
]

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** "2 days ago" for two days back in seconds: the count is rounded first, so 59.6 minutes reads as an hour, never "60 minutes". */
export function relativeText(seconds: number): string {
  for (const [unit, size, next] of units) {
    const count = Math.round(Math.abs(seconds) / size)
    if (count >= next) continue
    if (unit === 'second') return 'just now'
    return relative.format(Math.sign(seconds) * count, unit)
  }
  return ''
}
