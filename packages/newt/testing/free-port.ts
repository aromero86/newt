/**
 * A port nobody listens on now: for a server that must know its own address before it
 * starts (an OAuth server names itself in its metadata), or one another must know.
 */
export function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port!
  void probe.stop(true)
  return port
}
