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

  test('a statement that fails halfway fails the migration, all of it, and it is not recorded', async () => {
    const runner = new MigrationRunner(sqlite, folder)
    await runner.up()
    sqlite.run("CREATE TABLE draft (id TEXT PRIMARY KEY, title TEXT); INSERT INTO draft VALUES ('d1', 'a'), ('d2', NULL)")
    await write('00002_title-required_up.sql', `CREATE TABLE draft_new (id TEXT PRIMARY KEY, title TEXT NOT NULL);
INSERT INTO draft_new (id, title) SELECT id, title FROM draft;
DROP TABLE draft;
ALTER TABLE draft_new RENAME TO draft;`)
    await write('00002_title-required_down.sql', '')

    await expect(runner.up()).rejects.toThrow('NOT NULL')

    expect(sqlite.query('SELECT id, title FROM draft ORDER BY id').all()).toEqual([{ id: 'd1', title: 'a' }, { id: 'd2', title: null }])
    expect((await runner.status()).pending).toEqual(['00002_title-required'])
  })

  test('refuses two migrations with the same number, naming both', async () => {
    await write('00002_add-x_up.sql', 'ALTER TABLE note ADD COLUMN x TEXT;')
    await write('00002_add-x_down.sql', 'ALTER TABLE note DROP COLUMN x;')
    await write('00002_add-y_up.sql', 'ALTER TABLE note ADD COLUMN y TEXT;')
    await write('00002_add-y_down.sql', 'ALTER TABLE note DROP COLUMN y;')

    const refused = new MigrationRunner(sqlite, folder).up()

    await expect(refused).rejects.toThrow('share the version 00002')
    await expect(refused).rejects.toThrow(/00002_add-x_(up|down)\.sql and 00002_add-y_(up|down)\.sql|00002_add-y_(up|down)\.sql and 00002_add-x_(up|down)\.sql/)
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

describe('a script, statement by statement', () => {
  const objects = () => sqlite.query("SELECT name FROM sqlite_master WHERE name IN ('a', 'b', 'c', 'a_count') ORDER BY name").all().map(row => (row as { name: string }).name)

  test('runs what follows a SELECT or an INSERT … RETURNING', async () => {
    await write('00002_abc_up.sql', 'CREATE TABLE a (x);\nSELECT 1;\nINSERT INTO a VALUES (1) RETURNING x;\nCREATE TABLE b (x)')
    await write('00002_abc_down.sql', 'DROP TABLE b; DROP TABLE a;')

    await new MigrationRunner(sqlite, folder).up()

    expect(objects()).toEqual(['a', 'b'])
  })

  test('ends no statement at a semicolon in a string, a quoted name or a comment', async () => {
    await write('00002_abc_up.sql', `CREATE TABLE a (x DEFAULT '--;', "y;" TEXT);
-- a comment; with a semicolon
CREATE TABLE b (x); /* ; */ CREATE TABLE [c;] (x);`)
    await write('00002_abc_down.sql', 'DROP TABLE [c;]; DROP TABLE b; DROP TABLE a;')

    await new MigrationRunner(sqlite, folder).up()

    expect(objects()).toEqual(['a', 'b'])
    expect(sqlite.query("SELECT count(*) AS total FROM sqlite_master WHERE name = 'c;'").get()).toEqual({ total: 1 })
  })

  test('a trigger whose body has a CASE … END ends at its own END', async () => {
    await write('00002_count_up.sql', `CREATE TABLE a_count (n INTEGER);
INSERT INTO a_count VALUES (0);
CREATE TEMP TRIGGER IF NOT EXISTS count_notes AFTER INSERT ON note BEGIN
  UPDATE a_count SET n = n + CASE WHEN new.title = '' THEN 0 ELSE 1 END;
  UPDATE a_count SET n = n;
END;
CREATE TABLE a (x);`)
    await write('00002_count_down.sql', 'DROP TABLE a; DROP TRIGGER count_notes; DROP TABLE a_count;')

    await new MigrationRunner(sqlite, folder).up()
    sqlite.run("INSERT INTO note (id, title) VALUES ('n1', 'one'), ('n2', '')")

    expect(objects()).toEqual(['a', 'a_count'])
    expect(sqlite.query('SELECT n FROM a_count').get()).toEqual({ n: 1 })
  })
})

describe('foreign keys', () => {
  beforeEach(async () => {
    sqlite.run('PRAGMA foreign_keys = ON')
    await write('00002_shelf_up.sql', `CREATE TABLE shelf (id TEXT PRIMARY KEY);
CREATE TABLE jar (id TEXT PRIMARY KEY, shelf_id TEXT NOT NULL REFERENCES shelf(id) ON DELETE CASCADE);
INSERT INTO shelf VALUES ('s1'); INSERT INTO jar VALUES ('j1', 's1');`)
    await write('00002_shelf_down.sql', 'DROP TABLE jar; DROP TABLE shelf;')
    await new MigrationRunner(sqlite, folder).up()
  })

  test('a table rebuilt as SQLite documents it keeps the rows that point at it', async () => {
    await write('00003_shelf-name_up.sql', `PRAGMA foreign_keys = OFF;
CREATE TABLE shelf_new (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '');
INSERT INTO shelf_new (id) SELECT id FROM shelf;
DROP TABLE shelf;
ALTER TABLE shelf_new RENAME TO shelf;
PRAGMA foreign_keys = ON;`)
    await write('00003_shelf-name_down.sql', '')

    await new MigrationRunner(sqlite, folder).up()

    expect(sqlite.query('SELECT id, shelf_id FROM jar').all()).toEqual([{ id: 'j1', shelf_id: 's1' }])
    expect(sqlite.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })

  test('one that leaves rows pointing nowhere fails, and is not applied', async () => {
    await write('00003_no-shelves_up.sql', 'DROP TABLE shelf; CREATE TABLE shelf (id TEXT PRIMARY KEY);')
    await write('00003_no-shelves_down.sql', '')
    const runner = new MigrationRunner(sqlite, folder)

    await expect(runner.up()).rejects.toThrow('jar → shelf')

    expect(sqlite.query('SELECT id FROM shelf').all()).toEqual([{ id: 's1' }])
    expect((await runner.status()).pending).toEqual(['00003_no-shelves'])
    expect(sqlite.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
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
