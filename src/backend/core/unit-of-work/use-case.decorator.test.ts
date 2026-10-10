import { describe, expect, test } from 'bun:test'
import type { Span } from '../observability/span'
import type { Tracer } from '../observability/tracer'
import { TransactionManager } from './transaction-manager'
import type { TransactionRunner } from './transaction-runner'
import { UseCase } from './use-case.decorator'
import { currentUnitOfWork } from './current-unit-of-work'
import { deferEmit } from './defer-emit'
import { ensureTransaction } from './ensure-transaction'

/**
 * One shared log for statements and events, so the assertions read as a timeline:
 * an event must never appear before the COMMIT that made it durable.
 */
class Recorder implements TransactionRunner, Tracer {
  readonly log: string[] = []
  readonly spans: string[] = []

  exec(sql: string): void {
    this.log.push(sql)
  }

  startActiveSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
    this.spans.push(name)
    return fn({ setError() {}, end() {} })
  }
}

class Contacts {
  readonly transactions: TransactionManager
  unitOfWorkSeenInsideRun: boolean | null = null

  constructor(private readonly recorder: Recorder) {
    this.transactions = new TransactionManager(recorder, recorder)
  }

  /** Stands in for a repository write: this is what the drizzle proxy does. */
  @UseCase('contact.upsert')
  async upsert(name: string) {
    ensureTransaction(() => this.recorder.exec('BEGIN IMMEDIATE'))
    deferEmit(() => this.recorder.log.push(`event:${name}`))
  }

  @UseCase('sync.run')
  async runInsideOneTransaction(names: string[]) {
    for (const name of names) await this.upsert(name)
  }

  @UseCase('sync.run', { transactional: false })
  async run(names: string[]) {
    this.unitOfWorkSeenInsideRun = currentUnitOfWork() !== undefined
    for (const name of names) await this.upsert(name)
  }

  /** A caller that already holds a unit of work when it starts the long process. */
  @UseCase('sync.start')
  async startThenRun(names: string[]) {
    ensureTransaction(() => this.recorder.exec('BEGIN IMMEDIATE'))
    await this.run(names)
  }

  @UseCase('sync.run', { transactional: false })
  async runAndFail() {
    await this.upsert('a')
    throw new Error('boom')
  }
}

describe('@UseCase by default', () => {
  test('nested use cases share one transaction', async () => {
    const recorder = new Recorder()
    await new Contacts(recorder).runInsideOneTransaction(['a', 'b', 'c'])

    expect(recorder.log).toEqual([
      'BEGIN IMMEDIATE',
      'COMMIT',
      'event:a',
      'event:b',
      'event:c',
    ])
  })
})

describe('@UseCase with transactional: false', () => {
  test('each nested use case opens and commits its own', async () => {
    const recorder = new Recorder()
    await new Contacts(recorder).run(['a', 'b', 'c'])

    expect(recorder.log).toEqual([
      'BEGIN IMMEDIATE', 'COMMIT', 'event:a',
      'BEGIN IMMEDIATE', 'COMMIT', 'event:b',
      'BEGIN IMMEDIATE', 'COMMIT', 'event:c',
    ])
  })

  test('opens no unit of work of its own', async () => {
    const recorder = new Recorder()
    const contacts = new Contacts(recorder)
    await contacts.run(['a'])

    expect(contacts.unitOfWorkSeenInsideRun).toBe(false)
  })

  test('still shows in the trace', async () => {
    const recorder = new Recorder()
    await new Contacts(recorder).run(['a'])

    expect(recorder.spans).toEqual(['sync.run', 'contact.upsert'])
  })

  test('isolates even when called by a use case with an open transaction', async () => {
    const recorder = new Recorder()
    await new Contacts(recorder).startThenRun(['a', 'b'])

    // The caller's BEGIN stays open until its own COMMIT at the end; what matters is
    // that 'a' and 'b' did not wait for that COMMIT.
    expect(recorder.log).toEqual([
      'BEGIN IMMEDIATE',
      'BEGIN IMMEDIATE', 'COMMIT', 'event:a',
      'BEGIN IMMEDIATE', 'COMMIT', 'event:b',
      'COMMIT',
    ])
  })

  test('what was already committed survives a later failure', async () => {
    const recorder = new Recorder()

    await expect(new Contacts(recorder).runAndFail()).rejects.toThrow('boom')

    expect(recorder.log).toEqual(['BEGIN IMMEDIATE', 'COMMIT', 'event:a'])
  })
})
