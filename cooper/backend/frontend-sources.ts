import type { HTMLBundle } from 'bun'

/**
 * Each context's frontend from its sources, for development (`bun run cooper`): every
 * context serves its pages beside its API, on its own port, as it will once built, and
 * Bun reloads them as they change. Imported only when asked for, so production never
 * builds them as it starts.
 */
export async function frontendSources(): Promise<Record<string, { frontend: HTMLBundle }>> {
  const [auth, boards, backoffice] = await Promise.all([
    import('../frontend/auth/index.html'),
    import('../frontend/boards/index.html'),
    import('../frontend/backoffice/index.html'),
  ])
  return { auth: { frontend: auth.default }, boards: { frontend: boards.default }, backoffice: { frontend: backoffice.default } }
}
