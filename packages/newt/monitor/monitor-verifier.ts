import { timingSafeEqual } from 'node:crypto'
import type { Clock } from '../core'
import { MONITOR_HEADERS, monitorSignature } from './monitor-signature'

/** How far a request's time may be from the application's, either way. */
const WINDOW_MS = 30_000

const NONCE = /^[A-Za-z0-9_-]{16,64}$/
const SIGNATURE = /^[0-9a-f]{64}$/

/**
 * Tells a request signed with the key (`signMonitorRequest`) from any other: its
 * signature is the key's for this very request, it was made within the window of
 * now, and its nonce was not seen before. A nonce is kept until its request could no
 * longer be on time, so the same request twice is refused the second time.
 */
export class MonitorVerifier {

  /** Each nonce seen, until when it is kept. */
  private readonly seen = new Map<string, number>()

  constructor(
    private readonly key: string,
    private readonly clock: Clock,
  ) {}

  verify(request: Request): boolean {
    const timestamp = request.headers.get(MONITOR_HEADERS.timestamp) ?? ''
    const nonce = request.headers.get(MONITOR_HEADERS.nonce) ?? ''
    const signature = request.headers.get(MONITOR_HEADERS.signature) ?? ''
    if (!/^\d{1,16}$/.test(timestamp) || !NONCE.test(nonce) || !SIGNATURE.test(signature)) return false

    const now = this.clock.now().getTime()
    if (Math.abs(now - Number(timestamp)) > WINDOW_MS) return false

    const { pathname, search } = new URL(request.url)
    const expected = monitorSignature(this.key, { method: request.method, path: pathname + search, timestamp, nonce })
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return false

    // Only a request signed with the key gets this far: nobody else can fill what it keeps.
    this.forgetBefore(now)
    if (this.seen.has(nonce)) return false
    this.seen.set(nonce, Number(timestamp) + WINDOW_MS)
    return true
  }

  private forgetBefore(now: number): void {
    for (const [nonce, until] of this.seen) if (until < now) this.seen.delete(nonce)
  }
}
