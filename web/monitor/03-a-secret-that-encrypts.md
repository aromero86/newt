# A secret that encrypts

Each application the monitor watches shares a key with it, and the monitor signs every
request with that key ([appendix H](../guide/h-describe-application)). So the monitor
must keep the key itself, not a hash of it as it keeps a session's token: a hash
signs nothing. It keeps it encrypted, with a secret of its own that lives only in its
environment. A copy of its database, without the secret, opens no key.

This chapter writes that encryption, before the module that uses it, with the tests
that say what it must refuse.

At the end you will have these files:

```
packages/newt-monitor/src/
  config.ts                     changed: NEWT_MONITOR_SECRET
  testing/open-test-monitor.ts  changed: the test's secret
  shared/
    key-cipher.ts               seals and opens the applications' keys
    key-cipher.test.ts
```

## The secret

One more variable with no default, 32 characters or more:

```ts
// packages/newt-monitor/src/config.ts
  /** What it encrypts the applications' keys with: no default, 32 characters or more. */
  NEWT_MONITOR_SECRET: z.string().min(MIN_SECRET_LENGTH),
```

Make one with `openssl rand -base64 48`. Losing it loses every key the monitor keeps:
each application would have to be given its key again. Changing it, the same.

## Sealing a key

AES-256-GCM: it encrypts, and it says whether what it opens is what it sealed. Three
choices make it safe here:

- **The key is derived from the secret** (HKDF-SHA256), never the secret's bytes
  themselves, under a name of its own: the same secret used for something else one day
  gives another key.
- **A new nonce for every text.** The same key sealed twice gives two different texts:
  nobody can tell two applications share one.
- **What a text belongs to is bound to it.** Each key is sealed for its application's
  id (GCM's *additional data*). A sealed key copied to another application's row does
  not open there.

```ts
// packages/newt-monitor/src/shared/key-cipher.ts
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
```

The sealed text says its scheme first, `v1`: another scheme can come one day, and the
monitor read both.

## Opening it

Opening checks everything at once: the tag fails for another secret, another owner, or
a text changed in the store. Each is the same error, which says what to look at:

```ts
// packages/newt-monitor/src/shared/key-cipher.ts
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
```

It is no domain error: nothing a client sent is wrong. It is the monitor's
configuration, and whoever runs it reads its message.

## Tests

What it must refuse is what matters:

```ts
// packages/newt-monitor/src/shared/key-cipher.test.ts
  test('does not open a text sealed for another owner: a key moved to another row', () => {
    expect(() => cipher.open(cipher.seal(KEY, 'app-1'), 'app-2')).toThrow(SealedKeyUnreadable)
  })
```

```ts
// packages/newt-monitor/src/shared/key-cipher.test.ts
  test('does not open with another secret: a copy of the database opens nothing', () => {
    const other = new KeyCipher('another secret, every bit as long')

    expect(() => other.open(cipher.seal(KEY, 'app-1'), 'app-1')).toThrow(SealedKeyUnreadable)
  })
```

And a byte changed in the store, a text that was never sealed, a secret too short.

## Check it

```sh
bun test packages/newt-monitor
```

## What to remember

- A secret the monitor must use (to sign) is encrypted, not hashed; one it only checks
  (a session's token, a password) is hashed.
- AES-GCM, a key derived with HKDF, a new nonce each time, and what the text belongs to
  bound to it, so it cannot be moved.
- The secret lives in the environment only; without it the database opens nothing.

Next: [the applications](./04-the-applications).
