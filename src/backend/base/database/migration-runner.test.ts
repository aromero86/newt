import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Database as Sqlite } from 'bun:sqlite'
import { mkdtemp, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MigrationRunner } from './migration-runner'

let folder: string
let sqlite: Sqlite

const write = (file: string, sql: string) => Bun.write(join(folder, file), sql)

const rows = () => sqlite.query('SELECT * FROM note ORDER BY title').all()

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'newt-migrations-'))
  sqlite = new Sqlite(':memory:')
  await write('00001_note_up.sql', "CREATE TABLE note (id TEXT PRIMARY KEY, title TEXT NOT NULL);")
  await write('00001_note_down.sql', 'DROP TABLE note;')
})

afterEach(async () => {
  sqlite.close()
  await rm(folder, { recursive: true })
})

describe('up', () => {
  test('applies the pending migrations and remembers them', async () => {
    const runner = new MigrationRunner(sqlite, folder)

    expect(await runner.up()).toEqual({ applied: ['1_note'] })
    expect(await runner.up()).toEqual({ applied: [] })
  })

  test('keeps the stored data when a later migration changes the structure', async () => {
    const runner = new MigrationRunner(sqlite, folder)
    await runner.up()
    sqlite.run("INSERT INTO note (id, title) VALUES ('1', 'first'), ('2', 'second')")

    await write('00002_note-body_up.sql', "ALTER TABLE note ADD COLUMN body TEXT NOT NULL DEFAULT '';")
    await write('00002_note-body_down.sql', 'ALTER TABLE note DROP COLUMN body;')
    await runner.up()

    expect(rows()).toEqual([
      { id: '1', title: 'first', body: '' },
      { id: '2', title: 'second', body: '' },
    ])
  })

  test('applies a batch all or nothing', async () => {
    await write('00002_broken_up.sql', 'CREATE TABLE fine (id TEXT); NOT SQL;')
    await write('00002_broken_down.sql', 'DROP TABLE fine;')

    await expect(new MigrationRunner(sqlite, folder).up()).rejects.toThrow()

    expect(sqlite.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('note', 'fine')").all()).toEqual([])
  })

  test('refuses a migration without its down file', async () => {
    await write('00002_lonely_up.sql', 'CREATE TABLE lonely (id TEXT);')

    await expect(new MigrationRunner(sqlite, folder).up()).rejects.toThrow('missing its down file')
  })

  test('refuses a database whose last migration is not in the folder', async () => {
    await new MigrationRunner(sqlite, folder).up()
    await unlink(join(folder, '00001_note_up.sql'))
    await unlink(join(folder, '00001_note_down.sql'))

    await expect(new MigrationRunner(sqlite, folder).up()).rejects.toThrow('is not in the migrations folder')
  })
})

describe('down', () => {
  test('reverts only the last applied migration', async () => {
    await write('00002_note-body_up.sql', "ALTER TABLE note ADD COLUMN body TEXT NOT NULL DEFAULT '';")
    await write('00002_note-body_down.sql', 'ALTER TABLE note DROP COLUMN body;')
    const runner = new MigrationRunner(sqlite, folder)
    await runner.up()
    sqlite.run("INSERT INTO note (id, title, body) VALUES ('1', 'first', 'text')")

    expect(await runner.down()).toEqual({ reverted: '2_note-body' })
    expect(rows()).toEqual([{ id: '1', title: 'first' }])
    expect((await runner.status()).pending.map(file => file.version)).toEqual([2])
  })
})
