/**
 * The GitHub side of the shared story (story.ts): the pull requests, diffs
 * and releases the scenes show. Same people, same rules, same numbers. Only
 * what never changes with the language lives here (code, ids, numbers); the
 * titles people write come from the section's content.
 */

export type DiffLine = { n: number; kind: '+' | '-' | ' '; code: string }

/** PR #318, first push: guests can pay with Bizum, but with no limit. */
export const firstDiff: DiffLine[] = [
  { n: 40, kind: ' ', code: 'export async function pay(order: Order, method: Method, user: User) {' },
  { n: 41, kind: '-', code: '  if (user.isGuest) throw new GuestPaymentError()' },
  { n: 41, kind: '+', code: "  if (user.isGuest && method !== 'bizum') throw new GuestPaymentError()" },
  { n: 42, kind: '+', code: '  if (user.isGuest) return bizum.authorize(order)' },
  { n: 43, kind: ' ', code: '  return gateway.charge(order, method)' },
  { n: 44, kind: ' ', code: '}' },
]

/** The line newt annotates in the first push. */
export const annotatedLine = 42

/** PR #318 after the fix: the guest limit comes from the parameter. */
export const fixedDiff: DiffLine[] = [
  { n: 42, kind: '+', code: '  if (user.isGuest && order.total > params.bizum.guestLimit)' },
  { n: 43, kind: '+', code: '    throw new AccountRequiredError()' },
  { n: 44, kind: '+', code: '  if (user.isGuest) return bizum.authorize(order)' },
]

/** A PR whose proposal is still being discussed. */
export const blockedPr = { number: 321, proposal: 'PROP-45' }

/** A PR with no proposal that changes how the product behaves. */
export const behaviorPr = {
  number: 324,
  declared: 'fix',
  /** Which rule of the story it breaks (a key of story.rules). */
  breaks: 'paidOrderImmutable' as const,
  drafted: 'PROP-47',
}

/** A PR with no proposal that changes nothing a customer could notice. */
export const technicalPr = { number: 325 }

/** The hotfix that cannot wait for product. */
export const hotfixPr = { number: 326, drafted: 'PROP-48' }

/** The release the last scene publishes. */
export const releaseVersion = 'v2.4.0'
