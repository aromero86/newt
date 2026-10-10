import { join, normalize } from 'node:path'

/**
 * Serves the built frontend: a file when the path names one, otherwise `index.html`,
 * so the frontend's router handles the address (and shows its own "not found").
 */
export function serveFrontend(folder: string) {
  const index = Bun.file(join(folder, 'index.html'))

  return async (request: Request): Promise<Response> => {
    if (!(await index.exists())) {
      return new Response('The frontend is not built. Run: bun run build:frontend', { status: 503 })
    }

    const path = normalize(decodeURIComponent(new URL(request.url).pathname))
    const file = Bun.file(join(folder, path))
    if (path !== '/' && !path.includes('..') && (await file.exists())) return new Response(file)

    return new Response(index)
  }
}
