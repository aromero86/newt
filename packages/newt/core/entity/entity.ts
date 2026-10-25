import type { z } from 'zod'
import type { DomainEvent } from '../events/domain-event'
import { DeletedEntityNotChangeable } from './errors/deleted-entity-not-changeable'
import { EntityAlreadyDeleted } from './errors/entity-already-deleted'
import { NewEntityNotDeletable } from './errors/new-entity-not-deletable'
import { UnknownEntityField } from './errors/unknown-entity-field'
import type { EntityInput } from './entity-input'
import { markPersisted } from './mark-persisted'
import { takeEvents } from './take-events'
import type { EntitySchema } from './entity-schema'

type Fields = Record<string, unknown>

export class Entity<TSchema extends EntitySchema> {
  private initial: z.infer<TSchema> | null
  private current: z.infer<TSchema>
  private _isNew: boolean
  private _version: number

  private domainEvents: DomainEvent[] = []
  private _deleted = false

  protected constructor(
    protected readonly schema: TSchema,
    input: EntityInput<z.infer<TSchema>>,
    isNew: boolean,
  ) {
    const id = input.id ?? Bun.randomUUIDv7()
    if (!isNew && input.version === undefined) throw new Error(`${new.target.name} read from storage comes with its version`)

    this.current = schema.parse({ ...input, id }) as z.infer<TSchema>

    if (isNew) {
      const now = new Date().toISOString()
      ;(this.current as Fields).createdAt = now
      ;(this.current as Fields).updatedAt = now
    }

    this.initial = isNew ? null : structuredClone(this.current)
    this._isNew = isNew
    this._version = isNew ? 0 : input.version!
  }

  get isNew(): boolean {
    return this._isNew
  }

  /**
   * How many times it was saved: 0 until it is. Saving it checks it is still the one
   * stored, so whoever saved it meanwhile is never overwritten.
   */
  get version(): number {
    return this._version
  }

  /** Whether saving it would write anything: new, deleted or changed. */
  get hasPendingChanges(): boolean {
    return this._isNew || this._deleted || this.getChanges() !== null
  }

  /** Its repository saved it: it is now what is stored, one version on. */
  [markPersisted](): void {
    this._version++
    this._isNew = false
    this.initial = structuredClone(this.current)
  }

  get id(): string {
    return (this.current as { id: string }).id
  }

  protected get data(): z.infer<TSchema> {
    return this.current
  }

  /**
   * Changes some of its fields, checked against its schema. Protected: the entity's
   * own methods change it, and say what happened (its events).
   */
  protected change(partial: Partial<Omit<z.infer<TSchema>, 'id'>>): void {
    if (this._deleted) throw new DeletedEntityNotChangeable()
    let mutated = false
    for (const [key, value] of Object.entries(partial)) {
      if (key === 'id') continue
      const fieldSchema = this.schema.shape[key]
      if (!fieldSchema) throw new UnknownEntityField(key)
      ;(fieldSchema as z.ZodType).parse(value)
      if (!Bun.deepEquals((this.current as Fields)[key], value, true)) {
        ;(this.current as Fields)[key] = value
        mutated = true
      }
    }
    if (mutated) {
      ;(this.current as Fields).updatedAt = new Date().toISOString()
    }
  }

  getChanges(): Partial<z.infer<TSchema>> | null {
    if (this.isNew || this._deleted || !this.initial) return null

    const changes: Partial<z.infer<TSchema>> = {}
    for (const key of Object.keys(this.current as object)) {
      if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue
      const currentVal = (this.current as Fields)[key]
      const initialVal = (this.initial as Fields)[key]
      if (!Bun.deepEquals(initialVal, currentVal, true)) {
        ;(changes as Fields)[key] = currentVal
      }
    }
    return Object.keys(changes).length ? changes : null
  }

  /**
   * What the fields `getChanges` names were when it was last saved (or read): with
   * `getChanges`, the transition a save makes, from these values to those.
   */
  getPrevious(): Partial<z.infer<TSchema>> | null {
    const changes = this.getChanges()
    if (!changes || !this.initial) return null
    return Object.fromEntries(Object.keys(changes).map(key => [key, structuredClone((this.initial as Fields)[key])])) as Partial<z.infer<TSchema>>
  }

  hasChanged(field: keyof z.infer<TSchema>): boolean {
    if (this.isNew) return true
    const changes = this.getChanges()
    return changes !== null && field in changes
  }

  toDTO(): z.infer<TSchema> {
    return structuredClone(this.current)
  }

  get isDeleted(): boolean {
    return this._deleted
  }

  protected markAsDeleted(): void {
    if (!this.initial) throw new NewEntityNotDeletable()
    if (this._deleted) throw new EntityAlreadyDeleted()
    this._deleted = true
  }

  /**
   * Notes what happened, to be told when it is saved. Each kind of thing is told once
   * per save, as it stands: an event replaces one of its name noted before, so two
   * changes before a save make one `updated`, with both.
   */
  protected trackEvent(event: DomainEvent): void {
    this.domainEvents = [...this.domainEvents.filter(each => each.name !== event.name), event]
  }

  /** What it has to tell since it was last saved: its repository publishes it with the save. */
  [takeEvents](): DomainEvent[] {
    const events = this.domainEvents
    this.domainEvents = []
    return events
  }
}
