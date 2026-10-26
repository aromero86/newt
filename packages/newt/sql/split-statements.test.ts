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
})
