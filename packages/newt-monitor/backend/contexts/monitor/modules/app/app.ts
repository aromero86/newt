import type { z } from 'zod'
import { Entity, now, type EntityInput } from '@newt-kit/newt/core'
import { SealedKeyUnreadable, type KeyCipher } from '../../../../shared/key-cipher'
import { AppPublicSchema, AppSchema } from './app.schema'
import { AppNotArchived } from './errors/app-not-archived'
import { App_Archived } from './events/app-archived'
import { App_Deleted } from './events/app-deleted'
import { App_Registered } from './events/app-registered'
import { App_Restored } from './events/app-restored'
import { App_Updated } from './events/app-updated'

export * from './app.schema'

type Fields = { name: string, url: string, key: string, repository?: string | null }

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

  static register({ name, url, key, repository }: Fields, cipher: KeyCipher): App {
    const id = Bun.randomUUIDv7()
    const app = new App({ id, name, url, sealedKey: cipher.seal(key, id), repository: repository ?? null, archivedAt: null }, true)
    app.trackEvent(new App_Registered(app.toDTO()))
    return app
  }

  get name(): string {
    return this.data.name
  }

  get url(): string {
    return this.data.url
  }

  get isArchived(): boolean {
    return this.data.archivedAt !== null
  }

  /** Its key, opened: only to sign a request with. */
  key(cipher: KeyCipher): string {
    return cipher.open(this.data.sealedKey, this.id)
  }

  /** Whether its key is this one: not when the one it keeps no longer opens, which is why it is given again. */
  private holds(key: string, cipher: KeyCipher): boolean {
    try {
      return this.key(cipher) === key
    } catch (error) {
      if (error instanceof SealedKeyUnreadable) return false
      throw error
    }
  }

  /** Changes what is given and differs; tells which fields did, if any. */
  update(change: Partial<Fields>, cipher: KeyCipher): void {
    const changed: ('name' | 'url' | 'key' | 'repository')[] = []
    if (change.name !== undefined && change.name !== this.data.name) changed.push('name')
    if (change.url !== undefined && change.url !== this.data.url) changed.push('url')
    if (change.key !== undefined && !this.holds(change.key, cipher)) changed.push('key')
    if (change.repository !== undefined && change.repository !== this.data.repository) changed.push('repository')
    if (changed.length === 0) return
    this.change({
      ...(changed.includes('name') ? { name: change.name } : {}),
      ...(changed.includes('url') ? { url: change.url } : {}),
      ...(changed.includes('key') ? { sealedKey: cipher.seal(change.key!, this.id) } : {}),
      ...(changed.includes('repository') ? { repository: change.repository } : {}),
    })
    this.trackEvent(new App_Updated({ dto: this.toDTO(), changed }))
  }

  /** No longer watched, all it was kept. Archiving one archived is archiving it once. */
  archive(): void {
    if (this.isArchived) return
    this.change({ archivedAt: now().toISOString() })
    this.trackEvent(new App_Archived(this.toDTO()))
  }

  /** Watched again. */
  restore(): void {
    if (!this.isArchived) return
    this.change({ archivedAt: null })
    this.trackEvent(new App_Restored(this.toDTO()))
  }

  /** Gone for good, with all the monitor knows of it: only once it is archived. */
  delete(): void {
    if (!this.isArchived) throw new AppNotArchived(this.name)
    this.markAsDeleted()
    this.trackEvent(new App_Deleted({ id: this.id, name: this.name }))
  }
}
