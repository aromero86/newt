import { stat } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { inlineScriptHashes, policyOf, type ContentSecurityPolicy } from './content-security-policy'

/**
 * Serves the built frontend: a file when the path names one, otherwise `index.html`,
 * so the frontend's router handles the address (and shows its own "not found").
 * Every page, `index.html` or another one asked for by its name, has its
 * Content-Security-Policy (`csp`, newt's unless told), its own inline scripts let
 * through by their hashes, and refuses to be framed: a frame could hide it and steal a
 * click, such as the yes of a consent page.
 */
export function serveFrontend(folder: string, csp?: ContentSecurityPolicy | false) {
  const index = Bun.file(join(folder, 'index.html'))
  // A page's policy, by its path, while the page is as it was when it was read.
  const policies = new Map<string, { modified: number, policy: string }>()
  const headersOf = async (page: Bun.BunFile) => {
    // Asked again each time: a file's own `lastModified` stays as it was first read.
    const modified = (await stat(page.name!)).mtimeMs
    const known = policies.get(page.name!)
    const policy = known?.modified === modified ? known.policy : policyOf(csp, inlineScriptHashes(await page.text()))
    policies.set(page.name!, { modified, policy })
    return { 'x-frame-options': 'DENY', 'content-security-policy': policy }
  }

  return async (request: Request): Promise<Response> => {
    if (!(await index.exists())) {
      return new Response('The frontend is not built: its folder has no index.html', { status: 503 })
    }

    const file = await fileAt(folder, new URL(request.url).pathname)
    if (!file) return new Response(index, { headers: await headersOf(index) })
    return new Response(file, { headers: file.type.startsWith('text/html') ? await headersOf(file) : {} })
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
