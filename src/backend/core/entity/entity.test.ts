import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { Entity } from './entity'
import type { EntityInput } from './entity-input'

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

  static fromDTO(dto: ThingDTO): Thing {
    return new Thing(dto, false)
  }

  static seed(dto: EntityInput<ThingDTO>): Thing {
    return new Thing(dto, true)
  }

  apply(changes: Partial<Omit<ThingDTO, 'id'>>) {
    this.change(changes)
  }
}

const existing = (over: Partial<ThingDTO> = {}) =>
  Thing.fromDTO({
    id: 'thing-1',
    name: 'original',
    ref: { id: 'ref-1', label: 'one' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

  test('a value the schema rejects throws', () => {
    const thing = existing()
    expect(() => thing.apply({ name: 42 } as never)).toThrow()
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
