import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/** The shortest secret the monitor encrypts with. */
export const MIN_SECRET_LENGTH = 32

/** What names the scheme in a sealed text, so another can come later and both be read. */
const VERSION = 'v1'

/**
 * Seals and opens the keys of the applications the monitor watches: it needs them to
 * sign its requests, so it cannot keep only their hash, as it does a session's token.
 *
 * AES-256-GCM, with a key derived from the monitor's secret (HKDF-SHA256), a new nonce
 * for every text, and what each text belongs to (its application's id) bound to it:
 * a sealed key moved to another application's row does not open there. A sealed text
 * changed in the store does not open at all. Without the secret, a copy of the
 * database opens nothing.
 */
export class KeyCipher {

  private readonly key: Buffer

  constructor(secret: string) {
    if (secret.length < MIN_SECRET_LENGTH) throw new Error(`The secret has at least ${MIN_SECRET_LENGTH} characters`)
    this.key = Buffer.from(hkdfSync('sha256', secret, '', 'newt-monitor key cipher v1', 32))
  }

  /** `text`, sealed for `owner`: `v1.<nonce>.<ciphertext>.<tag>`, each part base64url. */
  seal(text: string, owner: string): string {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce).setAAD(Buffer.from(owner))
    const sealed = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    return [VERSION, nonce, sealed, cipher.getAuthTag()].map(part => (typeof part === 'string' ? part : part.toString('base64url'))).join('.')
  }

  /** The text `sealed` was, if it was sealed for `owner` with this secret and not changed since. */
  open(sealed: string, owner: string): string {
    const [version, nonce, text, tag] = sealed.split('.')
    if (version !== VERSION || !nonce || !text || !tag) throw new SealedKeyUnreadable()
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(nonce, 'base64url')).setAAD(Buffer.from(owner))
      decipher.setAuthTag(Buffer.from(tag, 'base64url'))
      return Buffer.concat([decipher.update(Buffer.from(text, 'base64url')), decipher.final()]).toString('utf8')
    } catch {
      throw new SealedKeyUnreadable()
    }
  }
}

/** A sealed key that does not open: another secret sealed it, or it was changed, or moved. */
export class SealedKeyUnreadable extends Error {
  constructor() {
    super('A key the monitor keeps does not open: NEWT_MONITOR_SECRET is not the one it was sealed with, or the stored key was changed')
  }
}
