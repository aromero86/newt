import { describe, expect, test } from 'bun:test'
import { Cron } from './cron'

const next = (expression: string, after: string) => Cron.parse(expression).next(new Date(after)).toISOString()
const latest = (expression: string, at: string) => Cron.parse(expression).latest(new Date(at)).toISOString()

describe('Cron', () => {
  test('is due at the minute and hour it names, every day, in UTC', () => {
    expect(next('0 3 * * *', '2026-01-01T02:59:59.000Z')).toBe('2026-01-01T03:00:00.000Z')
    expect(next('0 3 * * *', '2026-01-01T03:00:00.000Z')).toBe('2026-01-02T03:00:00.000Z')
    expect(latest('0 3 * * *', '2026-01-01T03:00:00.000Z')).toBe('2026-01-01T03:00:00.000Z')
    expect(latest('0 3 * * *', '2026-01-01T02:59:00.000Z')).toBe('2025-12-31T03:00:00.000Z')
  })

  test('takes every minute, lists, ranges and steps', () => {
    expect(next('* * * * *', '2026-01-01T10:00:30.000Z')).toBe('2026-01-01T10:01:00.000Z')
    expect(next('*/15 * * * *', '2026-01-01T10:16:00.000Z')).toBe('2026-01-01T10:30:00.000Z')
    expect(next('0,30 9-17 * * *', '2026-01-01T17:30:00.000Z')).toBe('2026-01-02T09:00:00.000Z')
    expect(next('0-30/10 * * * *', '2026-01-01T10:31:00.000Z')).toBe('2026-01-01T11:00:00.000Z')
    expect(next('5/20 * * * *', '2026-01-01T10:46:00.000Z')).toBe('2026-01-01T11:05:00.000Z')
    expect(latest('0-30/10 * * * *', '2026-01-01T10:59:00.000Z')).toBe('2026-01-01T10:30:00.000Z')
  })

  test('takes days of the month, months and days of the week, Sunday being 0 or 7', () => {
    // 2026-01-01 is a Thursday.
    expect(next('0 0 1 * *', '2026-01-01T00:00:00.000Z')).toBe('2026-02-01T00:00:00.000Z')
    expect(next('0 0 * 6 *', '2026-01-01T00:00:00.000Z')).toBe('2026-06-01T00:00:00.000Z')
    expect(next('0 9 * * 1-5', '2026-01-02T09:00:00.000Z')).toBe('2026-01-05T09:00:00.000Z')
    expect(next('0 9 * * 0', '2026-01-01T00:00:00.000Z')).toBe('2026-01-04T09:00:00.000Z')
    expect(next('0 9 * * 7', '2026-01-01T00:00:00.000Z')).toBe('2026-01-04T09:00:00.000Z')
    expect(latest('0 9 * * 1', '2026-01-01T00:00:00.000Z')).toBe('2025-12-29T09:00:00.000Z')
  })

  test('given both days, is due on either, as cron is', () => {
    // The 15th, and every Sunday.
    expect(next('0 0 15 * 0', '2026-01-01T00:00:00.000Z')).toBe('2026-01-04T00:00:00.000Z')
    expect(next('0 0 15 * 0', '2026-01-11T00:00:00.000Z')).toBe('2026-01-15T00:00:00.000Z')
    // A day of the month with any day of the week is only that day.
    expect(next('0 0 15 * *', '2026-01-01T00:00:00.000Z')).toBe('2026-01-15T00:00:00.000Z')
  })

  test('finds a day that comes seldom: the 29th of February', () => {
    expect(next('0 0 29 2 *', '2026-01-01T00:00:00.000Z')).toBe('2028-02-29T00:00:00.000Z')
    expect(latest('0 0 29 2 *', '2026-01-01T00:00:00.000Z')).toBe('2024-02-29T00:00:00.000Z')
  })

  test('refuses what is not a cron expression', () => {
    expect(() => Cron.parse('0 3 * *')).toThrow('five fields')
    expect(() => Cron.parse('60 * * * *')).toThrow("'60' is not a minute")
    expect(() => Cron.parse('* 24 * * *')).toThrow('hour')
    expect(() => Cron.parse('* * 0 * *')).toThrow('day of month')
    expect(() => Cron.parse('* * * 13 *')).toThrow('month')
    expect(() => Cron.parse('* * * * 8')).toThrow('day of week')
    expect(() => Cron.parse('*/0 * * * *')).toThrow()
    expect(() => Cron.parse('5-1 * * * *')).toThrow()
    expect(() => Cron.parse('1-2-3 * * * *')).toThrow()
    expect(() => Cron.parse('a * * * *')).toThrow()
    expect(() => Cron.parse('0 0 31 2 *').next(new Date())).toThrow('never due')
  })
})
