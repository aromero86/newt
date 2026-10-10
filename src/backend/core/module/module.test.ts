import { describe, expect, test } from 'bun:test'
import { ReferenceNotFound } from '../errors/reference-not-found'
import { TransactionManager } from '../unit-of-work/transaction-manager'
import { Module, type RefFinder } from './module'

const catalogue = (...names: string[]): RefFinder => ({
  async find({ id }) {
    return names.filter(name => id.includes(name)).map(name => ({ id: name, name: name.toUpperCase() }))
  },
})

const finders = {
  city: catalogue('malaga', 'girona'),
  country: catalogue('es'),
}

class Contacts extends Module {
  constructor() {
    super('contacts', new TransactionManager({ exec() {} }))
  }

  // resolveRefs is protected: the test reaches it the way a real module would.
  refs(ids: Partial<Record<'city' | 'country', string | null | undefined>>) {
    return this.resolveRefs(ids, finders)
  }
}

describe('resolveRefs', () => {
  test('an id becomes the reference it names', async () => {
    expect(await new Contacts().refs({ city: 'malaga' })).toEqual({
      city: { id: 'malaga', name: 'MALAGA' },
    })
  })

  test('null means "no city" and resolves to null', async () => {
    expect(await new Contacts().refs({ city: null })).toEqual({ city: null })
  })

  /**
   * The branch that protects partial updates: a reference the input does not
   * mention cannot appear in the result, or the module would write it as null.
   */
  test('an absent key is absent from the result', async () => {
    const refs = await new Contacts().refs({ city: undefined, country: 'es' })

    expect('city' in refs).toBe(false)
    expect(refs).toEqual({ country: { id: 'es', name: 'ES' } })
  })

  test('resolves several at once', async () => {
    expect(await new Contacts().refs({ city: 'girona', country: 'es' })).toEqual({
      city: { id: 'girona', name: 'GIRONA' },
      country: { id: 'es', name: 'ES' },
    })
  })

  test('an id that points nowhere is a 400 naming the field', async () => {
    const failure = new Contacts().refs({ city: 'cuenca' })

    await expect(failure).rejects.toThrow(ReferenceNotFound)
    await expect(failure).rejects.toThrow('Referenced city cuenca not found')
    await expect(failure.catch((e: ReferenceNotFound) => e.status)).resolves.toBe(400)
  })
})
