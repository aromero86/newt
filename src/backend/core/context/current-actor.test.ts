import { describe, expect, test } from 'bun:test'
import { currentActor } from './current-actor'
import { NoActor } from './errors/no-actor'
import { runAsActor } from './run-as-actor'

const actor = { userId: 'user-1', sessionId: 'session-1' }

describe('currentActor', () => {
  test('is whoever the work runs as, even after awaiting', async () => {
    const seen = await runAsActor(actor, async () => {
      await Bun.sleep(0)
      return currentActor()
    })
    expect(seen).toEqual(actor)
  })

  test('outside a request nobody is signed in: a 401', () => {
    expect(() => currentActor()).toThrow(NoActor)
  })
})
