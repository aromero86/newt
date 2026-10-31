/** Every scope defined (`defineScope`), by name, with how to read its value now. */
const scopes = new Map<string, () => unknown>()

/** A scope known by name, so what is counted can say which ones the work was in. */
export function registerScope(name: string, find: () => unknown): void {
  scopes.set(name, find)
}

/** The scopes the work in progress is in, each by name and the id of its value. */
export function activeScopes(): Record<string, string> {
  const active: Record<string, string> = {}
  for (const [name, find] of scopes) {
    const value = find()
    if (value !== undefined) active[name] = scopeId(value)
  }
  return active
}

/**
 * A scope's value as an id: itself if it is a string or a number, its one field if it
 * has one (`{ workspaceId }`), else the whole of it as JSON, or a placeholder when JSON
 * cannot hold it (a cycle, a bigint inside): what is counted never fails for its scopes.
 */
export function scopeId(value: unknown): string {
  if (['string', 'number', 'bigint', 'boolean'].includes(typeof value)) return String(value)
  if (value !== null && typeof value === 'object') {
    const fields = Object.values(value)
    if (fields.length === 1 && ['string', 'number', 'bigint'].includes(typeof fields[0])) return String(fields[0])
  }
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return '[unserializable]'
  }
}
