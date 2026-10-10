import { z } from 'zod'
import type { DomainEvent } from '../events/domain-event'
import type { EventPublisher } from '../events/event-publisher'
import { DeletedEntityNotChangeable } from './errors/deleted-entity-not-changeable'
import { EntityAlreadyDeleted } from './errors/entity-already-deleted'
import { NewEntityNotDeletable } from './errors/new-entity-not-deletable'
import { UnknownEntityField } from './errors/unknown-entity-field'

export type EntitySchema = z.ZodObject<z.ZodRawShape & { id: z.ZodType<string>, createdAt: z.ZodType<string>, updatedAt: z.ZodType<string> }>

export type EntityInput<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string, createdAt?: string, updatedAt?: string }

export class Entity<TSchema extends EntitySchema> {
  private readonly initial: z.infer<TSchema> | null
  private current: z.infer<TSchema>
  readonly isNew: boolean

  private domainEvents: DomainEvent[] = []
  private _deleted = false
  private _restored = false

  protected constructor(
    protected readonly schema: TSchema,
    input: EntityInput<z.infer<TSchema>>,
    isNew: boolean,
  ) {
    const id = input.id ?? Bun.randomUUIDv7()

    this.current = schema.parse({ ...input, id }) as z.infer<TSchema>

    if (isNew) {
      const now = new Date().toISOString()
      ;(this.current as Record<string, unknown>).createdAt = now
      ;(this.current as Record<string, unknown>).updatedAt = now
    }

    this.initial = isNew ? null : structuredClone(this.current)
    this.isNew = isNew
  }

  get id(): string {
    return (this.current as { id: string }).id
  }

  protected get data(): z.infer<TSchema> {
    return this.current
  }

  change(partial: Partial<Omit<z.infer<TSchema>, 'id'>>) {
    if (this._deleted) throw new DeletedEntityNotChangeable()
    let mutated = false
    for (const [key, value] of Object.entries(partial)) {
      if (key === 'id') continue
      const fieldSchema = this.schema.shape[key]
      if (!fieldSchema) throw new UnknownEntityField(key)
      ;(fieldSchema as z.ZodType).parse(value)
      if (!Bun.deepEquals((this.current as Record<string, unknown>)[key], value, true)) {
        ;(this.current as Record<string, unknown>)[key] = value
        mutated = true
      }
    }
    if (mutated) {
      ;(this.current as Record<string, unknown>).updatedAt = new Date().toISOString()
    }
  }

  getChanges(): Partial<z.infer<TSchema>> | null {
    if (this.isNew || this._deleted || !this.initial) return null

    const changes: Partial<z.infer<TSchema>> = {}
    for (const key of Object.keys(this.current as object)) {
      if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue
      const currentVal = (this.current as Record<string, unknown>)[key]
      const initialVal = (this.initial as Record<string, unknown>)[key]
      if (!Bun.deepEquals(initialVal, currentVal, true)) {
        ;(changes as Record<string, unknown>)[key] = currentVal
      }
    }
    return Object.keys(changes).length ? changes : null
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

  protected markAsRestored(): void {
    if (!this.initial) throw new NewEntityNotDeletable()
    this._deleted = false
    this._restored = true
  }

  get isRestored(): boolean {
    return this._restored
  }

  protected trackEvent(event: DomainEvent): void {
    this.domainEvents.push(event)
  }

  dispatchEvents(publisher: EventPublisher): void {
    const events = this.domainEvents
    this.domainEvents = []
    for (const event of events) {
      publisher.publish(event)
    }
  }
}
