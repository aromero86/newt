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
  folder = await mkdtemp(join(tmpdir(), 'framework-migrations-'))
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

    expect(await runner.up()).toEqual(['00001_note'])
    expect(await runner.up()).toEqual([])
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

    expect(await runner.down()).toBe('00002_note-body')
    expect(rows()).toEqual([{ id: '1', title: 'first' }])
    expect((await runner.status()).pending).toEqual(['00002_note-body'])
  })
})

describe('the folder', () => {
  test('one that does not exist is a path gone wrong, not a database with no migrations', async () => {
    await expect(new MigrationRunner(sqlite, join(folder, 'missing')).up()).rejects.toThrow('cannot be read')
  })

  test('none named: nothing to apply', async () => {
    expect(await new MigrationRunner(sqlite, undefined).up()).toEqual([])
  })

  test('only files named with five digits, a name and up or down are migrations', async () => {
    await write('1_short_up.sql', 'CREATE TABLE short (id TEXT);')
    await write('1_short_down.sql', 'DROP TABLE short;')
    await write('README.md', 'notes')

    expect(await new MigrationRunner(sqlite, folder).up()).toEqual(['00001_note'])
  })

  test('a statement whose string holds a semicolon runs whole', async () => {
    await write('00002_seed_up.sql', "INSERT INTO note (id, title) VALUES ('n1', 'one; two');")
    await write('00002_seed_down.sql', "DELETE FROM note WHERE id = 'n1';")

    await new MigrationRunner(sqlite, folder).up()

    expect(rows()).toEqual([{ id: 'n1', title: 'one; two' }])
  })
})

describe('a store\'s own SQL', () => {
  test('a trigger, with semicolons in its body, applies and reverts', async () => {
    await write('00002_note-search_up.sql', `CREATE VIRTUAL TABLE note_search USING fts5(title);
CREATE TRIGGER note_search_insert AFTER INSERT ON note BEGIN
  INSERT INTO note_search (rowid, title) VALUES (new.rowid, new.title);
END;`)
    await write('00002_note-search_down.sql', 'DROP TRIGGER note_search_insert; DROP TABLE note_search;')
    const runner = new MigrationRunner(sqlite, folder)

    await runner.up()
    sqlite.run("INSERT INTO note (id, title) VALUES ('n1', 'olive oil')")
    expect(sqlite.query("SELECT title FROM note_search WHERE note_search MATCH 'oil'").all()).toEqual([{ title: 'olive oil' }])

    await runner.down()
    expect(sqlite.query("SELECT name FROM sqlite_master WHERE name LIKE 'note_search%'").all()).toEqual([])
  })
})

describe('a script with no statement', () => {
  test('does nothing, as a down that has nothing to revert', async () => {
    await write('00002_irreversible_up.sql', "INSERT INTO note (id, title) VALUES ('n1', 'kept');")
    await write('00002_irreversible_down.sql', '-- nothing to revert\n')
    const runner = new MigrationRunner(sqlite, folder)
    await runner.up()

    expect(await runner.down()).toBe('00002_irreversible')
    expect(rows()).toEqual([{ id: 'n1', title: 'kept' }])
  })
})

describe('down, further', () => {
  test('refuses when the last applied migration has no file to revert it', async () => {
    const runner = new MigrationRunner(sqlite, folder)
    await runner.up()
    await unlink(join(folder, '00001_note_up.sql'))
    await unlink(join(folder, '00001_note_down.sql'))

    await expect(runner.down()).rejects.toThrow('not found')
  })
})
