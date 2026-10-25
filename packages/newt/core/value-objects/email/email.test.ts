import { describe, expect, test } from 'bun:test'
import { Email } from './email'
import { InvalidEmail } from './errors/invalid-email'

/** The longest address there can be: 64 characters, @, and a 189-character domain. */
const atMost = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.dev`

describe('Email', () => {
  test('is kept trimmed and in lower case: one address, whatever was typed', () => {
    expect(Email.from('  Lucia@Acme.dev ')).toBe('lucia@acme.dev' as Email)
  })

  test('refuses what is not an address, naming it as it was typed', () => {
    expect(() => Email.from(' Lucia ')).toThrow(InvalidEmail)
    expect(() => Email.from(' Lucia ')).toThrow("' Lucia ' is not a valid email")

    const error = new InvalidEmail('x')
    expect(error.status).toBe(400)
    expect(error.code).toBe('invalid_email')
  })

  test('takes up to 254 characters, the longest an address can be', () => {
    expect(atMost).toHaveLength(254)
    expect(Email.from(atMost)).toBe(atMost as Email)
    expect(() => Email.from(`${atMost}x`)).toThrow(InvalidEmail)
  })

  test('its schema only takes it as it is kept', () => {
    expect(Email.schema.safeParse('lucia@acme.dev').success).toBe(true)
    expect(Email.schema.safeParse('Lucia@acme.dev').success).toBe(false)
    expect(Email.schema.safeParse('lucia').success).toBe(false)
    expect(Email.schema.safeParse(`${atMost}x`).success).toBe(false)
  })
})
