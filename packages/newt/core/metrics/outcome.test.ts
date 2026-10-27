import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { ConcurrencyConflict } from '../errors/concurrency-conflict'
import { NotFoundError } from '../errors/not-found-error'
import { outcomeOf } from './outcome'

class CardNotFound extends NotFoundError {
  readonly code = 'card.not_found'
}

describe('how a call that threw ended', () => {
  test('an error, when it says it may happen: a domain error under 500, a validation', () => {
    expect(outcomeOf(new CardNotFound('no'))).toEqual({ kind: 'error', code: 'card.not_found' })
    expect(outcomeOf(new ConcurrencyConflict())).toEqual({ kind: 'error', code: 'concurrency_conflict' })
    expect(outcomeOf(z.object({ a: z.string() }).safeParse({}).error)).toEqual({ kind: 'error', code: 'validation' })
  })

  test('a failure, when nobody expected it: by its class', () => {
    expect(outcomeOf(new TypeError('x is undefined'))).toEqual({ kind: 'failure', code: 'TypeError' })
    expect(outcomeOf('thrown as it is')).toEqual({ kind: 'failure', code: 'string' })
  })
})
