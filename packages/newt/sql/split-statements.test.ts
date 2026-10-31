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

  test('a MySQL trigger keeps its BEGIN … END body whole, IF … END IF in it too', () => {
    const trigger = "CREATE DEFINER = `admin`@`%` TRIGGER t BEFORE INSERT ON c FOR EACH ROW BEGIN\n  IF NEW.x IS NULL THEN SET NEW.x = IF(NEW.y > 0, 1, 2); END IF;\n  SET NEW.z = CASE WHEN NEW.x = 1 THEN 'a;b' ELSE 'c' END;\nEND"

    expect(splitStatements(`${trigger};\nINSERT INTO c VALUES (1);`, { backslashEscapes: true })).toEqual([trigger, 'INSERT INTO c VALUES (1)'])
  })

  test('a MySQL procedure keeps its loops and nested blocks whole', () => {
    const procedure = 'CREATE PROCEDURE p() BEGIN DECLARE i INT DEFAULT 0; lbl: LOOP SET i = i + 1; IF i > 3 THEN LEAVE lbl; END IF; END LOOP lbl; WHILE i > 0 DO SET i = i - 1; END WHILE; REPEAT SET i = i + 1; UNTIL i > 2 END REPEAT; CASE i WHEN 3 THEN BEGIN SELECT REPEAT("a", 2); END; ELSE SELECT 0; END CASE; END'

    expect(splitStatements(`${procedure}; SELECT 2;`, { backslashEscapes: true })).toEqual([procedure, 'SELECT 2'])
  })

  test('a Postgres BEGIN ATOMIC body stays whole', () => {
    const fn = 'CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC INSERT INTO t VALUES (1); SELECT 1; END'

    expect(splitStatements(`${fn};\nSELECT 2;`, { dollarQuotes: true })).toEqual([fn, 'SELECT 2'])
  })

  test('outside a routine, BEGIN and END are words like any other', () => {
    expect(splitStatements('BEGIN; SELECT 1; END; SELECT CASE WHEN a THEN 1 END FROM t; SELECT 2;')).toEqual(['BEGIN', 'SELECT 1', 'END', 'SELECT CASE WHEN a THEN 1 END FROM t', 'SELECT 2'])
  })
})
