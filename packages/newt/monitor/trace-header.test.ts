import { describe, expect, test } from 'bun:test'
import { signTraceHeader, TRACE_HEADER_MAX_MS, verifyTraceHeader } from './trace-header'

const KEY = 'a key both sides share, long enough'
const now = new Date('2026-10-28T10:00:00Z')
const inAnHour = new Date(now.getTime() + 3_600_000)

describe('the x-newt-trace header', () => {
  test('is good with the key, until its end', () => {
    const header = signTraceHeader(KEY, inAnHour)

    expect(verifyTraceHeader(KEY, header, now)).toBe(true)
    expect(verifyTraceHeader(KEY, header, new Date(inAnHour.getTime() + 1))).toBe(false)
  })

  test('is not with another key, changed, or meant to last more than a day', () => {
    const header = signTraceHeader(KEY, inAnHour)
    const [, signature] = header.split('.')

    expect(verifyTraceHeader('another key, just as long as that one', header, now)).toBe(false)
    expect(verifyTraceHeader(KEY, `${inAnHour.getTime() + 1000}.${signature}`, now)).toBe(false)
    expect(verifyTraceHeader(KEY, signTraceHeader(KEY, new Date(now.getTime() + TRACE_HEADER_MAX_MS + 1)), now)).toBe(false)
    expect(verifyTraceHeader(KEY, 'nonsense', now)).toBe(false)
    expect(verifyTraceHeader(KEY, `${header}.more`, now)).toBe(false)
  })
})
