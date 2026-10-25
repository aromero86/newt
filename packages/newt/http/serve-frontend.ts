import { join, normalize } from 'node:path'

/**
 * The page is never shown inside someone else's: a frame could hide it and steal
 * a click, such as the yes of a consent page.
 */
const PAGE_HEADERS = { 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" }

/**
 * Serves the built frontend: a file when the path names one, otherwise `index.html`,
 * so the frontend's router handles the address (and shows its own "not found").
 */
export function serveFrontend(folder: string) {
  const index = Bun.file(join(folder, 'index.html'))

  return async (request: Request): Promise<Response> => {
    if (!(await index.exists())) {
      return new Response('The frontend is not built: its folder has no index.html', { status: 503 })
    }

    let path: string
    try {
      path = normalize(decodeURIComponent(new URL(request.url).pathname))
    } catch {
      // An address that does not decode names no file: the frontend's router says so.
      return new Response(index, { headers: PAGE_HEADERS })
    }
    const file = Bun.file(join(folder, path))
    if (path !== '/' && !path.includes('..') && (await file.exists())) return new Response(file)

    return new Response(index, { headers: PAGE_HEADERS })
  }
}
