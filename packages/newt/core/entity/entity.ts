import { ZodError, type z } from 'zod'
import { now as clockNow } from '../clock/now'
import type { DomainEvent } from '../events/domain-event'
import { DeletedEntityNotChangeable } from './errors/deleted-entity-not-changeable'
import { EntityAlreadyDeleted } from './errors/entity-already-deleted'
import { InvalidEntity } from './errors/invalid-entity'
import { NewEntityNotDeletable } from './errors/new-entity-not-deletable'
import { UnknownEntityField } from './errors/unknown-entity-field'
import type { EntityInput } from './entity-input'
import { assertSavable } from './assert-savable'
import { EventWithoutChange } from './errors/event-without-change'
import { SaveRolledBack } from './errors/save-rolled-back'
import { markPersisted } from './mark-persisted'
import { restoreSaved, savedState, type SavedState } from './saved-state'
import { storedFields } from './stored-fields'
import { takeEvents } from './take-events'
import type { EntitySchema } from './entity-schema'

type Fields = Record<string, unknown>

/** What a store keeps with a row besides the entity's data: its version, and when it was soft deleted. */
const FRAMEWORK_FIELDS = ['version', 'deletedAt']

/** What the framework stamps on every entity: a change to them is never stored. */
const TIMESTAMP_FIELDS = ['createdAt', 'updatedAt']

/** A field that takes no value but not null (`.optional()`): null is what a store gives back for it. */
const optionalOnly = (field: z.ZodType | undefined): boolean =>
  field !== undefined && field.safeParse(undefined).success && !field.safeParse(null).success

/** A schema that keeps the fields it does not name, as `unknown` or as its catchall says: `z.strictObject` refuses them (a catchall of never). */
const keepsUnnamed = (schema: EntitySchema): boolean => {
  const catchall = schema.def.catchall
  return catchall !== undefined && catchall._zod.def.type !== 'never'
}

/**
 * An entity: its data, kept valid by its schema, what changed of it, and what it has
 * to tell. `TPublic`, when its data holds secrets (a password's hash), is the schema
 * of what anyone else sees: `toDTO` gives only its fields, and its repository stores
 * them all.
 */
export class Entity<TSchema extends EntitySchema, TPublic extends EntitySchema = TSchema> {
  private initial: z.infer<TSchema> | null
  private current: z.infer<TSchema>
  private _isNew: boolean
  private _version: number
  /** The fields `toDTO` gives: all of them, unless it has a public schema. */
  private readonly publicFields?: string[]

  private domainEvents: DomainEvent[] = []
  /** Deleted, and whether its repository already saved that. */
  private deletion: 'none' | 'pending' | 'saved' = 'none'
  /** Whether a field changed since it was last saved (or read), even back to what it was. */
  private changed = false
  /** Whether a save it was in rolled back: it is not saved again. */
  private rolledBack = false

  /** `publicSchema`, what anyone else sees of it, is given when it differs from `schema`: an entity with secrets. */
  protected constructor(
    protected readonly schema: TSchema,
    input: EntityInput<z.infer<TSchema>>,
    isNew: boolean,
    ...[publicSchema]: [TPublic] extends [TSchema] ? [publicSchema?: TPublic] : [publicSchema: TPublic]
  ) {
    const id = input.id ?? Bun.randomUUIDv7()
    if (keepsUnnamed(schema)) throw new Error(`${new.target.name}'s schema keeps fields it does not name (z.looseObject, .catchall, .passthrough): a row's other columns would end up in the entity. Make it a z.object, which drops them, or a z.strictObject`)
    if (publicSchema && publicSchema !== schema) {
      this.publicFields = Object.keys(publicSchema.shape)
      const unknown = this.publicFields.find(field => !Object.hasOwn(schema.shape, field))
      if (unknown) throw new Error(`${new.target.name}'s public schema has '${unknown}', which its schema does not: it shows some of its fields, never others`)
    }
    if (!isNew && input.version === undefined) throw new Error(`${new.target.name} read from storage comes with its version`)

    // What the framework adds to a stored row is not the entity's data, unless its schema says so.
    const data: Fields = { ...input, id }
    for (const key of FRAMEWORK_FIELDS) if (!Object.hasOwn(schema.shape, key)) delete data[key]
    // A store keeps "no value" as null: a field that may be left out, but not null, reads it as left out.
    if (!isNew) for (const key of Object.keys(data)) if (data[key] === null && optionalOnly(schema.shape[key] as z.ZodType | undefined)) delete data[key]
    this.current = this.checked(() => schema.parse(data), new.target.name, id) as z.infer<TSchema>

    if (isNew) {
      const now = clockNow().toISOString()
      ;(this.current as Fields).createdAt = now
      ;(this.current as Fields).updatedAt = now
    }

    this.initial = isNew ? null : structuredClone(this.current)
    this._isNew = isNew
    this._version = isNew ? 0 : input.version!
  }

  /** Runs a check of its schema: what fails is a programming error, `InvalidEntity`. */
  private checked<T>(parse: () => T, entity: string, id: string): T {
    try {
      return parse()
    } catch (error) {
      throw error instanceof ZodError ? new InvalidEntity(entity, id, error) : error
    }
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

  /**
   * Whether saving it would write anything: new, deleted or changed. Once its deletion
   * is saved there is nothing left to write: saving it again does nothing.
   */
  get hasPendingChanges(): boolean {
    return this._isNew || this.deletion === 'pending' || this.getChanges() !== null
  }

  /** Its repository saved it: it is now what is stored, one version on. */
  [markPersisted](): void {
    this._version++
    this._isNew = false
    this.initial = structuredClone(this.current)
    this.changed = false
    if (this.deletion === 'pending') this.deletion = 'saved'
  }

  /**
   * Before a save: it was in no save that rolled back, and what it tells comes with a
   * change. A change undone is still one, which tells nothing; an event without any
   * is a mistake, and the save refuses it.
   */
  [assertSavable](): void {
    if (this.rolledBack) throw new SaveRolledBack(this.constructor.name, this.id)
    if (this.hasPendingChanges || this.changed || this.domainEvents.length === 0) return
    throw new EventWithoutChange(this.constructor.name, this.id, this.domainEvents.map(event => event.name))
  }

  /** What it is as saved: its repository puts it back if the save rolls back. */
  [savedState](): SavedState {
    return { version: this._version, isNew: this._isNew, initial: this.initial, deletion: this.deletion }
  }

  /**
   * The save that marked it saved rolled back: it is again as it was saved before,
   * and is never saved again. What it says it changed and has to tell no longer
   * matches what is stored (a change made after that save would tell less than a
   * new save writes), so the use case reads it again.
   */
  [restoreSaved](state: SavedState): void {
    this._version = state.version
    this._isNew = state.isNew
    this.initial = state.initial as z.infer<TSchema> | null
    this.deletion = state.deletion
    this.rolledBack = true
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
   *
   * The schema has the last word, as when it is built: it parses the whole entity as it
   * would be, so its refinements across fields hold, and the fields changed take the
   * values it gives (trimmed, defaulted, coerced). Nothing changes if it fails.
   * createdAt and updatedAt are the framework's: changing them throws.
   */
  protected change(partial: Partial<Omit<z.infer<TSchema>, 'id'>>): void {
    if (this.deletion !== 'none') throw new DeletedEntityNotChangeable()
    const keys = Object.keys(partial).filter(key => key !== 'id')
    for (const key of keys) {
      if (TIMESTAMP_FIELDS.includes(key)) throw new UnknownEntityField(key, 'the framework keeps it, and a save never stores a change to it')
      if (!Object.hasOwn(this.schema.shape, key)) throw new UnknownEntityField(key)
    }
    const next = { ...(this.current as Fields), ...Object.fromEntries(keys.map(key => [key, (partial as Fields)[key]])) }
    const parsed = this.checked(() => this.schema.parse(next), this.constructor.name, this.id) as Fields

    let mutated = false
    for (const key of keys) {
      if (!Bun.deepEquals((this.current as Fields)[key], parsed[key], true)) {
        ;(this.current as Fields)[key] = parsed[key]
        mutated = true
      }
    }
    if (mutated) {
      ;(this.current as Fields).updatedAt = clockNow().toISOString()
      this.changed = true
    }
  }

  getChanges(): Partial<z.infer<TSchema>> | null {
    if (this.isNew || this.deletion !== 'none' || !this.initial) return null

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

  /** What anyone else sees of it, a copy: with a public schema, only its fields. */
  toDTO(): z.infer<TPublic> {
    const fields = this.publicFields
    const shown = fields ? Object.fromEntries(Object.entries(this.current as Fields).filter(([field]) => fields.includes(field))) : this.current
    return structuredClone(shown) as z.infer<TPublic>
  }

  /** What its repository stores: all its fields, a copy. */
  [storedFields](): z.infer<TSchema> {
    return structuredClone(this.current)
  }

  get isDeleted(): boolean {
    return this.deletion !== 'none'
  }

  protected markAsDeleted(): void {
    if (!this.initial) throw new NewEntityNotDeletable()
    if (this.deletion !== 'none') throw new EntityAlreadyDeleted()
    this.deletion = 'pending'
  }

  /**
   * Notes what happened, to be told when it is saved. Each kind of thing is told once
   * per save, as it stands: an event replaces one of its name noted before, so two
   * changes before a save make one `updated`, with both.
   */
  protected trackEvent(event: DomainEvent): void {
    this.domainEvents = [...this.domainEvents.filter(each => each.name !== event.name), event]
  }

  /**
   * What it has to tell since it was last saved: its repository publishes it with the
   * save. One the save did not write had its change undone: that change covered only
   * this save, not an event told after it.
   */
  [takeEvents](): DomainEvent[] {
    const events = this.domainEvents
    this.domainEvents = []
    if (!this.hasPendingChanges) this.changed = false
    return events
  }
}
