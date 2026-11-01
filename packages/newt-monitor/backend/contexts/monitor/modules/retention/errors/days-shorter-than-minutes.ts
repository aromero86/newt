import { ValidationError } from 'newt-kit/core'

/** Daily summaries kept for less time than the minutes they are made of: the days between would read as nothing. */
export class DaysShorterThanMinutes extends ValidationError {
  readonly code = 'retention.days_shorter_than_minutes'
  constructor(dayDays: number, minuteDays: number) {
    super(`The days cannot be kept for ${dayDays} days while the minutes are kept for ${minuteDays}`)
  }
}
