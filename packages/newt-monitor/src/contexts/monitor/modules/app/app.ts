import type { z } from 'zod'
import { Entity, type EntityInput } from 'newt/core'
import type { KeyCipher } from '../../../../shared/key-cipher'
import { AppPublicSchema, AppSchema } from './app.schema'
import { App_Registered } from './events/app-registered'
import { App_Updated } from './events/app-updated'

export * from './app.schema'

type Fields = { name: string, url: string, key: string }

/**
 * An application the monitor watches. Its key is sealed for it, by its own id: the
 * entity seals it and opens it, and `toDTO` never shows it.
 */
export class App extends Entity<typeof AppSchema, typeof AppPublicSchema> {

  private constructor(input: EntityInput<z.infer<typeof AppSchema>>, isNew: boolean) {
    super(AppSchema, input, isNew, AppPublicSchema)
  }

  static fromDTO(dto: z.infer<typeof AppSchema> & { version: number }): App {
    return new App(dto, false)
  }

  static register({ name, url, key }: Fields, cipher: KeyCipher): App {
    const id = Bun.randomUUIDv7()
    const app = new App({ id, name, url, sealedKey: cipher.seal(key, id) }, true)
    app.trackEvent(new App_Registered(app.toDTO()))
    return app
  }

  get name(): string {
    return this.data.name
  }

  get url(): string {
    return this.data.url
  }

  /** Its key, opened: only to sign a request with. */
  key(cipher: KeyCipher): string {
    return cipher.open(this.data.sealedKey, this.id)
  }

  /** Changes what is given and differs; tells which fields did, if any. */
  update(change: Partial<Fields>, cipher: KeyCipher): void {
    const changed: ('name' | 'url' | 'key')[] = []
    if (change.name !== undefined && change.name !== this.data.name) changed.push('name')
    if (change.url !== undefined && change.url !== this.data.url) changed.push('url')
    if (change.key !== undefined && change.key !== this.key(cipher)) changed.push('key')
    if (changed.length === 0) return
    this.change({
      ...(changed.includes('name') ? { name: change.name } : {}),
      ...(changed.includes('url') ? { url: change.url } : {}),
      ...(changed.includes('key') ? { sealedKey: cipher.seal(change.key!, this.id) } : {}),
    })
    this.trackEvent(new App_Updated({ dto: this.toDTO(), changed }))
  }
}

