import { describe, expect, test } from 'bun:test'
import { ConcurrencyConflict } from './concurrency-conflict'
import { ConflictError } from './conflict-error'
import { DuplicateValue } from './duplicate-value'
import { ForbiddenError } from './forbidden-error'
import { NotFoundError } from './not-found-error'
import { ReferenceNotFound } from './reference-not-found'
import { UnauthorizedError } from './unauthorized-error'
import { ValidationError } from './validation-error'

class ThingNotFound extends NotFoundError {
  readonly code = 'thing.not_found'
}

describe('DomainError', () => {
  test('the base class decides the status', () => {
    class BadInput extends ValidationError { readonly code = 'bad_input' }
    class NoSession extends UnauthorizedError { readonly code = 'no_session' }
    class NotYours extends ForbiddenError { readonly code = 'not_yours' }
    class Taken extends ConflictError { readonly code = 'taken' }

    expect(new BadInput('x').status).toBe(400)
    expect(new NoSession('x').status).toBe(401)
    expect(new NotYours('x').status).toBe(403)
    expect(new ThingNotFound('x').status).toBe(404)
    expect(new Taken('x').status).toBe(409)
  })

  test('is named after the concrete class and keeps its message and code', () => {
    const error = new ThingNotFound('Thing 1 not found')

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ThingNotFound')
    expect(error.message).toBe('Thing 1 not found')
    expect(error.code).toBe('thing.not_found')
  })

  test('a reference that points nowhere is a 400 that names it', () => {
    const error = new ReferenceNotFound('city', 'c1')

    expect(error).toBeInstanceOf(ValidationError)
    expect(error.code).toBe('reference_not_found')
    expect(error.message).toBe('The city c1 does not exist')
  })

  test('a save that lost the race is a 409 of its own', () => {
    const error = new ConcurrencyConflict()

    expect(error).toBeInstanceOf(ConflictError)
    expect(error.code).toBe('concurrency_conflict')
    expect(error.message).toBe('Someone changed it in the meantime. Try again.')
  })

  test('a value another one took first is a conflict of its own, naming it when it can', () => {
    const named = new DuplicateValue(['boardId', 'number'])
    const unnamed = new DuplicateValue()

    expect(named).toBeInstanceOf(ConcurrencyConflict)
    expect([named.status, named.code, named.name]).toEqual([409, 'duplicate_value', 'DuplicateValue'])
    expect(named.fields).toEqual(['boardId', 'number'])
    expect(named.message).toBe('There is already one with this boardId and number')
    expect([unnamed.fields, unnamed.message]).toEqual([[], 'There is already one like it'])
  })
})
