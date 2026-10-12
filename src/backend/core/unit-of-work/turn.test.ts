import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { deferEmit } from './defer-emit'
import { ensureTransaction } from './ensure-transaction'
import { TransactionManager } from './transaction-manager'
import { UseCase } from './use-case.decorator'

/** One SQLite connection shared by every unit of work, as the server has. */
function connection(): Database {
  const sqlite = new Database(':memory:')
  sqlite.run('CREATE TABLE contact (name TEXT NOT NULL)')
  return sqlite
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5))

class Contacts {
  readonly transactions: TransactionManager

  constructor(private readonly sqlite: Database) {
    this.transactions = new TransactionManager({ exec: sql => this.sqlite.run(sql) })
  }

  private insert(name: string) {
    ensureTransaction(() => this.sqlite.run('BEGIN IMMEDIATE'))
    this.sqlite.run('INSERT INTO contact (name) VALUES (?)', [name])
  }

  /** Writes, waits on something else (a hash, a network call), writes again. */
  @UseCase('contact.pair')
  async pair(name: string) {
    this.insert(`${name}-1`)
    await tick()
    this.insert(`${name}-2`)
  }

  @UseCase('contact.pairThenFail')
  async pairThenFail(name: string) {
    this.insert(name)
    await tick()
    throw new Error('boom')
  }

  @UseCase('contact.batch', { transactional: false })
  async batch(names: string[]) {
    for (const name of names) await this.pair(name)
  }

  /** A caller holding its turn that starts a `transactional: false` process. */
  @UseCase('contact.startBatch')
  async startBatch(names: string[]) {
    await this.batch(names)
  }

  /** Its event starts another unit of work, as a worker reacting to it does. */
  @UseCase('contact.pairAndNotify')
  async pairAndNotify(name: string, then: () => Promise<void>) {
    await this.pair(name)
    deferEmit(() => void then())
  }

  names(): string[] {
    return this.sqlite.query<{ name: string }, []>('SELECT name FROM contact ORDER BY rowid').all().map(row => row.name)
  }
}

describe('units of work on one connection', () => {
  test('two at once both commit instead of colliding', async () => {
    const contacts = new Contacts(connection())

    await Promise.all([contacts.pair('a'), contacts.pair('b')])

    // Each one runs whole before the next: their writes never interleave.
    expect(contacts.names()).toEqual(['a-1', 'a-2', 'b-1', 'b-2'])
  })

  test('one that fails rolls back without stopping the one waiting', async () => {
    const contacts = new Contacts(connection())

    const [failed, passed] = await Promise.allSettled([contacts.pairThenFail('x'), contacts.pair('b')])

    expect(failed.status).toBe('rejected')
    expect(passed.status).toBe('fulfilled')
    expect(contacts.names()).toEqual(['b-1', 'b-2'])
  })

  test('nested units of work within a turn do not wait for it', async () => {
    const contacts = new Contacts(connection())

    await contacts.startBatch(['a', 'b'])

    expect(contacts.names()).toEqual(['a-1', 'a-2', 'b-1', 'b-2'])
  })

  test('what an event starts waits for its own turn', async () => {
    const contacts = new Contacts(connection())
    let started!: Promise<void>

    await Promise.all([
      contacts.pairAndNotify('a', async () => {
        started = contacts.pair('from-event')
      }),
      contacts.pair('b'),
    ])
    await started

    expect(contacts.names()).toEqual(['a-1', 'a-2', 'b-1', 'b-2', 'from-event-1', 'from-event-2'])
  })
})
