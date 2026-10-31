import type { Token_Deps } from './token.deps'
import type { Token_Module } from './token.module'

/**
 * A code brought twice was copied: whatever it was traded for stops working, a moment
 * later. And every night, the tokens past their refresh go: nobody refreshes them again.
 */
export function registerTokenWorkers(tokens: Token_Module, deps: Token_Deps): void {
  deps.oauthGrant.events.replayed.subscribe(grant => tokens.revokeGrant(grant.id), {
    strategy: 'handler',
    queue: 'token.revokeGrant.on.oauthGrant.replayed',
  })
  tokens.nightly.subscribe(() => tokens.purgeExpired(), {
    strategy: 'handler',
    queue: 'token.purgeExpired.on.token.nightly',
  })
}
