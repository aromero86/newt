import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { assertSavable } from './assert-savable'
import { Entity } from './entity'
import type { EntityInput } from './entity-input'
import { EntityAlreadyDeleted } from './errors/entity-already-deleted'
import { EventWithoutChange } from './errors/event-without-change'
import { InvalidEntity } from './errors/invalid-entity'
import { NewEntityNotDeletable } from './errors/new-entity-not-deletable'
import { markPersisted } from './mark-persisted'
import { storedFields } from './stored-fields'
import { takeEvents } from './take-events'

const ThingSchema = z.object({
  id: z.string(),
  name: z.string(),
  ref: z.object({ id: z.string(), label: z.string() }).nullable(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

type ThingDTO = z.infer<typeof ThingSchema>

class Thing extends Entity<typeof ThingSchema> {
  private constructor(input: EntityInput<ThingDTO>, isNew: boolean) {
    super(ThingSchema, input, isNew)
  }

  static create(input: EntityInput<ThingDTO>): Thing {
    return new Thing(input, true)
  }

  static fromDTO(dto: ThingDTO & { version: number }): Thing {
    return new Thing(dto, false)
  }

  static seed(dto: EntityInput<ThingDTO>): Thing {
    return new Thing(dto, true)
  }

  apply(changes: Partial<Omit<ThingDTO, 'id'>>) {
    this.change(changes)
  }

  remove() {
    this.markAsDeleted()
  }
}

const existing = (over: Partial<ThingDTO> = {}) =>
  Thing.fromDTO({
    id: 'thing-1',
    name: 'original',
    ref: { id: 'ref-1', label: 'one' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 3,
    ...over,
  })

describe('isNew', () => {
  test('is decided by the constructor called, not by the presence of an id', () => {
    expect(Thing.create({ name: 'x', ref: null }).isNew).toBe(true)
    expect(existing().isNew).toBe(false)
  })

  test('creating with an id of its own is still new (seed, import)', () => {
    const seeded = Thing.seed({ id: 'fijo', name: 'x', ref: null })
    expect(seeded.isNew).toBe(true)
    expect(seeded.id).toBe('fijo')
  })
})

describe('change', () => {
  test('compares object refs by structure, not identity', () => {
    const thing = existing()
    thing.apply({ ref: { id: 'ref-1', label: 'one' } })
    expect(thing.getChanges()).toBeNull()
  })

  test('detects a real change inside a ref', () => {
    const thing = existing()
    thing.apply({ ref: { id: 'ref-2', label: 'two' } })
    expect(thing.getChanges()?.ref).toEqual({ id: 'ref-2', label: 'two' })
  })

  test('without a real change it leaves updatedAt alone', () => {
    const thing = existing()
    thing.apply({ name: 'original' })
    expect(thing.toDTO().updatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  test('with a real change it bumps updatedAt', () => {
    const thing = existing()
    thing.apply({ name: 'other' })
    expect(thing.toDTO().updatedAt).not.toBe('2026-01-01T00:00:00.000Z')
  })

  test('a key outside the schema throws instead of being ignored', () => {
    const thing = existing()
    expect(() => thing.apply({ nmae: 'typo' } as never)).toThrow(/Unknown field 'nmae'/)
  })

  test('a value the schema rejects is a programming error, which says what and where', () => {
    const thing = existing()
    expect(() => thing.apply({ name: 42 } as never)).toThrow(InvalidEntity)
    expect(() => thing.apply({ name: 42 } as never)).toThrow(`Thing ${thing.id} does not pass its schema: name:`)
  })

  test('a strict schema reads a stored row: its version and deletedAt are not its data', () => {
    const Strict = z.strictObject({ id: z.string(), name: z.string(), createdAt: z.string(), updatedAt: z.string() })
    class Tight extends Entity<typeof Strict> {
      static of(row: z.infer<typeof Strict> & { version: number, deletedAt: null }) {
        return new Tight(Strict, row, false)
      }
    }
    const tight = Tight.of({ id: 't', name: 'x', createdAt: 'c', updatedAt: 'u', version: 2, deletedAt: null })

    expect(tight.toDTO()).toEqual({ id: 't', name: 'x', createdAt: 'c', updatedAt: 'u' })
    expect(tight.version).toBe(2)
  })

  test('a field that may be left out, read back as null, is left out', () => {
    const Noted = z.object({ id: z.string(), note: z.string().optional(), kept: z.string().nullable(), createdAt: z.string(), updatedAt: z.string() })
    class Note extends Entity<typeof Noted> {
      static of(row: Record<string, unknown>) {
        return new Note(Noted, row as never, false)
      }
    }
    const note = Note.of({ id: 'n', note: null, kept: null, createdAt: 'c', updatedAt: 'u', version: 1 })

    expect(note.toDTO()).toEqual({ id: 'n', kept: null, createdAt: 'c', updatedAt: 'u' })
  })

  test('a stored row the schema rejects is one too', () => {
    expect(() => Thing.fromDTO({ ...existing().toDTO(), name: 42, version: 1 } as never)).toThrow(InvalidEntity)
  })

  test('the schema has the last word: a field changed takes the value it parses to', () => {
    const Trimmed = z.object({ id: z.string(), name: z.string().trim(), tags: z.array(z.string()).default([]), createdAt: z.string().default(''), updatedAt: z.string().default('') })
    class Tidy extends Entity<typeof Trimmed> {
      static of() {
        return new Tidy(Trimmed, { id: 't', name: 'x', tags: ['a'], version: 1 }, false)
      }
      apply(changes: Partial<z.input<typeof Trimmed>>) {
        this.change(changes as never)
      }
    }
    const tidy = Tidy.of()
    tidy.apply({ name: '  Bea  ', tags: undefined })

    expect(tidy.toDTO()).toMatchObject({ name: 'Bea', tags: [] })
    expect(tidy.getChanges()).toEqual({ name: 'Bea', tags: [] })
  })

  test('a change the schema refuses as a whole, across fields, is refused, and changes nothing', () => {
    const Span = z.object({ id: z.string(), start: z.number(), end: z.number(), createdAt: z.string().default(''), updatedAt: z.string().default('') })
      .refine(span => span.start <= span.end, 'start after end')
    class Range extends Entity<typeof Span> {
      static of() {
        return new Range(Span, { id: 'r', start: 1, end: 2, version: 1 }, false)
      }
      apply(changes: Partial<z.infer<typeof Span>>) {
        this.change(changes)
      }
    }
    const range = Range.of()

    expect(() => range.apply({ start: 10 })).toThrow('Range r does not pass its schema: (root): start after end')
    expect(range.hasPendingChanges).toBe(false)
    range.apply({ start: 2 })
    expect(range.getChanges()).toEqual({ start: 2 })
  })

  test('a deleted entity cannot change', () => {
    const thing = existing()
    thing['markAsDeleted']()
    expect(() => thing.apply({ name: 'other' })).toThrow(/deleted/)
  })
})

describe('getChanges', () => {
  test('is null for a new entity', () => {
    const thing = Thing.create({ name: 'x', ref: null })
    thing.apply({ name: 'y' })
    expect(thing.getChanges()).toBeNull()
  })

  test('leaves updatedAt out even after it was stamped', () => {
    const thing = existing()
    thing.apply({ name: 'other' })
    expect(thing.toDTO().updatedAt).not.toBe('2026-01-01T00:00:00.000Z')
    expect(Object.keys(thing.getChanges()!)).toEqual(['name'])
  })

  test('returns only what changed', () => {
    const thing = existing()
    thing.apply({ name: 'other' })
    const changes = thing.getChanges()
    expect(changes?.name).toBe('other')
    expect(changes).not.toHaveProperty('ref')
  })
})

describe('hasChanged', () => {
  test('a new entity has changed in everything: there is nothing to compare with', () => {
    const created = Thing.create({ name: 'x', ref: null })
    expect(created.hasChanged('name')).toBe(true)
    expect(created.hasChanged('ref')).toBe(true)
  })

  test('an untouched stored entity has changed in nothing', () => {
    const thing = existing()
    expect(thing.hasChanged('name')).toBe(false)
    expect(thing.hasChanged('ref')).toBe(false)
  })

  test('only the touched field counts as changed', () => {
    const thing = existing()
    thing.apply({ name: 'other' })
    expect(thing.hasChanged('name')).toBe(true)
    expect(thing.hasChanged('ref')).toBe(false)
  })

  test('assigning the same value is not a change', () => {
    const thing = existing()
    thing.apply({ name: 'original' })
    expect(thing.hasChanged('name')).toBe(false)
  })
})

describe('its schema', () => {
  const shape = { id: z.string(), name: z.string(), createdAt: z.string().default(''), updatedAt: z.string().default('') }
  type Schema = z.ZodObject<typeof shape>
  class Any extends Entity<Schema> {
    /** A row with a column its schema does not name. */
    static read(schema: Schema) {
      return new Any(schema, { id: 'a1', name: 'a', version: 1, extra: 'column' } as EntityInput<z.infer<Schema>>, false)
    }
  }

  test('may not keep the fields it does not name: a row\'s other columns would end up in the entity', () => {
    for (const schema of [z.looseObject(shape), z.object(shape).catchall(z.string()), z.object(shape).passthrough()]) {
      expect(() => Any.read(schema)).toThrow("Any's schema keeps fields it does not name")
    }
  })

  test('drops them, or refuses them strictly', () => {
    expect(Any.read(z.object(shape)).toDTO()).toEqual({ id: 'a1', name: 'a', createdAt: '', updatedAt: '' })
    expect(() => Any.read(z.strictObject(shape))).toThrow(InvalidEntity)
  })
})

describe('a public schema', () => {
  const AccountSchema = z.object({ id: z.string(), email: z.string(), createdAt: z.string().default(''), updatedAt: z.string().default('') })
  const AccountEntitySchema = AccountSchema.extend({ passwordHash: z.string() })
  type AccountRow = z.infer<typeof AccountEntitySchema> & { version: number }

  class Account extends Entity<typeof AccountEntitySchema, typeof AccountSchema> {
    static read(row: AccountRow) {
      return new Account(AccountEntitySchema, row, false, AccountSchema)
    }
    rehash(passwordHash: string) {
      this.change({ passwordHash })
    }
  }
  const row = { id: 'a1', email: 'ana@example.com', passwordHash: 'secret', createdAt: '', updatedAt: '', version: 1 }

  test('is all toDTO gives: what it keeps besides stays inside', () => {
    expect(Account.read(row).toDTO()).toEqual({ id: 'a1', email: 'ana@example.com', createdAt: '', updatedAt: '' })
  })

  test('leaves its repository all its fields to store, and what changed of them', () => {
    const account = Account.read(row)
    account.rehash('another')

    expect(account[storedFields]()).toEqual({ id: 'a1', email: 'ana@example.com', passwordHash: 'another', createdAt: '', updatedAt: expect.any(String) })
    expect(account.getChanges()).toEqual({ passwordHash: 'another' })
  })

  test('shows some of its fields, never one it does not have', () => {
    class Wrong extends Entity<typeof AccountSchema, typeof AccountEntitySchema> {
      static read() {
        return new Wrong(AccountSchema, row, false, AccountEntitySchema)
      }
    }

    expect(() => Wrong.read()).toThrow("Wrong's public schema has 'passwordHash', which its schema does not")
  })

  test('is given whenever the entity says it has one', () => {
    class Forgotten extends Entity<typeof AccountEntitySchema, typeof AccountSchema> {
      static read() {
        // @ts-expect-error: its public schema is missing
        return new Forgotten(AccountEntitySchema, row, false)
      }
    }

    expect(Forgotten.read()).toBeDefined()
  })
})

describe('version', () => {
  test('is 0 until it is saved, and the one stored when read', () => {
    expect(Thing.create({ name: 'x', ref: null }).version).toBe(0)
    expect(existing().version).toBe(3)
  })

  test('read from storage without one, it throws: saving it could overwrite someone', () => {
    expect(() => Thing.fromDTO({ ...existing().toDTO() } as ThingDTO & { version: number })).toThrow('comes with its version')
  })

  test('once saved, it is one on, no longer new, and has no changes left', () => {
    const created = Thing.create({ name: 'x', ref: null })
    created[markPersisted]()
    expect(created.version).toBe(1)
    expect(created.isNew).toBe(false)

    const thing = existing()
    thing.apply({ name: 'changed' })
    thing[markPersisted]()
    expect(thing.version).toBe(4)
    expect(thing.getChanges()).toBeNull()
  })
})

describe('getPrevious', () => {
  test('is what the changed fields were when it was read', () => {
    const thing = existing()
    thing.apply({ name: 'first' })
    thing.apply({ name: 'second' })

    expect(thing.getChanges()).toEqual({ name: 'second' })
    expect(thing.getPrevious()).toEqual({ name: 'original' })
  })

  test('is null with nothing changed, and for a new one', () => {
    expect(existing().getPrevious()).toBeNull()
    expect(Thing.create({ name: 'x', ref: null }).getPrevious()).toBeNull()
  })
})

describe('trackEvent', () => {
  class Tracked extends Entity<typeof ThingSchema> {
    static of(dto: ThingDTO & { version: number }) {
      return new Tracked(ThingSchema, dto, false)
    }
    rename(name: string) {
      this.change({ name })
      this.trackEvent({ name: 'thing.updated', payload: { name: this.toDTO().name, changes: this.getChanges() }, occurredAt: '' })
    }
    archive() {
      this.trackEvent({ name: 'thing.archived', payload: null, occurredAt: '' })
    }
  }

  test('tells each kind of thing once per save, as it stands', () => {
    const thing = Tracked.of({ ...existing().toDTO(), version: 1 })
    thing.rename('first')
    thing.archive()
    thing.rename('second')

    expect(thing[takeEvents]().map(event => [event.name, event.payload])).toEqual([
      ['thing.archived', null],
      ['thing.updated', { name: 'second', changes: { name: 'second' } }],
    ])
  })
})

describe('a new entity', () => {
  test('is stamped with the same createdAt and updatedAt', () => {
    const { createdAt, updatedAt } = Thing.create({ name: 'a', ref: null }).toDTO()

    expect(createdAt).not.toBe('')
    expect(updatedAt).toBe(createdAt)
  })
})

describe('change, further', () => {
  test('leaves the id alone', () => {
    const thing = existing()
    thing.apply({ id: 'other' } as never)

    expect(thing.id).toBe('thing-1')
    expect(thing.getChanges()).toBeNull()
  })

  test('a structurally equal ref is no change: updatedAt stays', () => {
    const thing = existing()
    thing.apply({ ref: { id: 'ref-1', label: 'one' } })

    expect(thing.toDTO().updatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  test('once saved, a later change is a change again', () => {
    const thing = existing()
    thing.apply({ name: 'saved' })
    thing[markPersisted]()
    thing.apply({ name: 'later' })

    expect(thing.getChanges()).toEqual({ name: 'later' })
    expect(thing.getPrevious()).toEqual({ name: 'saved' })
  })
})

describe('copies', () => {
  test('toDTO and getPrevious hand out copies: changing them leaves the entity alone', () => {
    const thing = existing()
    thing.apply({ ref: { id: 'ref-2', label: 'two' } })

    thing.toDTO().ref!.label = 'changed'
    thing.getPrevious()!.ref!.label = 'changed'

    expect(thing.toDTO().ref!.label).toBe('two')
    expect(thing.getPrevious()!.ref!.label).toBe('one')
  })
})

describe('hasPendingChanges', () => {
  test('is whether a save would write anything', () => {
    expect(Thing.create({ name: 'a', ref: null }).hasPendingChanges).toBe(true)
    expect(existing().hasPendingChanges).toBe(false)

    const changed = existing()
    changed.apply({ name: 'renamed' })
    expect(changed.hasPendingChanges).toBe(true)
    changed[markPersisted]()
    expect(changed.hasPendingChanges).toBe(false)

    const deleted = existing()
    deleted.remove()
    expect(deleted.hasPendingChanges).toBe(true)
  })

  test('once its deletion is saved there is nothing left to save: it stays deleted, and unchangeable', () => {
    const thing = existing()
    thing.remove()
    thing[markPersisted]()

    expect(thing.hasPendingChanges).toBe(false)
    expect(thing.isDeleted).toBe(true)
    expect(() => thing.remove()).toThrow(EntityAlreadyDeleted)
    expect(() => thing.apply({ name: 'other' })).toThrow(/deleted/)
  })
})

describe('markAsDeleted', () => {
  test('a stored entity is deleted once', () => {
    const thing = existing()
    thing.remove()

    expect(thing.isDeleted).toBe(true)
    expect(() => thing.remove()).toThrow(EntityAlreadyDeleted)
  })

  test('a new entity was never stored, so it cannot be deleted', () => {
    expect(() => Thing.create({ name: 'a', ref: null }).remove()).toThrow(NewEntityNotDeletable)
  })

  test('a deleted entity has no changes to write: it is deleted whole', () => {
    const thing = existing()
    thing.apply({ name: 'renamed' })
    thing.remove()

    expect(thing.getChanges()).toBeNull()
  })
})

describe('assertSavable', () => {
  class Told extends Entity<typeof ThingSchema> {
    static of() {
      return new Told(ThingSchema, { ...existing().toDTO(), version: 1 }, false)
    }
    rename(name: string) {
      this.change({ name })
      this.trackEvent({ name: 'thing.renamed', payload: name, occurredAt: '' })
    }
    ping() {
      this.trackEvent({ name: 'thing.pinged', payload: null, occurredAt: '' })
    }
  }

  test('an event with a change, even one undone, may be saved', () => {
    const changed = Told.of()
    changed.rename('other')
    const undone = Told.of()
    undone.rename('other')
    undone.rename('original')

    expect(() => changed[assertSavable]()).not.toThrow()
    expect(() => undone[assertSavable]()).not.toThrow()
  })

  test('an event that never changed anything is refused, saying what to do', () => {
    const thing = Told.of()
    thing.ping()

    expect(() => thing[assertSavable]()).toThrow(EventWithoutChange)
    expect(() => thing[assertSavable]()).toThrow('Told thing-1 tells thing.pinged but has nothing to save: change what it tells of')
  })

  test('a change saved does not cover an event told after it', () => {
    const thing = Told.of()
    thing.rename('other')
    thing[markPersisted]()
    thing[takeEvents]()
    thing.ping()

    expect(() => thing[assertSavable]()).toThrow(EventWithoutChange)
  })

  test('with nothing told, there is nothing to refuse', () => {
    expect(() => Told.of()[assertSavable]()).not.toThrow()
  })
})

describe('takeEvents', () => {
  test('hands each event over once', () => {
    class Noisy extends Entity<typeof ThingSchema> {
      static of() {
        return new Noisy(ThingSchema, { ...existing().toDTO(), version: 1 }, false)
      }
      ping() {
        this.trackEvent({ name: 'thing.pinged', payload: null, occurredAt: '' })
      }
    }
    const thing = Noisy.of()
    thing.ping()

    expect(thing[takeEvents]()).toHaveLength(1)
    expect(thing[takeEvents]()).toEqual([])
  })
})
