import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { Entity, Module, UseCase, type EntityInput, type GuardRule } from '../core'
import { Base } from '../runtime'
import { TableRepository } from '../repository'
import { SqliteStore } from './sqlite-store'

const MAX = 2

const ColumnSchema = z.object({ id: z.string(), boardId: z.string(), name: z.string(), createdAt: z.string().default(''), updatedAt: z.string().default('') })
type ColumnRow = z.infer<typeof ColumnSchema> & { version: number }

class Column extends Entity<typeof ColumnSchema> {
  static add(boardId: string, name: string) {
    return new Column(ColumnSchema, { boardId, name } as EntityInput<z.infer<typeof ColumnSchema>>, true)
  }
  static fromRow(row: ColumnRow) {
    return new Column(ColumnSchema, row, false)
  }
  get boardId() {
    return this.toDTO().boardId
  }
  rename(name: string) {
    this.change({ name })
  }
}

/** At most `MAX` columns a board: a rule over several rows, checked in each way a save may. */
class Columns extends TableRepository<Column, ColumnRow, Base> {
  protected toEntity(row: ColumnRow) {
    return Column.fromRow(row)
  }

  /** Right: the rule checked after the writes, guarding the board's columns. */
  async persistGuarded(column: Column) {
    await this.save([column], each => this.write(each), {
      guard: [`columns:${column.boardId}`],
      after: async () => { if (await this.count({ boardId: column.boardId }) > MAX) throw new Error('too many') },
    })
  }

  /** Wrong: the same rule, saying it needs no guard. On SQLite it holds; on Postgres two saves side by side both pass. */
  async persistWithEmptyGuard(column: Column) {
    await this.save([column], each => this.write(each), {
      guard: [],
      after: async () => { if (await this.count({ boardId: column.boardId }) > MAX) throw new Error('too many') },
    })
  }

  /** Wrong: read in `before`, which needs no guard to compile. */
  async persistReadingBefore(column: Column) {
    await this.save([column], each => this.write(each), {
      before: async () => { if ((await this.find({ boardId: column.boardId })).length >= MAX) throw new Error('too many') },
    })
  }

  /** Wrong: rows written from what was read, in a transaction that guards nothing. */
  async copyBoard(from: string, to: string) {
    await this.saveRows(async () => {
      for (const row of await this.table.find({ boardId: from })) await this.table.insert({ ...row, id: Bun.randomUUIDv7(), boardId: to })
    })
  }
}

class Board extends Module {
  constructor(base: Base, readonly columns: Columns) {
    super('column', base.invocations)
  }
  @UseCase()
  async add(boardId: string, name: string) { await this.columns.persistWithEmptyGuard(Column.add(boardId, name)) }
}

let store: SqliteStore

beforeEach(async () => {
  store = await SqliteStore.open({ path: ':memory:' })
  await store.transaction(() => store.connection.run('CREATE TABLE "column" (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL)'))
})

afterEach(() => store.close())

function open(guardRule?: GuardRule) {
  const base = new Base({ name: 'test', store, guardRule })
  return new Columns(base, store.table<ColumnRow>('column'), { scope: 'none' })
}

const saved = () => store.table('column').count()

describe('the guard rule', () => {
  test('lets a save read what it guards', async () => {
    const columns = open()

    await columns.persistGuarded(Column.add('b1', 'todo'))
    await columns.persistGuarded(Column.add('b1', 'doing'))
    await expect(columns.persistGuarded(Column.add('b1', 'done'))).rejects.toThrow('too many')
    expect(await saved()).toBe(2)
  })

  test('refuses a save that reads with an empty guard, on SQLite too, and writes nothing of it', async () => {
    const columns = open()

    await expect(columns.persistWithEmptyGuard(Column.add('b1', 'todo'))).rejects.toThrow('[guard rule] a save outside any use case reads column in a save that guards nothing')
    expect(await saved()).toBe(0)
  })

  test('names the use case whose save it is', async () => {
    const board = new Board(new Base({ name: 'test', store }), open())

    await expect(board.add('b1', 'todo')).rejects.toThrow('[guard rule] column.add reads column')
  })

  test('refuses one that reads in before, and rows written with saveRows from what they read', async () => {
    const columns = open()
    await columns.persistGuarded(Column.add('b1', 'todo'))

    await expect(columns.persistReadingBefore(Column.add('b1', 'doing'))).rejects.toThrow('[guard rule]')
    await expect(columns.copyBoard('b1', 'b2')).rejects.toThrow('[guard rule]')
    expect(await saved()).toBe(1)
  })

  test('says nothing of reads outside the save: an entity read, changed and saved with its version, even in one transaction', async () => {
    const columns = open()
    await columns.persistGuarded(Column.add('b1', 'todo'))

    const read = (await columns.first())!
    read.rename('to do')
    await columns.persist(read)
    await store.transaction(async () => {
      const again = (await columns.first())!
      again.rename('todo')
      await columns.persist(again)
    })
    expect((await columns.first())!.toDTO().name).toBe('todo')
  })

  test('warn only warns, once for each use case and what it read, and off says nothing', async () => {
    const warnings: string[] = []
    const original = console.warn
    console.warn = (message: string) => { warnings.push(message) }
    try {
      const warned = open('warn')
      await warned.persistWithEmptyGuard(Column.add('b1', 'todo'))
      await warned.persistWithEmptyGuard(Column.add('b1', 'doing'))
      await open('off').persistWithEmptyGuard(Column.add('b2', 'todo'))
    } finally {
      console.warn = original
    }

    expect(warnings).toHaveLength(1)
    expect(await saved()).toBe(3)
  })
})
