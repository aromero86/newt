import { useSyncExternalStore } from 'react'
import { clock } from './clock'
import { relativeText } from './relative-text'

const full = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })

/** "2 days ago", with the exact date and time on hover and for machines; it reads again every minute. */
export function RelativeTime({ date }: { date: string }) {
  const now = useSyncExternalStore(clock.subscribe, clock.snapshot, clock.serverSnapshot)
  const at = new Date(date)
  return <time dateTime={date} title={full.format(at)}>{relativeText((at.getTime() - now) / 1000)}</time>
}
