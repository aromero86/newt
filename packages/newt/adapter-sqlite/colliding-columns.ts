/**
 * The columns SQLite names in a collision (`UNIQUE constraint failed: thing.name`);
 * none for an index on an expression, which it names by the index alone.
 */
export function collidingColumns(error: unknown): string[] {
  const failed = /^UNIQUE constraint failed: (.+)$/.exec(String((error as { message?: unknown } | null)?.message ?? ''))?.[1]
  if (!failed || failed.startsWith('index ')) return []
  return failed.split(', ').map(column => column.slice(column.indexOf('.') + 1))
}
