import type { BunRequest } from 'bun'

export type SessionCookieOptions = {
  /** Sent only over HTTPS: whenever the address people open is HTTPS, even when the proxy before it speaks HTTP. */
  secure: boolean
  /** How long the browser keeps it, in seconds. */
  maxAgeSeconds: number
  /** The paths it is sent to: every one (`/`) unless told. */
  path?: string
}

/**
 * Keeps a session's token (or any secret of one) in a cookie as it must be: the page's
 * scripts cannot read it (`HttpOnly`), another site's requests do not carry it, but a
 * link followed to it does (`SameSite=Lax`), and only over HTTPS when `secure`.
 */
export function setSessionCookie(request: BunRequest, name: string, value: string, { secure, maxAgeSeconds, path = '/' }: SessionCookieOptions): void {
  request.cookies.set(name, value, { httpOnly: true, sameSite: 'lax', secure, path, maxAge: maxAgeSeconds })
}

/** Ends a session's cookie: the same one, empty and already gone, so the browser drops it. */
export function clearSessionCookie(request: BunRequest, name: string, options: Omit<SessionCookieOptions, 'maxAgeSeconds'>): void {
  setSessionCookie(request, name, '', { ...options, maxAgeSeconds: 0 })
}
