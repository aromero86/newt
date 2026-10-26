/**
 * What a store remembers of a migration's script once applied, to tell when it was
 * changed since: its SHA-256, in hex. Its line ends count as `\n`, so a checkout that
 * turns them into `\r\n` changes nothing.
 */
export function migrationChecksum(script: string): string {
  return new Bun.CryptoHasher('sha256').update(script.replaceAll('\r\n', '\n')).digest('hex')
}
