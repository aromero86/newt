# Un secreto que cifra

Cada aplicación que vigila el monitor comparte una clave con él, y el monitor firma cada
petición con esa clave ([apéndice H](../guide/h-describe-application)). Así que el
monitor tiene que guardar la clave misma, no un hash de ella como guarda el token de
una sesión: un hash no firma nada. La guarda cifrada, con un secreto propio que solo
vive en su entorno. Una copia de su base de datos, sin el secreto, no abre ninguna
clave.

Este capítulo escribe ese cifrado, antes del módulo que lo usa, con los tests que dicen
lo que debe rechazar.

Al final tendrás estos ficheros:

```
packages/newt-monitor/src/
  config.ts                     cambia: NEWT_MONITOR_SECRET
  testing/open-test-monitor.ts  cambia: el secreto del test
  shared/
    key-cipher.ts               sella y abre las claves de las aplicaciones
    key-cipher.test.ts
```

## El secreto

Una variable más sin valor por defecto, de 32 caracteres o más:

```ts
// packages/newt-monitor/src/config.ts
  /** What it encrypts the applications' keys with: no default, 32 characters or more. */
  NEWT_MONITOR_SECRET: z.string().min(MIN_SECRET_LENGTH),
```

Crea uno con `openssl rand -base64 48`. Perderlo pierde todas las claves que guarda el
monitor: habría que volver a darle su clave a cada aplicación. Cambiarlo, lo mismo.

## Sellar una clave

AES-256-GCM: cifra, y dice si lo que abre es lo que selló. Tres decisiones lo hacen
seguro aquí:

- **La clave se deriva del secreto** (HKDF-SHA256), nunca son los bytes del secreto
  mismo, bajo un nombre propio: el mismo secreto usado para otra cosa algún día da otra
  clave.
- **Un nonce nuevo para cada texto.** La misma clave sellada dos veces da dos textos
  distintos: nadie puede saber si dos aplicaciones comparten una.
- **A qué pertenece un texto va unido a él.** Cada clave se sella para el id de su
  aplicación (los *datos adicionales* de GCM). Una clave sellada copiada a la fila de
  otra aplicación no se abre allí.

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

El texto sellado dice primero su esquema, `v1`: algún día puede venir otro, y el
monitor leería los dos.

## Abrirla

Abrir lo comprueba todo a la vez: la etiqueta falla con otro secreto, otro dueño, o un
texto cambiado en el store. Cada caso es el mismo error, que dice qué mirar:

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

No es un error del dominio: nada de lo que envió un cliente está mal. Es la
configuración del monitor, y quien lo ejecuta lee su mensaje.

## Tests

Lo que importa es lo que debe rechazar:

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

Y un byte cambiado en el store, un texto que nunca se selló, un secreto demasiado
corto.

## Compruébalo

```sh
bun test packages/newt-monitor
```

## Qué recordar

- Un secreto que el monitor tiene que usar (para firmar) se cifra, no se pasa por un
  hash; uno que solo comprueba (el token de una sesión, una contraseña) se guarda como
  hash.
- AES-GCM, una clave derivada con HKDF, un nonce nuevo cada vez, y aquello a lo que
  pertenece el texto unido a él, para que no se pueda mover.
- El secreto vive solo en el entorno; sin él la base de datos no abre nada.

Siguiente: [las aplicaciones](./04-the-applications).
