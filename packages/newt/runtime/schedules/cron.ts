/** Each field of a cron expression, in order: its name, and the values it takes. */
const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
] as const

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
/** How far it looks for a time: past any expression that can match (a 29th of February on a Monday). */
const SEARCH_DAYS = 366 * 28

/**
 * When something is due, as a standard cron expression says, in UTC: five fields
 * (minute, hour, day of month, month, day of week, 0 or 7 being Sunday), each `*`, a
 * value, a range (`1-5`), a step over either or over `*` (`0-30/10`; `5/15`, from 5
 * on) or a list of them (`0,30`). As cron does, when both days are given (neither starts with `*`) a day
 * that matches either is due.
 */
export class Cron {

  private constructor(
    readonly expression: string,
    private readonly minutes: Set<number>,
    private readonly hours: Set<number>,
    private readonly days: Set<number>,
    private readonly months: Set<number>,
    private readonly weekdays: Set<number>,
    /** Whether both days are given, so either one is enough. */
    private readonly eitherDay: boolean,
  ) {}

  static parse(expression: string): Cron {
    const parts = expression.trim().split(/\s+/)
    if (parts.length !== 5) throw new Error(`A cron expression has five fields (minute hour day-of-month month day-of-week): '${expression}' has ${parts.length}`)
    const [minutes, hours, days, months, weekdays] = parts.map((part, i) => values(part, FIELDS[i]!, expression))
    if (weekdays!.has(7)) weekdays!.add(0)
    return new Cron(expression, minutes!, hours!, days!, months!, weekdays!, !parts[2]!.startsWith('*') && !parts[4]!.startsWith('*'))
  }

  /** The first time it is due after `time`, to the minute. */
  next(time: Date): Date {
    const from = Math.floor(time.getTime() / MINUTE) * MINUTE + MINUTE
    for (let day = startOfDay(from); day < from + SEARCH_DAYS * DAY; day += DAY) {
      if (!this.isDue(day)) continue
      const first = this.minuteOf(day, minute => minute >= from, 1)
      if (first !== undefined) return new Date(first)
    }
    throw new Error(`The cron expression '${this.expression}' is never due`)
  }

  /** The last time it was due at or before `time`, to the minute. */
  latest(time: Date): Date {
    const until = Math.floor(time.getTime() / MINUTE) * MINUTE
    for (let day = startOfDay(until); day > until - SEARCH_DAYS * DAY; day -= DAY) {
      if (!this.isDue(day)) continue
      const last = this.minuteOf(day, minute => minute <= until, -1)
      if (last !== undefined) return new Date(last)
    }
    throw new Error(`The cron expression '${this.expression}' is never due`)
  }

  /** Whether the day that starts at `day` is one it is due on. */
  private isDue(day: number): boolean {
    const date = new Date(day)
    if (!this.months.has(date.getUTCMonth() + 1)) return false
    const onDay = this.days.has(date.getUTCDate())
    const onWeekday = this.weekdays.has(date.getUTCDay())
    return this.eitherDay ? onDay || onWeekday : onDay && onWeekday
  }

  /** Its first (`direction` 1) or last (-1) minute of that day that `takes` takes. */
  private minuteOf(day: number, takes: (minute: number) => boolean, direction: 1 | -1): number | undefined {
    const hours = [...this.hours].sort((a, b) => (a - b) * direction)
    const minutes = [...this.minutes].sort((a, b) => (a - b) * direction)
    for (const hour of hours) {
      for (const minute of minutes) {
        const time = day + hour * 60 * MINUTE + minute * MINUTE
        if (takes(time)) return time
      }
    }
    return undefined
  }
}

function startOfDay(time: number): number {
  return Math.floor(time / DAY) * DAY
}

/** The values one field takes. */
function values(part: string, field: (typeof FIELDS)[number], expression: string): Set<number> {
  const taken = new Set<number>()
  const wrong = () => new Error(`'${part}' is not a ${field.name} (${field.min}-${field.max}) in the cron expression '${expression}'`)
  const number = (text: string) => {
    if (!/^\d+$/.test(text)) throw wrong()
    const value = Number(text)
    if (value < field.min || value > field.max) throw wrong()
    return value
  }
  for (const item of part.split(',')) {
    const [range, step, ...rest] = item.split('/')
    if (rest.length > 0 || range === undefined) throw wrong()
    const every = step === undefined ? 1 : number(step)
    if (every < 1) throw wrong()
    const [from, to] = range === '*'
      ? [field.min, field.max]
      : range.includes('-')
        ? range.split('-').map(number) as [number, number]
        : [number(range), step === undefined ? number(range) : field.max]
    if (range.split('-').length > 2 || from > to) throw wrong()
    for (let value = from; value <= to; value += every) taken.add(value)
  }
  return taken
}
