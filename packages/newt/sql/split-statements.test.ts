import { describe, expect, test } from 'bun:test'
import { splitStatements } from './split-statements'

describe('splitStatements', () => {
  test('splits on the semicolons outside strings and comments', () => {
    expect(splitStatements("INSERT INTO t VALUES ('a;b'); -- one; two\nSELECT 1;")).toEqual(["INSERT INTO t VALUES ('a;b')", '-- one; two\nSELECT 1'])
  })

  test('with dollar quotes, keeps a dollar-quoted body whole, whatever its tag', () => {
    const fn = 'CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN NEW.x := 1; RETURN NEW; END; $$ LANGUAGE plpgsql'
    const tagged = "CREATE FUNCTION g() RETURNS text AS $body2$ SELECT 'a;b'; $body2$ LANGUAGE sql"

    expect(splitStatements(`${fn};\n${tagged};\nSELECT 2;`, { dollarQuotes: true })).toEqual([fn, tagged, 'SELECT 2'])
  })

  test('a parameter like $1, or a $ inside a name, is no dollar quote', () => {
    expect(splitStatements('SELECT $1; SELECT 2;', { dollarQuotes: true })).toEqual(['SELECT $1', 'SELECT 2'])
    expect(splitStatements('SELECT col$x$ FROM t; SELECT 2;', { dollarQuotes: true })).toEqual(['SELECT col$x$ FROM t', 'SELECT 2'])
  })

  test('without dollar quotes (MySQL), a $ is a character like any other', () => {
    expect(splitStatements('INSERT INTO t VALUES ("a$$b"); SELECT 2;')).toEqual(['INSERT INTO t VALUES ("a$$b")', 'SELECT 2'])
  })

  test('a $$ in a comment or a string opens no dollar quote', () => {
    expect(splitStatements("-- bodies go in $$ quotes\nSELECT 1; SELECT '$$'; SELECT 2;", { dollarQuotes: true })).toEqual(['-- bodies go in $$ quotes\nSELECT 1', "SELECT '$$'", 'SELECT 2'])
  })

  test('a block comment is skipped whole, quotes and semicolons in it too', () => {
    expect(splitStatements("/* the user's table; */ SELECT 1; SELECT 2;")).toEqual(["/* the user's table; */ SELECT 1", 'SELECT 2'])
  })

  test('a quoted name is skipped whole, an apostrophe or a semicolon in it too', () => {
    expect(splitStatements('SELECT "o\'neil;" FROM t; SELECT `a\'b` FROM t; SELECT 2;')).toEqual(['SELECT "o\'neil;" FROM t', 'SELECT `a\'b` FROM t', 'SELECT 2'])
  })

  test('a doubled quote, or a -- inside a string, does not end it', () => {
    expect(splitStatements("SELECT 'it''s; a--b'; SELECT 2;")).toEqual(["SELECT 'it''s; a--b'", 'SELECT 2'])
  })

  test('with backslash escapes (MySQL), a \\\' does not end a string', () => {
    expect(splitStatements("SELECT 'it\\'s;'; SELECT 'a\\\\'; SELECT 2;", { backslashEscapes: true })).toEqual(["SELECT 'it\\'s;'", "SELECT 'a\\\\'", 'SELECT 2'])
    expect(splitStatements("SELECT 'a\\'; SELECT 2;")).toEqual(["SELECT 'a\\'", 'SELECT 2'])
  })

  test("a Postgres E'…' string escapes with a backslash, without the option", () => {
    expect(splitStatements("SELECT E'it\\'s;'; SELECT 2;", { dollarQuotes: true })).toEqual(["SELECT E'it\\'s;'", 'SELECT 2'])
  })
})
