/** The database's own code of an error (`23505`, `1062`), whatever its driver calls it. */
export function errorCode(error: unknown): string {
  const { errno, code } = (error ?? {}) as { errno?: unknown, code?: unknown }
  return String(errno ?? code ?? '')
}
