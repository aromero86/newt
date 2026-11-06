/** Types a browser shows and cannot run, as HTML and SVG can. Anything else is only ever downloaded. */
const SHOWN_AS_THEY_ARE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf'])

/** Whether a browser may be told to show a file of this type where it is served. */
export function mayShowInline(contentType: string): boolean {
  return SHOWN_AS_THEY_ARE.has(contentType.split(';')[0]!.trim().toLowerCase())
}

/**
 * The `Content-Disposition` of a file served: `inline` only for what a browser cannot
 * run, else `attachment`, so a page someone uploaded never runs on an origin of ours.
 */
export function contentDisposition(contentType: string, disposition: 'attachment' | 'inline' = 'attachment', filename?: string): string {
  const shown = disposition === 'inline' && mayShowInline(contentType) ? 'inline' : 'attachment'
  if (filename === undefined) return shown
  const plain = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `${shown}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, escapeForRfc5987)}`
}

const escapeForRfc5987 = (char: string) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
