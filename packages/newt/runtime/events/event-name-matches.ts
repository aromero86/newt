/** Whether a subscription's pattern takes an event: its name, or `<prefix>.*` for every event under it. */
export function eventNameMatches(pattern: string, name: string): boolean {
  if (pattern === name) return true
  if (pattern.endsWith('.*')) return name.startsWith(pattern.slice(0, -1)) // "product.*" matches every product event
  return false
}
