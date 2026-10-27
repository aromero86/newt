const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
const full = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

/** "2 days ago", with the exact date and time on hover and for machines. */
export function RelativeTime({ date }: { date: string }) {
  const at = new Date(date)
  const seconds = (at.getTime() - Date.now()) / 1000
  const [unit, size] = units.find(([, each]) => Math.abs(seconds) >= each) ?? ['second', 1]
  const text = unit === 'second' ? 'just now' : relative.format(Math.round(seconds / size), unit)
  return <time dateTime={date} title={full.format(at)}>{text}</time>
}
