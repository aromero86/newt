import { describe, expect, test } from 'bun:test'
import { SecretToken } from './secret-token'

describe('SecretToken', () => {
  test('is 32 random bytes in base64url, a new one each time', () => {
    const token = SecretToken.generate()

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(SecretToken.generate()).not.toBe(token)
  })

  test('takes back only what it could have generated', () => {
    const token = SecretToken.generate()

    expect(SecretToken.from(token)).toBe(token)
    expect(() => SecretToken.from('short')).toThrow()
    expect(() => SecretToken.from(`${token}A`)).toThrow()
    expect(() => SecretToken.from(` ${token}`)).toThrow()
    for (const char of ['+', '/', '.', '=']) {
      expect(() => SecretToken.from(`${'A'.repeat(42)}${char}`)).toThrow()
    }
  })

  test('hashes with SHA-256: stored hashes depend on it never changing', () => {
    const token = SecretToken.from('A'.repeat(43))
    expect(SecretToken.hash(token)).toBe('0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a')
  })
})
