import { afterEach, describe, expect, test } from 'bun:test'
import { ReferenceNotFound } from '../errors/reference-not-found'
import { currentMessages } from './current-messages'
import { message } from './message'
import { setMessages } from './set-messages'

const english = currentMessages.value

afterEach(() => {
  currentMessages.value = english
})

describe('setMessages', () => {
  test('replaces the messages it is given, and leaves the rest in English', () => {
    setMessages({ reference_not_found: ({ resource, id }) => `No existe ${resource} ${id}` })

    expect(message('reference_not_found', { resource: 'ciudad', id: 'c1' })).toBe('No existe ciudad c1')
    expect(message('internal')).toBe('Something went wrong')
  })

  test('reaches the errors made after it', () => {
    setMessages({ reference_not_found: () => 'No existe' })

    expect(new ReferenceNotFound('city', 'c1').message).toBe('No existe')
  })

  test('gives back what puts the messages before it back', () => {
    const restore = setMessages({ internal: () => 'Algo salió mal' })
    setMessages({ reference_not_found: () => 'No existe' })
    expect(message('internal')).toBe('Algo salió mal')

    restore()

    expect(message('internal')).toBe('Something went wrong')
    expect(message('reference_not_found', { resource: 'city', id: 'c1' })).not.toBe('No existe')
  })
})
