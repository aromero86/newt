import { join, normalize } from 'node:path'

/**
 * A page is never shown inside someone else's: a frame could hide it and steal
 * a click, such as the yes of a consent page.
 */
const PAGE_HEADERS = { 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" }

/**
 * Serves the built frontend: a file when the path names one, otherwise `index.html`,
 * so the frontend's router handles the address (and shows its own "not found").
 * Every page, `index.html` or another one asked for by its name, refuses to be framed.
 */
export function serveFrontend(folder: string) {
  const index = Bun.file(join(folder, 'index.html'))

  return async (request: Request): Promise<Response> => {
    if (!(await index.exists())) {
      return new Response('The frontend is not built: its folder has no index.html', { status: 503 })
    }

    const file = await fileAt(folder, new URL(request.url).pathname)
    if (!file) return new Response(index, { headers: PAGE_HEADERS })
    return new Response(file, { headers: file.type.startsWith('text/html') ? PAGE_HEADERS : {} })
  }
}

/**
 * The file a path names inside the folder, or none: an address that does not decode,
 * that leaves the folder, or that no file system takes (a NUL in it) names none.
 */
async function fileAt(folder: string, pathname: string): Promise<Bun.BunFile | null> {
  try {
    const path = normalize(decodeURIComponent(pathname))
    if (path === '/' || path.includes('..') || path.includes('\0')) return null
    const file = Bun.file(join(folder, path))
    return (await file.exists()) ? file : null
  } catch {
    return null
  }
}
