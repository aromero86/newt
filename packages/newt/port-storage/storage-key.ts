const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/**
 * A key is names joined by `/`, each of letters, digits, `.`, `_` and `-`, never starting
 * with a sign: so no `..` leaves a folder, and every adapter keeps the same keys.
 */
export function assertStorageKey(key: string): void {
  if (key.length > 900 || !key.split('/').every(segment => SEGMENT.test(segment))) {
    throw new Error(`'${key}' is no storage key: names of letters, digits, '.', '_' and '-', joined by '/'`)
  }
}
