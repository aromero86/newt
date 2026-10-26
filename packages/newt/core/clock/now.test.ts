import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { Entity } from '../entity/entity'
import type { EntityInput } from '../entity/entity-input'
import { Invocations } from '../use-case/invocations'
import type { Clock } from './clock'
import { currentClock } from './current-clock'
import { now } from './now'

const NoteSchema = z.object({ id: z.string(), text: z.string(), createdAt: z.string().default(''), updatedAt: z.string().default('') })

class Note extends Entity<typeof NoteSchema> {
  static write(text: string): Note {
    return new Note(NoteSchema, { text } as EntityInput<z.infer<typeof NoteSchema>>, true)
  }

  edit(text: string): void {
    this.change({ text })
  }
}

/** A clock a test moves by hand. */
function testClock(at: string) {
  let time = Date.parse(at)
  const clock: Clock = { now: () => new Date(time) }
  return { clock, move: (ms: number) => { time += ms } }
}

describe('now', () => {
  test('is the real time outside any clock', () => {
    const before = Date.now()
    const time = now().getTime()

    expect(time).toBeGreaterThanOrEqual(before)
    expect(time).toBeLessThanOrEqual(Date.now())
  })

  test("is the time of the clock the work in progress runs by", () => {
    const { clock, move } = testClock('2026-01-01T00:00:00.000Z')

    const seen = currentClock.run(clock, () => {
      const first = now().toISOString()
      move(60_000)
      return [first, now().toISOString()]
    })

    expect(seen).toEqual(['2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z'])
  })

  test("is the context's clock in its use cases: an entity is created and changed by it", async () => {
    const { clock, move } = testClock('2026-01-01T00:00:00.000Z')
    const invocations = new Invocations(undefined, {}, 'error', clock)

    const note = await invocations.run('note.write', async () => {
      const written = Note.write('hello')
      move(60_000)
      written.edit('hello again')
      return written.toDTO()
    })

    expect(note).toMatchObject({ createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' })
  })
})
