import { describe, expect, test } from 'bun:test'
import { KeyCipher, SealedKeyUnreadable } from './key-cipher'

const SECRET = 'the monitor\'s own secret, long enough'
const KEY = 'an application\'s monitor key, long enough too'

describe('KeyCipher', () => {
  const cipher = new KeyCipher(SECRET)

  test('opens what it sealed, for the same owner', () => {
    expect(cipher.open(cipher.seal(KEY, 'app-1'), 'app-1')).toBe(KEY)
  })

  test('seals the same text differently each time, and never shows it', () => {
    const first = cipher.seal(KEY, 'app-1')
    const second = cipher.seal(KEY, 'app-1')

    expect(first).not.toBe(second)
    expect(first).toStartWith('v1.')
    expect(first).not.toContain(KEY)
  })

  test('does not open a text sealed for another owner: a key moved to another row', () => {
    expect(() => cipher.open(cipher.seal(KEY, 'app-1'), 'app-2')).toThrow(SealedKeyUnreadable)
  })

  test('does not open a text changed in the store', () => {
    const [version, nonce, text, tag] = cipher.seal(KEY, 'app-1').split('.')
    const changed = Buffer.from(text!, 'base64url')
    changed[0] = changed[0]! ^ 1

    expect(() => cipher.open([version, nonce, changed.toString('base64url'), tag].join('.'), 'app-1')).toThrow(SealedKeyUnreadable)
    expect(() => cipher.open('not sealed at all', 'app-1')).toThrow(SealedKeyUnreadable)
  })

  test('does not open with another secret: a copy of the database opens nothing', () => {
    const other = new KeyCipher('another secret, every bit as long')

    expect(() => other.open(cipher.seal(KEY, 'app-1'), 'app-1')).toThrow(SealedKeyUnreadable)
  })

  test('refuses a secret too short to be one', () => {
    expect(() => new KeyCipher('short')).toThrow('at least 32 characters')
  })
})
